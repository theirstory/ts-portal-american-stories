/**
 * Backfill `entity_mentions` on Chunks and Testimonies in place, deriving
 * precise per-occurrence word-level spans from each chunk's word_timestamps
 * and the variants of every Entity it cross-refs.
 *
 * Replaces the segment-spanning legacy `ner_data` highlights without
 * re-running the LLM ingest pipeline.
 *
 * Run:  yarn backfill:entity-mentions
 *       yarn backfill:entity-mentions --story <theirstory_id>   # one story only
 *       yarn backfill:entity-mentions --dry-run                 # no PATCH
 */

import weaviate, { type WeaviateClient } from 'weaviate-client';

type WordTs = { start: number; end: number; text: string };
type EntityRow = {
  uuid: string;
  canonical_form: string;
  entity_type: string;
  variants: string[];
};
type ChunkRow = {
  uuid: string;
  theirstory_id: string;
  narrative_segment_id: string;
  word_timestamps: WordTs[];
  entityUuids: string[];
};
type EmittedMention = {
  entity_uuid: string;
  canonical_form: string;
  label: string;
  text: string;
  start_time: number;
  end_time: number;
  segment_id: string;
};

const NORMALIZE = /[^a-z0-9]+/g;
const normalize = (s: string) => (s ?? '').toLowerCase().replace(NORMALIZE, '');
const tokenize = (s: string) =>
  (s ?? '')
    .split(/\s+/)
    .map(normalize)
    .filter((t) => t.length > 0);

function buildMentions(chunk: ChunkRow, entitiesById: Map<string, EntityRow>): EmittedMention[] {
  if (!chunk.word_timestamps?.length || !chunk.entityUuids.length) return [];

  // Pre-tokenize each variant; longest-first so multi-word forms win.
  type Cand = { entity: EntityRow; tokens: string[]; variant: string };
  const candidates: Cand[] = [];
  for (const eid of chunk.entityUuids) {
    const e = entitiesById.get(eid);
    if (!e) continue;
    const variants = Array.from(
      new Set([e.canonical_form, ...(e.variants ?? [])].map((v) => (v ?? '').trim()).filter(Boolean)),
    ).sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length);
    for (const v of variants) {
      const tokens = tokenize(v);
      if (tokens.length) candidates.push({ entity: e, tokens, variant: v });
    }
  }
  candidates.sort((a, b) => b.tokens.length - a.tokens.length);

  const wordsNorm = chunk.word_timestamps.map((w) => normalize(w.text));
  const consumed = new Array(wordsNorm.length).fill(false);
  const mentions: EmittedMention[] = [];

  for (const c of candidates) {
    const tlen = c.tokens.length;
    let i = 0;
    while (i <= wordsNorm.length - tlen) {
      if (consumed[i]) {
        i += 1;
        continue;
      }
      let ok = true;
      for (let j = 0; j < tlen; j += 1) {
        if (consumed[i + j] || wordsNorm[i + j] !== c.tokens[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        const startW = chunk.word_timestamps[i];
        const endW = chunk.word_timestamps[i + tlen - 1];
        const matched = chunk.word_timestamps
          .slice(i, i + tlen)
          .map((w) => w.text)
          .join(' ')
          .trim();
        mentions.push({
          entity_uuid: c.entity.uuid,
          canonical_form: c.entity.canonical_form,
          label: c.entity.entity_type,
          text: matched || c.variant,
          start_time: Number(startW.start ?? 0),
          end_time: Number(endW.end ?? startW.start ?? 0),
          segment_id: chunk.narrative_segment_id ?? '',
        });
        for (let j = 0; j < tlen; j += 1) consumed[i + j] = true;
        i += tlen;
      } else {
        i += 1;
      }
    }
  }

  mentions.sort((a, b) => a.start_time - b.start_time);
  return mentions;
}

async function fetchAllEntities(client: WeaviateClient): Promise<Map<string, EntityRow>> {
  const collection = client.collections.get('Entities');
  const result = await collection.query.fetchObjects({
    limit: 10_000,
    returnProperties: ['canonical_form', 'entity_type', 'variants'] as any,
  });
  const map = new Map<string, EntityRow>();
  for (const obj of result.objects) {
    const props = obj.properties as Record<string, unknown>;
    map.set(obj.uuid as string, {
      uuid: obj.uuid as string,
      canonical_form: typeof props.canonical_form === 'string' ? props.canonical_form : '',
      entity_type: typeof props.entity_type === 'string' ? props.entity_type : '',
      variants: Array.isArray(props.variants) ? (props.variants as string[]) : [],
    });
  }
  return map;
}

async function fetchChunksForStory(client: WeaviateClient, theirstoryId?: string): Promise<ChunkRow[]> {
  const collection = client.collections.get('Chunks');
  const byProp = (
    collection as unknown as {
      filter: { byProperty: (p: string) => { equal: (v: string) => unknown } };
    }
  ).filter.byProperty;

  const fetchOpts: any = {
    limit: 10_000,
    // Letting the v4 client return all properties — explicitly listing
    // word_timestamps in returnProperties triggers a gRPC type error against
    // nested object[] columns. We only read three fields off the props.
    returnReferences: [{ linkOn: 'mentionsEntities' }],
  };
  if (theirstoryId) {
    fetchOpts.filters = byProp('theirstory_id').equal(theirstoryId);
  }
  const result = await collection.query.fetchObjects(fetchOpts);

  const out: ChunkRow[] = [];
  for (const obj of result.objects) {
    const props = obj.properties as Record<string, unknown>;
    const refs = (obj.references as Record<string, { objects: { uuid: string }[] }> | undefined) ?? {};
    const linked = refs.mentionsEntities?.objects ?? [];
    out.push({
      uuid: obj.uuid as string,
      theirstory_id: typeof props.theirstory_id === 'string' ? props.theirstory_id : '',
      narrative_segment_id: typeof props.narrative_segment_id === 'string' ? props.narrative_segment_id : '',
      word_timestamps: Array.isArray(props.word_timestamps) ? (props.word_timestamps as WordTs[]) : [],
      entityUuids: linked.map((l) => l.uuid),
    });
  }
  return out;
}

async function patchChunkEntityMentions(
  client: WeaviateClient,
  chunkUuid: string,
  mentions: EmittedMention[],
): Promise<void> {
  const collection = client.collections.get('Chunks');
  await collection.data.update({
    id: chunkUuid,
    properties: { entity_mentions: mentions } as any,
  });
}

async function patchTestimonyEntityMentions(
  client: WeaviateClient,
  testimonyUuid: string,
  mentions: EmittedMention[],
  labels: string[],
): Promise<void> {
  const collection = client.collections.get('Testimonies');
  await collection.data.update({
    id: testimonyUuid,
    properties: { entity_mentions: mentions, ner_labels: labels } as any,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const storyIdx = args.indexOf('--story');
  const targetStory = storyIdx >= 0 ? args[storyIdx + 1] : undefined;

  const httpHost = process.env.WEAVIATE_HOST_URL ?? 'localhost';
  const httpPort = Number(process.env.WEAVIATE_PORT ?? 8080);
  const grpcHost = process.env.WEAVIATE_GRPC_HOST_URL ?? httpHost;
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT ?? 50051);

  const client = await weaviate.connectToCustom({ httpHost, httpPort, grpcHost, grpcPort });
  try {
    console.log(`[backfill] Loading Entities...`);
    const entities = await fetchAllEntities(client);
    console.log(`[backfill] ${entities.size} entities loaded`);

    console.log(`[backfill] Loading Chunks${targetStory ? ` for ${targetStory}` : ''}...`);
    const chunks = await fetchChunksForStory(client, targetStory);
    console.log(`[backfill] ${chunks.length} chunks loaded`);

    // Group chunks by testimony so we can aggregate after.
    const chunksByTestimony = new Map<string, ChunkRow[]>();
    for (const c of chunks) {
      if (!chunksByTestimony.has(c.theirstory_id)) chunksByTestimony.set(c.theirstory_id, []);
      chunksByTestimony.get(c.theirstory_id)!.push(c);
    }

    let chunksWithMentions = 0;
    let totalMentions = 0;

    for (const [testimonyId, group] of chunksByTestimony) {
      const aggregated: EmittedMention[] = [];
      const labelSet = new Set<string>();
      let chunkMentionCount = 0;

      for (const chunk of group) {
        const mentions = buildMentions(chunk, entities);
        if (mentions.length) {
          chunksWithMentions += 1;
          chunkMentionCount += mentions.length;
          aggregated.push(...mentions);
          for (const m of mentions) labelSet.add(m.label);
        }
        if (!dryRun) {
          await patchChunkEntityMentions(client, chunk.uuid, mentions);
        }
      }

      totalMentions += chunkMentionCount;
      console.log(
        `[backfill] testimony ${testimonyId}: ${group.length} chunks, ${chunkMentionCount} mentions, ${labelSet.size} labels`,
      );

      if (!dryRun) {
        await patchTestimonyEntityMentions(client, testimonyId, aggregated, [...labelSet].sort());
      }
    }

    console.log('');
    console.log(`[backfill] DONE. ${chunksWithMentions} chunks updated, ${totalMentions} total mentions.`);
    if (dryRun) console.log('[backfill] Dry-run: no PATCH operations were sent.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
