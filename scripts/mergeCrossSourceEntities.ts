/**
 * Rule-based cross-source entity merge.
 *
 * Pass 0 reconciles entities per-source, so "World War Two" gets a different
 * canonical UUID in each testimony unless Wikidata verification kicked in.
 * This script post-merges duplicate entities with the same canonical_form
 * (within safe entity types) so cross-source counts and the entity modal
 * reflect reality.
 *
 * Steps:
 *   1. Load all Entities.
 *   2. Group by (entity_type, lower(canonical_form)) for safe types.
 *   3. For each group with size > 1: pick a survivor (Wikidata-verified >
 *      most variants > lexicographically smallest UUID). Skip canonical_forms
 *      that look non-proper (lowercase, leading article, very short).
 *   4. For every chunk linked to a duplicate via the mentionsEntities cross-ref:
 *        - Rewrite chunk.entity_mentions[].entity_uuid (dup → survivor) and
 *          dedupe within the chunk.
 *        - Update the cross-ref: replace dup with survivor.
 *   5. Merge survivor's variants / transcription_notes / relationships.
 *   6. Delete duplicate Entity rows.
 *   7. Re-aggregate testimony.entity_mentions for every affected testimony.
 *
 * Run:  yarn merge:entities --dry-run          # report only
 *       yarn merge:entities                    # apply
 *       yarn merge:entities --types EVENT,PLACE
 *       yarn merge:entities --common-person    # PERSON entities with
 *                                              # lowercase canonical_forms
 *                                              # only (e.g. "grandma",
 *                                              # "father") merge across
 *                                              # sources. Proper-noun
 *                                              # PERSON entities are not
 *                                              # touched — Karen Matsuoka
 *                                              # and Wilhelm stay distinct.
 */

import weaviate, { type WeaviateClient } from 'weaviate-client';

type EntityRow = {
  uuid: string;
  canonical_form: string;
  entity_type: string;
  variants: string[];
  linked_data_qid: string | null;
  linked_data_url: string | null;
  linked_data_description: string | null;
  context_summary: string;
  transcription_notes: any[];
  relationships: any[];
  collection_id: string;
};

type ChunkRow = {
  uuid: string;
  theirstory_id: string;
  entity_mentions: any[];
  linkedEntityUuids: string[];
};

const DEFAULT_SAFE_TYPES = ['EVENT', 'PLACE', 'INSTITUTION', 'CULTURAL_ITEM', 'DATE'];

const NON_PROPER_PREFIXES = ['my ', 'a ', 'an ', 'the ', 'our ', 'their ', 'his ', 'her ', 'its '];

function isCanonicalEnoughToMerge(canonical: string, entityType?: string): boolean {
  if (!canonical) return false;
  const trimmed = canonical.trim();
  if (trimmed.length < 3) return false;
  // Allow whitelisted proper-noun synonyms even when they trip the prefix /
  // case rules (e.g. "the Mississippi River" or all-lowercase "internment").
  if (entityType) {
    const synonymHit = PROPER_NOUN_SYNONYM_MAP.get(`${entityType}|${trimmed.toLowerCase()}`);
    if (synonymHit) return true;
  }
  // Skip lowercase first letter — likely a generic noun phrase ("the war").
  const first = trimmed.charAt(0);
  if (first !== first.toUpperCase()) return false;
  const lower = trimmed.toLowerCase();
  for (const p of NON_PROPER_PREFIXES) {
    if (lower.startsWith(p)) return false;
  }
  return true;
}

/** Kinship-role synonym groups — entities whose canonical_forms map into
 * the same row collapse together regardless of which surface form the LLM
 * picked. The first entry of each group is the survivor's preferred label.
 * Add additional roles or spellings here when they show up in the data.
 */
const KINSHIP_SYNONYM_GROUPS: string[][] = [
  ['grandfather', 'grandpa', 'grandpop', 'granddad', 'gramps', 'grandfathers'],
  ['grandmother', 'grandma', 'grandmom', 'nana', 'grandmothers'],
  ['mother', 'mom', 'mama', 'mommy', 'mum', 'momma', 'mothers'],
  ['father', 'dad', 'papa', 'daddy', 'pop', 'pa', 'fathers'],
  // Modifier-prefixed forms ("little brother", "older sister") still refer to
  // the same kinship role for cross-source aggregation; collapse them into the
  // base term so the entity modal shows everyone's brother/sister stories.
  ['brother', 'bro', 'brothers', 'little brother', 'older brother', 'baby brother', 'younger brother', 'big brother'],
  ['sister', 'sis', 'sisters', 'little sister', 'older sister', 'baby sister', 'younger sister', 'big sister'],
  ['son', 'sons'],
  ['daughter', 'daughters'],
  ['uncle', 'uncles'],
  ['aunt', 'aunts', 'auntie', 'aunty'],
  ['cousin', 'cousins'],
  ['niece', 'nieces'],
  ['nephew', 'nephews'],
  ['grandparents', 'grandparent'],
  ['parents', 'parent'],
  ['grandchildren', 'grandchild', 'grandkids', 'grandkid'],
  ['great grandfather', 'great-grandfather', 'great grandpa', 'great-grandpa'],
  ['great grandmother', 'great-grandmother', 'great grandma', 'great-grandma'],
];

const SYNONYM_TO_CANONICAL = ((): Map<string, string> => {
  const m = new Map<string, string>();
  for (const group of KINSHIP_SYNONYM_GROUPS) {
    const canonical = group[0];
    for (const variant of group) m.set(variant.toLowerCase(), canonical);
  }
  return m;
})();

/** Returns the canonical synonym key for a common-person canonical_form.
 * Falls back to the lowercased input when no synonym group matches — that
 * way "indigenous people" still groups by exact text. */
function commonPersonGroupKey(canonical: string): string {
  const lower = canonical.trim().toLowerCase();
  return SYNONYM_TO_CANONICAL.get(lower) ?? lower;
}

/** Cross-spelling and short-form aliases for proper-noun entities. Like
 * KINSHIP_SYNONYM_GROUPS, the first entry is the survivor's preferred label.
 * Keep entries here narrow — same real-world referent, different surface form
 * — not "related concepts". Group key is (entity_type, lowered first entry).
 */
const PROPER_NOUN_SYNONYM_GROUPS: Record<string, string[][]> = {
  EVENT: [
    ['World War II', 'World War Two', 'World War 2', 'WWII', 'WW2'],
    ['Vietnam War', 'Vietnam conflict'],
    ['internment', 'internment experience'],
  ],
  PLACE: [
    ['Mississippi River', 'the Mississippi River'],
    ['Santa Anita', 'Santa Anita racetrack'],
  ],
};

/** type|lowered-variant → preferred canonical_form. Built once. */
const PROPER_NOUN_SYNONYM_MAP = ((): Map<string, string> => {
  const m = new Map<string, string>();
  for (const [type, groups] of Object.entries(PROPER_NOUN_SYNONYM_GROUPS)) {
    for (const group of groups) {
      const canonical = group[0];
      for (const variant of group) m.set(`${type}|${variant.toLowerCase()}`, canonical);
    }
  }
  return m;
})();

function properNounGroupKey(type: string, canonical: string): string {
  const preferred = PROPER_NOUN_SYNONYM_MAP.get(`${type}|${canonical.trim().toLowerCase()}`);
  return preferred ? preferred.toLowerCase() : canonical.trim().toLowerCase();
}

/** Inverse rule for common-noun PERSON entities (kinship roles like
 * "grandma", "father"). The whole canonical_form starts lowercase — that's
 * the signal we use to distinguish them from named people. We DO want to
 * merge these across sources so the entity modal can show "everyone's
 * grandma" stories. We also keep the leading-article guard so phrases
 * starting with "my "/"the " don't sneak through (the normalizer already
 * stripped those, but a defensive check costs nothing).
 */
function isCommonPersonCanonical(canonical: string): boolean {
  if (!canonical) return false;
  const trimmed = canonical.trim();
  if (trimmed.length < 3) return false;
  const first = trimmed.charAt(0);
  // Must start lowercase to count as a common noun.
  if (first !== first.toLowerCase()) return false;
  if (first === first.toUpperCase()) return false; // e.g. digits — bail
  const lower = trimmed.toLowerCase();
  for (const p of NON_PROPER_PREFIXES) {
    if (lower.startsWith(p)) return false;
  }
  return true;
}

function pickSurvivor(group: EntityRow[]): EntityRow {
  return [...group].sort((a, b) => {
    const aQid = a.linked_data_qid ? 1 : 0;
    const bQid = b.linked_data_qid ? 1 : 0;
    if (aQid !== bQid) return bQid - aQid;
    const aVar = (a.variants ?? []).length;
    const bVar = (b.variants ?? []).length;
    if (aVar !== bVar) return bVar - aVar;
    return a.uuid.localeCompare(b.uuid);
  })[0];
}

async function loadAllEntities(client: WeaviateClient): Promise<EntityRow[]> {
  const collection = client.collections.get('Entities');
  const result = await collection.query.fetchObjects({ limit: 10_000 });
  return result.objects.map((obj): EntityRow => {
    const p = obj.properties as Record<string, unknown>;
    return {
      uuid: obj.uuid as string,
      canonical_form: typeof p.canonical_form === 'string' ? p.canonical_form : '',
      entity_type: typeof p.entity_type === 'string' ? p.entity_type : '',
      variants: Array.isArray(p.variants) ? (p.variants as string[]) : [],
      linked_data_qid: typeof p.linked_data_qid === 'string' ? p.linked_data_qid : null,
      linked_data_url: typeof p.linked_data_url === 'string' ? p.linked_data_url : null,
      linked_data_description: typeof p.linked_data_description === 'string' ? p.linked_data_description : null,
      context_summary: typeof p.context_summary === 'string' ? p.context_summary : '',
      transcription_notes: Array.isArray(p.transcription_notes) ? p.transcription_notes : [],
      relationships: Array.isArray(p.relationships) ? p.relationships : [],
      collection_id: typeof p.collection_id === 'string' ? p.collection_id : '',
    };
  });
}

async function loadChunksByEntityRefs(client: WeaviateClient, entityUuids: Set<string>): Promise<ChunkRow[]> {
  if (entityUuids.size === 0) return [];
  const collection = client.collections.get('Chunks');
  const result = await collection.query.fetchObjects({
    limit: 10_000,
    returnReferences: [{ linkOn: 'mentionsEntities' }],
  });
  const out: ChunkRow[] = [];
  for (const obj of result.objects) {
    const p = obj.properties as Record<string, unknown>;
    const refs = (obj.references as Record<string, { objects: { uuid: string }[] }> | undefined) ?? {};
    const linked = (refs.mentionsEntities?.objects ?? []).map((l) => l.uuid);
    const intersects = linked.some((u) => entityUuids.has(u));
    if (!intersects) continue;
    out.push({
      uuid: obj.uuid as string,
      theirstory_id: typeof p.theirstory_id === 'string' ? p.theirstory_id : '',
      entity_mentions: Array.isArray(p.entity_mentions) ? p.entity_mentions : [],
      linkedEntityUuids: linked,
    });
  }
  return out;
}

function rewriteChunkMentions(
  mentions: any[],
  remap: Map<string, string>,
  preferredCanonicalByUuid: Map<string, string>,
): { mentions: any[]; changed: boolean } {
  if (!mentions.length) return { mentions, changed: false };
  let changed = false;
  // Replace UUIDs and dedupe identical (entity_uuid, start_time, end_time) tuples.
  const seen = new Set<string>();
  const out: any[] = [];
  for (const m of mentions) {
    const orig = m?.entity_uuid as string | undefined;
    if (!orig) {
      out.push(m);
      continue;
    }
    const target = remap.get(orig) ?? orig;
    if (target !== orig) changed = true;
    const key = `${target}|${m.start_time ?? ''}|${m.end_time ?? ''}`;
    if (seen.has(key)) {
      changed = true;
      continue;
    }
    seen.add(key);
    const preferredForm = preferredCanonicalByUuid.get(target);
    const next = { ...m, entity_uuid: target };
    if (preferredForm && next.canonical_form !== preferredForm) {
      next.canonical_form = preferredForm;
      changed = true;
    }
    out.push(next);
  }
  return { mentions: out, changed };
}

async function patchChunk(
  client: WeaviateClient,
  chunk: ChunkRow,
  newMentions: any[],
  newCrossRef: string[],
): Promise<void> {
  const collection = client.collections.get('Chunks');
  await collection.data.update({
    id: chunk.uuid,
    properties: { entity_mentions: newMentions } as any,
  });
  // Rewrite the cross-ref by replacing the entire set.
  await collection.data.referenceReplace({
    fromUuid: chunk.uuid,
    fromProperty: 'mentionsEntities',
    to: newCrossRef,
  });
}

async function patchTestimony(
  client: WeaviateClient,
  testimonyUuid: string,
  mentions: any[],
  labels: string[],
): Promise<void> {
  const collection = client.collections.get('Testimonies');
  await collection.data.update({
    id: testimonyUuid,
    properties: { entity_mentions: mentions, ner_labels: labels } as any,
  });
}

async function mergeSurvivor(
  client: WeaviateClient,
  survivor: EntityRow,
  duplicates: EntityRow[],
  preferredCanonicalForm?: string,
): Promise<void> {
  const finalCanonical = preferredCanonicalForm ?? survivor.canonical_form;
  const variantSet = new Set<string>([survivor.canonical_form, ...(survivor.variants ?? [])]);
  for (const d of duplicates) {
    variantSet.add(d.canonical_form);
    for (const v of d.variants ?? []) variantSet.add(v);
  }
  const mergedVariants = Array.from(variantSet).filter((v) => v && v !== finalCanonical);

  const relSeen = new Set<string>();
  const mergedRelationships: any[] = [];
  for (const r of [...(survivor.relationships ?? []), ...duplicates.flatMap((d) => d.relationships ?? [])]) {
    const key = `${(r?.target_canonical_form ?? '').toLowerCase()}|${(r?.relationship_type ?? '').toLowerCase()}|${(r?.qualifier ?? '').toLowerCase()}`;
    if (relSeen.has(key)) continue;
    relSeen.add(key);
    mergedRelationships.push(r);
  }

  const noteSeen = new Set<string>();
  const mergedNotes: any[] = [];
  for (const n of [
    ...(survivor.transcription_notes ?? []),
    ...duplicates.flatMap((d) => d.transcription_notes ?? []),
  ]) {
    const key = `${(n?.variant ?? '').toLowerCase()}|${(n?.likely_correct ?? '').toLowerCase()}`;
    if (noteSeen.has(key)) continue;
    noteSeen.add(key);
    mergedNotes.push(n);
  }

  // Promote any duplicate's Wikidata link if survivor lacks one.
  let qid = survivor.linked_data_qid;
  let qurl = survivor.linked_data_url;
  let qdesc = survivor.linked_data_description;
  if (!qid) {
    const linked = duplicates.find((d) => d.linked_data_qid);
    if (linked) {
      qid = linked.linked_data_qid;
      qurl = linked.linked_data_url;
      qdesc = linked.linked_data_description;
    }
  }

  const collection = client.collections.get('Entities');
  const props: Record<string, unknown> = {
    variants: mergedVariants,
    relationships: mergedRelationships,
    transcription_notes: mergedNotes,
    linked_data_qid: qid,
    linked_data_url: qurl,
    linked_data_description: qdesc,
  };
  if (finalCanonical !== survivor.canonical_form) {
    props.canonical_form = finalCanonical;
  }
  await collection.data.update({
    id: survivor.uuid,
    properties: props as any,
  });
}

async function deleteEntity(client: WeaviateClient, uuid: string): Promise<void> {
  const collection = client.collections.get('Entities');
  await collection.data.deleteById(uuid);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const commonPersonMode = args.includes('--common-person');
  const typesIdx = args.indexOf('--types');
  const safeTypes = commonPersonMode
    ? ['PERSON']
    : typesIdx >= 0
      ? args[typesIdx + 1].split(',').map((s) => s.trim().toUpperCase())
      : DEFAULT_SAFE_TYPES;

  const httpHost = process.env.WEAVIATE_HOST_URL ?? 'localhost';
  const httpPort = Number(process.env.WEAVIATE_PORT ?? 8080);
  const grpcHost = process.env.WEAVIATE_GRPC_HOST_URL ?? httpHost;
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT ?? 50051);

  const client = await weaviate.connectToCustom({ httpHost, httpPort, grpcHost, grpcPort });
  try {
    console.log(
      `[merge] Mode: ${commonPersonMode ? 'common-noun PERSON across sources' : `safe types: ${safeTypes.join(', ')}`}`,
    );
    console.log(`[merge] Dry run: ${dryRun}`);
    console.log(`[merge] Loading entities...`);
    const entities = await loadAllEntities(client);
    console.log(`[merge] ${entities.length} entities loaded`);

    // Group by (type, lower(canonical_form)). The eligibility rule depends
    // on the mode: common-person mode requires lowercase canonical_form,
    // the default proper-noun mode requires uppercase first letter.
    const eligible = (e: EntityRow) =>
      commonPersonMode
        ? isCommonPersonCanonical(e.canonical_form)
        : isCanonicalEnoughToMerge(e.canonical_form, e.entity_type);
    const groupKeyFor = (e: EntityRow) =>
      commonPersonMode
        ? `${e.entity_type}|${commonPersonGroupKey(e.canonical_form)}`
        : `${e.entity_type}|${properNounGroupKey(e.entity_type, e.canonical_form)}`;
    const groups = new Map<string, EntityRow[]>();
    for (const e of entities) {
      if (!safeTypes.includes(e.entity_type)) continue;
      if (!eligible(e)) continue;
      const key = groupKeyFor(e);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }

    const duplicateGroups = Array.from(groups.values()).filter((g) => g.length > 1);
    console.log(`[merge] ${duplicateGroups.length} duplicate group(s) found`);
    if (duplicateGroups.length === 0) {
      console.log('[merge] Nothing to merge.');
      return;
    }

    // Build the merge map: dup_uuid → survivor_uuid. In common-person mode
    // we also compute the preferred canonical_form for each survivor (first
    // entry of the kinship synonym group), so "grandpa" wins on UUID rules
    // but ends up renamed to "grandfather" once the merge completes.
    const remap = new Map<string, string>();
    const preferredCanonicalByUuid = new Map<string, string>();
    type Plan = { survivor: EntityRow; duplicates: EntityRow[]; preferredCanonical?: string };
    const plans: Plan[] = [];
    for (const group of duplicateGroups) {
      const survivor = pickSurvivor(group);
      const duplicates = group.filter((e) => e.uuid !== survivor.uuid);
      let preferredCanonical: string | undefined;
      if (commonPersonMode) {
        const candidate = SYNONYM_TO_CANONICAL.get(survivor.canonical_form.trim().toLowerCase());
        if (candidate && candidate !== survivor.canonical_form) {
          preferredCanonical = candidate;
        }
        const finalForm = preferredCanonical ?? survivor.canonical_form;
        preferredCanonicalByUuid.set(survivor.uuid, finalForm);
      } else {
        // Proper-noun synonym hit ("World War Two" → "World War II",
        // "the Mississippi River" → "Mississippi River"). Rename the
        // survivor so the entity card shows the preferred spelling.
        const candidate = PROPER_NOUN_SYNONYM_MAP.get(
          `${survivor.entity_type}|${survivor.canonical_form.trim().toLowerCase()}`,
        );
        if (candidate && candidate !== survivor.canonical_form) {
          preferredCanonical = candidate;
          preferredCanonicalByUuid.set(survivor.uuid, candidate);
        }
      }
      plans.push({ survivor, duplicates, preferredCanonical });
      for (const d of duplicates) remap.set(d.uuid, survivor.uuid);
      const renameNote = preferredCanonical ? ` → rename to "${preferredCanonical}"` : '';
      console.log(
        `[merge] ${survivor.entity_type} "${survivor.canonical_form}"${renameNote} : keep ${survivor.uuid.slice(0, 8)} + merge ${duplicates.length} dup(s)`,
      );
    }

    console.log(`[merge] ${remap.size} duplicate entities will be merged`);

    if (dryRun) {
      console.log('[merge] Dry run complete — no writes performed.');
      return;
    }

    // Load every chunk that links to any duplicate (so we can rewrite the
    // cross-ref + entity_mentions UUIDs) OR to a survivor that's being
    // renamed (so we can rewrite the mention's canonical_form too — those
    // chunks may not link to any duplicate).
    console.log(`[merge] Loading affected chunks...`);
    const dupSet = new Set(remap.keys());
    const renamedSurvivors = new Set<string>();
    for (const [uuid, form] of preferredCanonicalByUuid) {
      const plan = plans.find((p) => p.survivor.uuid === uuid);
      if (plan && plan.survivor.canonical_form !== form) renamedSurvivors.add(uuid);
    }
    const chunkLoadSet = new Set<string>([...dupSet, ...renamedSurvivors]);
    const chunks = await loadChunksByEntityRefs(client, chunkLoadSet);
    console.log(`[merge] ${chunks.length} chunk(s) reference a duplicate or renamed survivor`);

    let chunkUpdates = 0;
    const affectedTestimonies = new Set<string>();
    for (const chunk of chunks) {
      const { mentions: rewritten, changed } = rewriteChunkMentions(
        chunk.entity_mentions,
        remap,
        preferredCanonicalByUuid,
      );
      const newCrossRef = Array.from(new Set(chunk.linkedEntityUuids.map((u) => remap.get(u) ?? u)));
      const crossRefChanged =
        newCrossRef.length !== chunk.linkedEntityUuids.length ||
        newCrossRef.some((u, i) => u !== chunk.linkedEntityUuids[i]);
      if (!changed && !crossRefChanged) continue;
      await patchChunk(client, chunk, rewritten, newCrossRef);
      chunkUpdates += 1;
      affectedTestimonies.add(chunk.theirstory_id);
    }

    console.log(`[merge] ${chunkUpdates} chunk(s) updated`);

    // Merge survivors (variants, relationships, notes, optional Wikidata,
    // and — in common-person mode — rename the canonical_form to the
    // preferred synonym so cross-source counts collapse into one label).
    for (const { survivor, duplicates, preferredCanonical } of plans) {
      await mergeSurvivor(client, survivor, duplicates, preferredCanonical);
    }
    console.log(`[merge] Survivors merged: ${plans.length}`);

    // Delete duplicates.
    let deleted = 0;
    for (const dupUuid of remap.keys()) {
      await deleteEntity(client, dupUuid);
      deleted += 1;
    }
    console.log(`[merge] ${deleted} duplicate entities deleted`);

    // Re-aggregate testimony.entity_mentions for affected testimonies.
    if (affectedTestimonies.size > 0) {
      console.log(`[merge] Re-aggregating ${affectedTestimonies.size} testimonies...`);
      const chunkCol = client.collections.get('Chunks');
      for (const testimonyId of affectedTestimonies) {
        const result = await chunkCol.query.fetchObjects({
          limit: 5000,
          filters: (chunkCol as any).filter.byProperty('theirstory_id').equal(testimonyId),
        });
        const aggregated: any[] = [];
        const labels = new Set<string>();
        for (const obj of result.objects) {
          const p = obj.properties as Record<string, unknown>;
          const mentions = Array.isArray(p.entity_mentions) ? (p.entity_mentions as any[]) : [];
          aggregated.push(...mentions);
          for (const m of mentions) {
            if (m?.label) labels.add(String(m.label));
          }
        }
        // The Testimony row's id is the same as theirstory_id (deterministic UUID).
        await patchTestimony(client, testimonyId, aggregated, [...labels].sort());
      }
    }

    console.log('[merge] DONE.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
