/**
 * Hard-delete one or more Entity rows + every reference to them.
 *
 * Usage:
 *   yarn delete:entities --uuids <uuid1>,<uuid2>      # by UUID list
 *   yarn delete:entities --canonical "Gestapo,KKK"    # by canonical_form (case-sensitive)
 *   yarn delete:entities ... --dry-run                # report only
 *
 * For each target entity:
 *   1. Find every Chunk that links to it (mentionsEntities cross-ref).
 *   2. Strip the UUID from chunk.entity_mentions[] (matched by entity_uuid)
 *      and rewrite the cross-ref to drop the link.
 *   3. Re-aggregate testimony.entity_mentions / ner_labels for any affected
 *      testimony so the testimony rows don't keep stale references.
 *   4. Delete the Entity row itself.
 *
 * Use this for entities the team has decided not to track (e.g. Gestapo
 * surfaced as an INSTITUTION but isn't part of the editorial focus).
 */

import weaviate, { type WeaviateClient } from 'weaviate-client';

type EntityRow = {
  uuid: string;
  canonical_form: string;
  entity_type: string;
};

type ChunkRow = {
  uuid: string;
  theirstory_id: string;
  entity_mentions: any[];
  linkedEntityUuids: string[];
};

async function loadAllEntities(client: WeaviateClient): Promise<EntityRow[]> {
  const collection = client.collections.get('Entities');
  const result = await collection.query.fetchObjects({ limit: 10_000 });
  return result.objects.map((obj): EntityRow => {
    const p = obj.properties as Record<string, unknown>;
    return {
      uuid: obj.uuid as string,
      canonical_form: typeof p.canonical_form === 'string' ? p.canonical_form : '',
      entity_type: typeof p.entity_type === 'string' ? p.entity_type : '',
    };
  });
}

async function loadChunksReferencing(client: WeaviateClient, targets: Set<string>): Promise<ChunkRow[]> {
  if (targets.size === 0) return [];
  const collection = client.collections.get('Chunks');
  const result = await collection.query.fetchObjects({
    limit: 10_000,
    returnReferences: [{ linkOn: 'mentionsEntities' }],
  });
  const out: ChunkRow[] = [];
  for (const obj of result.objects) {
    const refs = (obj.references as Record<string, { objects: { uuid: string }[] }> | undefined) ?? {};
    const linked = (refs.mentionsEntities?.objects ?? []).map((l) => l.uuid);
    if (!linked.some((u) => targets.has(u))) continue;
    const p = obj.properties as Record<string, unknown>;
    out.push({
      uuid: obj.uuid as string,
      theirstory_id: typeof p.theirstory_id === 'string' ? p.theirstory_id : '',
      entity_mentions: Array.isArray(p.entity_mentions) ? p.entity_mentions : [],
      linkedEntityUuids: linked,
    });
  }
  return out;
}

function stripMentions(mentions: any[], removed: Set<string>): { mentions: any[]; changed: boolean } {
  if (!mentions.length) return { mentions, changed: false };
  let changed = false;
  const out: any[] = [];
  for (const m of mentions) {
    const target = m?.entity_uuid as string | undefined;
    if (target && removed.has(target)) {
      changed = true;
      continue;
    }
    out.push(m);
  }
  return { mentions: out, changed };
}

async function patchChunk(client: WeaviateClient, chunk: ChunkRow, mentions: any[], crossRef: string[]) {
  const collection = client.collections.get('Chunks');
  await collection.data.update({ id: chunk.uuid, properties: { entity_mentions: mentions } as any });
  await collection.data.referenceReplace({
    fromUuid: chunk.uuid,
    fromProperty: 'mentionsEntities',
    to: crossRef,
  });
}

async function patchTestimony(client: WeaviateClient, testimonyId: string, mentions: any[], labels: string[]) {
  const collection = client.collections.get('Testimonies');
  await collection.data.update({
    id: testimonyId,
    properties: { entity_mentions: mentions, ner_labels: labels } as any,
  });
}

async function deleteEntity(client: WeaviateClient, uuid: string) {
  const collection = client.collections.get('Entities');
  await collection.data.deleteById(uuid);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const uuidsIdx = args.indexOf('--uuids');
  const canonicalIdx = args.indexOf('--canonical');
  const uuidArgs =
    uuidsIdx >= 0
      ? (args[uuidsIdx + 1] ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const canonicalArgs =
    canonicalIdx >= 0
      ? (args[canonicalIdx + 1] ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  if (uuidArgs.length === 0 && canonicalArgs.length === 0) {
    console.error('[delete] Specify at least one of --uuids or --canonical.');
    process.exit(2);
  }

  const httpHost = process.env.WEAVIATE_HOST_URL ?? 'localhost';
  const httpPort = Number(process.env.WEAVIATE_PORT ?? 8080);
  const grpcHost = process.env.WEAVIATE_GRPC_HOST_URL ?? httpHost;
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT ?? 50051);

  const client = await weaviate.connectToCustom({ httpHost, httpPort, grpcHost, grpcPort });
  try {
    console.log(`[delete] Loading entities...`);
    const entities = await loadAllEntities(client);
    const wantUuid = new Set(uuidArgs);
    const wantCanonical = new Set(canonicalArgs);
    const targets = entities.filter((e) => wantUuid.has(e.uuid) || wantCanonical.has(e.canonical_form));
    if (targets.length === 0) {
      console.log('[delete] No matching entities found.');
      return;
    }
    console.log(`[delete] ${targets.length} target(s):`);
    for (const t of targets) {
      console.log(`   ${t.entity_type} "${t.canonical_form}" (${t.uuid.slice(0, 8)})`);
    }

    if (dryRun) {
      console.log('[delete] Dry run — no writes performed.');
      return;
    }

    const targetUuids = new Set(targets.map((t) => t.uuid));
    console.log(`[delete] Loading affected chunks...`);
    const chunks = await loadChunksReferencing(client, targetUuids);
    console.log(`[delete] ${chunks.length} chunk(s) reference these entities`);

    const affectedTestimonies = new Set<string>();
    let chunkUpdates = 0;
    for (const chunk of chunks) {
      const { mentions, changed } = stripMentions(chunk.entity_mentions, targetUuids);
      const newRef = chunk.linkedEntityUuids.filter((u) => !targetUuids.has(u));
      const refChanged = newRef.length !== chunk.linkedEntityUuids.length;
      if (!changed && !refChanged) continue;
      await patchChunk(client, chunk, mentions, newRef);
      chunkUpdates += 1;
      if (chunk.theirstory_id) affectedTestimonies.add(chunk.theirstory_id);
    }
    console.log(`[delete] ${chunkUpdates} chunk(s) updated`);

    for (const t of targets) {
      await deleteEntity(client, t.uuid);
    }
    console.log(`[delete] ${targets.length} entity row(s) deleted`);

    if (affectedTestimonies.size > 0) {
      console.log(`[delete] Re-aggregating ${affectedTestimonies.size} testimony row(s)...`);
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
          for (const m of mentions) if (m?.label) labels.add(String(m.label));
        }
        await patchTestimony(client, testimonyId, aggregated, [...labels].sort());
      }
    }

    console.log('[delete] DONE.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
