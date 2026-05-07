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

function isCanonicalEnoughToMerge(canonical: string): boolean {
  if (!canonical) return false;
  const trimmed = canonical.trim();
  if (trimmed.length < 3) return false;
  // Skip lowercase first letter — likely a generic noun phrase ("the war").
  const first = trimmed.charAt(0);
  if (first !== first.toUpperCase()) return false;
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

function rewriteChunkMentions(mentions: any[], remap: Map<string, string>): { mentions: any[]; changed: boolean } {
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
    out.push({ ...m, entity_uuid: target });
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

async function mergeSurvivor(client: WeaviateClient, survivor: EntityRow, duplicates: EntityRow[]): Promise<void> {
  const variantSet = new Set<string>([survivor.canonical_form, ...(survivor.variants ?? [])]);
  for (const d of duplicates) {
    variantSet.add(d.canonical_form);
    for (const v of d.variants ?? []) variantSet.add(v);
  }
  const mergedVariants = Array.from(variantSet).filter((v) => v && v !== survivor.canonical_form);

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
  await collection.data.update({
    id: survivor.uuid,
    properties: {
      variants: mergedVariants,
      relationships: mergedRelationships,
      transcription_notes: mergedNotes,
      linked_data_qid: qid,
      linked_data_url: qurl,
      linked_data_description: qdesc,
    } as any,
  });
}

async function deleteEntity(client: WeaviateClient, uuid: string): Promise<void> {
  const collection = client.collections.get('Entities');
  await collection.data.deleteById(uuid);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const typesIdx = args.indexOf('--types');
  const safeTypes =
    typesIdx >= 0 ? args[typesIdx + 1].split(',').map((s) => s.trim().toUpperCase()) : DEFAULT_SAFE_TYPES;

  const httpHost = process.env.WEAVIATE_HOST_URL ?? 'localhost';
  const httpPort = Number(process.env.WEAVIATE_PORT ?? 8080);
  const grpcHost = process.env.WEAVIATE_GRPC_HOST_URL ?? httpHost;
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT ?? 50051);

  const client = await weaviate.connectToCustom({ httpHost, httpPort, grpcHost, grpcPort });
  try {
    console.log(`[merge] Safe types: ${safeTypes.join(', ')}`);
    console.log(`[merge] Dry run: ${dryRun}`);
    console.log(`[merge] Loading entities...`);
    const entities = await loadAllEntities(client);
    console.log(`[merge] ${entities.length} entities loaded`);

    // Group by (type, lower(canonical_form)).
    const groups = new Map<string, EntityRow[]>();
    for (const e of entities) {
      if (!safeTypes.includes(e.entity_type)) continue;
      if (!isCanonicalEnoughToMerge(e.canonical_form)) continue;
      const key = `${e.entity_type}|${e.canonical_form.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }

    const duplicateGroups = Array.from(groups.values()).filter((g) => g.length > 1);
    console.log(`[merge] ${duplicateGroups.length} duplicate group(s) found`);
    if (duplicateGroups.length === 0) {
      console.log('[merge] Nothing to merge.');
      return;
    }

    // Build the merge map: dup_uuid → survivor_uuid.
    const remap = new Map<string, string>();
    type Plan = { survivor: EntityRow; duplicates: EntityRow[] };
    const plans: Plan[] = [];
    for (const group of duplicateGroups) {
      const survivor = pickSurvivor(group);
      const duplicates = group.filter((e) => e.uuid !== survivor.uuid);
      plans.push({ survivor, duplicates });
      for (const d of duplicates) remap.set(d.uuid, survivor.uuid);
      console.log(
        `[merge] ${survivor.entity_type} "${survivor.canonical_form}" : keep ${survivor.uuid.slice(0, 8)} + merge ${duplicates.length} dup(s)`,
      );
    }

    console.log(`[merge] ${remap.size} duplicate entities will be merged`);

    if (dryRun) {
      console.log('[merge] Dry run complete — no writes performed.');
      return;
    }

    // Load every chunk that links to any entity in remap, so we can rewrite
    // both the cross-ref and the entity_mentions array.
    console.log(`[merge] Loading affected chunks...`);
    const dupSet = new Set(remap.keys());
    const chunks = await loadChunksByEntityRefs(client, dupSet);
    console.log(`[merge] ${chunks.length} chunk(s) reference a duplicate`);

    let chunkUpdates = 0;
    const affectedTestimonies = new Set<string>();
    for (const chunk of chunks) {
      const { mentions: rewritten, changed } = rewriteChunkMentions(chunk.entity_mentions, remap);
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

    // Merge survivors (variants, relationships, notes, optional Wikidata).
    for (const { survivor, duplicates } of plans) {
      await mergeSurvivor(client, survivor, duplicates);
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
