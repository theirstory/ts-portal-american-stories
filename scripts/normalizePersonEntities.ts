/**
 * One-off normalizer for PERSON canonical_forms.
 *
 * The early Pass 0 NER pipeline let possessive pronouns through into the
 * canonical entity_text — we'd see "my grandma", "his cousin", "their
 * uncle". The label-strip rule has since been added to NER_EXTRACTION_SYSTEM
 * + NER_RECONCILIATION_SYSTEM, but stored entities still carry the old
 * forms. This script:
 *
 *   1. Walks every PERSON entity in Weaviate.
 *   2. Strips a leading possessive pronoun ("my ", "his ", "her ",
 *      "their ", "our ") from canonical_form and from each variant.
 *   3. If the stripped form changed, also rewrites the chunks that point
 *      at this entity via entity_mentions[].canonical_form.
 *   4. Re-aggregates testimony.entity_mentions for any touched testimonies
 *      so the dropdown labels and chip text are consistent.
 *
 * The script does NOT merge entities that collapse to the same name — that's
 * a separate concern (see scripts/mergeCrossSourceEntities.ts which
 * deliberately excludes PERSON because different speakers' "grandma"s are
 * different people).
 *
 * Run:  yarn normalize:person                  # apply
 *       yarn normalize:person --dry-run        # preview
 */

import weaviate, { type WeaviateClient } from 'weaviate-client';

const POSSESSIVE_RE = /^(my|his|her|their|our)\s+/i;

function stripPossessive(s: string): string {
  return (s ?? '').trim().replace(POSSESSIVE_RE, '').trim();
}

type EntityRow = {
  uuid: string;
  canonical_form: string;
  variants: string[];
};

type ChunkRow = {
  uuid: string;
  theirstory_id: string;
  entity_mentions: any[];
};

async function fetchPersonEntities(client: WeaviateClient): Promise<EntityRow[]> {
  const collection = client.collections.get('Entities');
  const filter = (
    collection as unknown as {
      filter: { byProperty: (p: string) => { equal: (v: string) => unknown } };
    }
  ).filter.byProperty;
  const result = await collection.query.fetchObjects({
    limit: 10_000,
    filters: filter('entity_type').equal('PERSON') as any,
  });
  return result.objects.map((obj) => {
    const p = obj.properties as Record<string, unknown>;
    return {
      uuid: obj.uuid as string,
      canonical_form: typeof p.canonical_form === 'string' ? p.canonical_form : '',
      variants: Array.isArray(p.variants) ? (p.variants as string[]) : [],
    };
  });
}

async function fetchChunksReferencing(client: WeaviateClient, entityUuids: Set<string>): Promise<ChunkRow[]> {
  if (entityUuids.size === 0) return [];
  const collection = client.collections.get('Chunks');
  const result = await collection.query.fetchObjects({ limit: 10_000 });
  const out: ChunkRow[] = [];
  for (const obj of result.objects) {
    const props = obj.properties as Record<string, unknown>;
    const mentions = Array.isArray(props.entity_mentions) ? (props.entity_mentions as any[]) : [];
    if (!mentions.some((m) => m?.entity_uuid && entityUuids.has(m.entity_uuid))) continue;
    out.push({
      uuid: obj.uuid as string,
      theirstory_id: typeof props.theirstory_id === 'string' ? props.theirstory_id : '',
      entity_mentions: mentions,
    });
  }
  return out;
}

async function patchEntity(client: WeaviateClient, uuid: string, canonical_form: string, variants: string[]) {
  const collection = client.collections.get('Entities');
  await collection.data.update({
    id: uuid,
    properties: { canonical_form, variants } as any,
  });
}

async function patchChunk(client: WeaviateClient, uuid: string, mentions: any[]) {
  const collection = client.collections.get('Chunks');
  await collection.data.update({
    id: uuid,
    properties: { entity_mentions: mentions } as any,
  });
}

async function patchTestimony(client: WeaviateClient, uuid: string, mentions: any[]) {
  const collection = client.collections.get('Testimonies');
  await collection.data.update({
    id: uuid,
    properties: { entity_mentions: mentions } as any,
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const httpHost = process.env.WEAVIATE_HOST_URL ?? 'localhost';
  const httpPort = Number(process.env.WEAVIATE_PORT ?? 8080);
  const grpcHost = process.env.WEAVIATE_GRPC_HOST_URL ?? httpHost;
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT ?? 50051);

  const client = await weaviate.connectToCustom({ httpHost, httpPort, grpcHost, grpcPort });
  try {
    console.log(`[normalize] dry-run=${dryRun}`);

    const persons = await fetchPersonEntities(client);
    console.log(`[normalize] ${persons.length} PERSON entit${persons.length === 1 ? 'y' : 'ies'}`);

    // Build a map: entity_uuid → (oldCanonical → newCanonical) when changed.
    const renames = new Map<string, { oldCanonical: string; newCanonical: string; newVariants: string[] }>();
    for (const e of persons) {
      const stripped = stripPossessive(e.canonical_form);
      if (!stripped || stripped === e.canonical_form) continue;
      // Capture the old canonical_form as a variant so it's still searchable.
      const variantSet = new Set([...e.variants.map((v) => v ?? ''), e.canonical_form]);
      // Also strip possessives from variants; keep originals alongside.
      const expanded = new Set<string>();
      for (const v of variantSet) {
        if (v) expanded.add(v);
        const sv = stripPossessive(v);
        if (sv) expanded.add(sv);
      }
      // Drop the new canonical_form itself from variants (don't list it twice).
      expanded.delete(stripped);
      const newVariants = Array.from(expanded).filter(Boolean);
      renames.set(e.uuid, { oldCanonical: e.canonical_form, newCanonical: stripped, newVariants });
    }

    console.log(`[normalize] ${renames.size} entit${renames.size === 1 ? 'y' : 'ies'} need renaming`);
    for (const [uuid, r] of renames) {
      console.log(`[normalize]   ${r.oldCanonical.padEnd(28)} → ${r.newCanonical}   (${uuid.slice(0, 8)})`);
    }

    if (renames.size === 0) {
      console.log('[normalize] nothing to do.');
      return;
    }

    if (!dryRun) {
      // 1. Update Entity rows.
      for (const [uuid, r] of renames) {
        await patchEntity(client, uuid, r.newCanonical, r.newVariants);
      }
      console.log(`[normalize] updated ${renames.size} entity rows`);
    }

    // 2. Find chunks that reference any renamed entity, rewrite their
    //    entity_mentions[].canonical_form to the new value.
    const chunks = await fetchChunksReferencing(client, new Set(renames.keys()));
    console.log(`[normalize] ${chunks.length} chunk(s) reference a renamed entity`);
    const touchedTestimonies = new Set<string>();
    let chunksUpdated = 0;
    for (const chunk of chunks) {
      let changed = false;
      const newMentions = chunk.entity_mentions.map((m) => {
        const rename = m?.entity_uuid ? renames.get(m.entity_uuid) : undefined;
        if (!rename) return m;
        if (m.canonical_form === rename.newCanonical) return m;
        changed = true;
        return { ...m, canonical_form: rename.newCanonical };
      });
      if (!changed) continue;
      if (!dryRun) await patchChunk(client, chunk.uuid, newMentions);
      chunksUpdated += 1;
      if (chunk.theirstory_id) touchedTestimonies.add(chunk.theirstory_id);
    }
    console.log(`[normalize] ${chunksUpdated} chunk(s) ${dryRun ? 'would be' : ''} updated`);

    // 3. Re-aggregate testimony.entity_mentions so the toolbar/Entities tab
    //    pick up the new labels without a full re-ingest.
    if (!dryRun && touchedTestimonies.size > 0) {
      const chunkCol = client.collections.get('Chunks');
      const filter = (
        chunkCol as unknown as {
          filter: { byProperty: (p: string) => { equal: (v: string) => unknown } };
        }
      ).filter.byProperty;
      console.log(
        `[normalize] re-aggregating ${touchedTestimonies.size} testimon${touchedTestimonies.size === 1 ? 'y' : 'ies'}`,
      );
      for (const testimonyId of touchedTestimonies) {
        const result = await chunkCol.query.fetchObjects({
          limit: 5000,
          filters: filter('theirstory_id').equal(testimonyId) as any,
        });
        const aggregated: any[] = [];
        for (const obj of result.objects) {
          const p = obj.properties as Record<string, unknown>;
          const mentions = Array.isArray(p.entity_mentions) ? (p.entity_mentions as any[]) : [];
          aggregated.push(...mentions);
        }
        await patchTestimony(client, testimonyId, aggregated);
      }
    }

    console.log('[normalize] done.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
