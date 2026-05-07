/**
 * Materialize editorial throughlines as QuestionThreads rows.
 *
 * For each entry in config/editorialThroughlines.ts:
 *   1. embed the seed via the nlp-processor /embed endpoint (LaBSE 768-dim,
 *      same model that backs Chunks.transcription_vector)
 *   2. run nearVector against Chunks.transcription_vector, filtered to
 *      speaker_role='NARRATOR' and a configurable collection_id
 *   3. pick the top excerpt per testimony, capped at one per narrator so the
 *      throughline reads like a chorus instead of a single voice
 *   4. upsert a QuestionThreads row with a deterministic UUID + the
 *      answeredByChunks cross-ref pointing to the chosen chunks
 *
 * Once the row exists, every existing throughline code path picks it up —
 * the home cloud, /throughlines, the metadata Throughlines tab.
 *
 * Run:  yarn editorial:build                                # default collection, write
 *       yarn editorial:build --collection american-stories  # explicit
 *       yarn editorial:build --dry-run                      # preview matches, no write
 *       yarn editorial:build --threshold 0.45               # tighter matches
 */

import crypto from 'node:crypto';
import weaviate, { type WeaviateClient } from 'weaviate-client';
import { EDITORIAL_THROUGHLINES } from '../config/editorialThroughlines';

const NLP_URL = process.env.NLP_PROCESSOR_URL ?? 'http://localhost:7070';

const flagValue = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};

const collectionId = flagValue('collection') ?? 'american-stories';
const overrideThreshold = flagValue('threshold');
const dryRun = process.argv.includes('--dry-run');

// Mirrors nlp-processor/narrative_pipeline/pass2_threads.py:thread_uuid so
// the same `id` always maps to the same Weaviate row across reruns.
const THREAD_NAMESPACE = '8f8a8a40-narrative-pipeline-question-threads';
function deterministicThreadUuid(level: string, key: string): string {
  const raw = `${THREAD_NAMESPACE}|${collectionId}|${level}|editorial:${key.toLowerCase()}`;
  const digest = crypto.createHash('sha1').update(raw).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

async function embedSeed(text: string): Promise<number[]> {
  const res = await fetch(`${NLP_URL}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`embed failed (${res.status}) for "${text.slice(0, 40)}…"`);
  }
  const data = (await res.json()) as { vector?: number[] };
  if (!data.vector || data.vector.length === 0) {
    throw new Error(`embed returned empty vector for "${text.slice(0, 40)}…"`);
  }
  return data.vector;
}

type Hit = {
  chunk_uuid: string;
  theirstory_id: string;
  start_time: number;
  end_time: number;
  transcription: string;
  interview_title: string;
  similarity: number; // 1 - cosine_distance
};

async function nearVectorChunks(client: WeaviateClient, vector: number[], limit: number): Promise<Hit[]> {
  const collection = client.collections.get('Chunks');
  const filter = (
    collection as unknown as {
      filter: { byProperty: (p: string) => { equal: (v: string) => unknown } };
    }
  ).filter.byProperty;

  const filters = {
    operator: 'And',
    filters: [filter('collection_id').equal(collectionId), filter('speaker_role').equal('NARRATOR')],
    value: true,
  } as any;

  const result = await collection.query.nearVector(vector, {
    limit,
    targetVector: 'transcription_vector',
    filters,
    returnMetadata: ['distance'],
  } as any);

  return result.objects.map((obj) => {
    const p = obj.properties as Record<string, unknown>;
    const distance = ((obj.metadata as { distance?: number } | undefined)?.distance ?? 1) as number;
    return {
      chunk_uuid: obj.uuid as string,
      theirstory_id: typeof p.theirstory_id === 'string' ? p.theirstory_id : '',
      start_time: typeof p.start_time === 'number' ? p.start_time : 0,
      end_time: typeof p.end_time === 'number' ? p.end_time : 0,
      transcription: typeof p.transcription === 'string' ? p.transcription : '',
      interview_title: typeof p.interview_title === 'string' ? p.interview_title : '',
      similarity: 1 - distance,
    };
  });
}

function pickOnePerRecording(hits: Hit[], excerptsPer: number): Hit[] {
  const byTestimony = new Map<string, Hit[]>();
  for (const h of hits) {
    if (!h.theirstory_id) continue;
    if (!byTestimony.has(h.theirstory_id)) byTestimony.set(h.theirstory_id, []);
    byTestimony.get(h.theirstory_id)!.push(h);
  }
  const out: Hit[] = [];
  for (const list of byTestimony.values()) {
    list.sort((a, b) => b.similarity - a.similarity);
    out.push(...list.slice(0, excerptsPer));
  }
  // Sort across testimonies by best score so the strongest matches surface first.
  out.sort((a, b) => b.similarity - a.similarity);
  return out;
}

async function upsertThread(
  client: WeaviateClient,
  uuid: string,
  properties: Record<string, unknown>,
  chunkUuids: string[],
  vector: number[],
) {
  const collection = client.collections.get('QuestionThreads');
  // Delete first so we don't accumulate stale answeredByChunks refs from
  // prior runs. data.replace would also work; this keeps it explicit.
  try {
    await collection.data.deleteById(uuid);
  } catch {
    // ignore (was missing)
  }
  await collection.data.insert({
    id: uuid,
    properties,
    vectors: { question_vector: vector },
    references: { answeredByChunks: chunkUuids },
  } as any);
}

async function main(): Promise<void> {
  const httpHost = process.env.WEAVIATE_HOST_URL ?? 'localhost';
  const httpPort = Number(process.env.WEAVIATE_PORT ?? 8080);
  const grpcHost = process.env.WEAVIATE_GRPC_HOST_URL ?? httpHost;
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT ?? 50051);

  const client = await weaviate.connectToCustom({ httpHost, httpPort, grpcHost, grpcPort });
  try {
    console.log(`[editorial] collection=${collectionId} dry-run=${dryRun}`);
    console.log(`[editorial] ${EDITORIAL_THROUGHLINES.length} editorial throughline(s) to build`);

    for (const entry of EDITORIAL_THROUGHLINES) {
      console.log('');
      console.log(`[editorial] ── ${entry.label} (${entry.id})`);
      const threshold = overrideThreshold ? Number(overrideThreshold) : (entry.similarity_threshold ?? 0.4);
      const excerptsPer = entry.excerpts_per_recording ?? 1;

      const seed = entry.seed.trim();
      const vec = await embedSeed(seed);

      const candidates = await nearVectorChunks(client, vec, 80);
      const filtered = candidates.filter((h) => h.similarity >= threshold);
      const chosen = pickOnePerRecording(filtered, excerptsPer);

      const sourceCount = new Set(chosen.map((c) => c.theirstory_id)).size;
      console.log(
        `[editorial]    ${candidates.length} candidates → ${filtered.length} above ${threshold} → ${chosen.length} kept across ${sourceCount} recordings`,
      );
      for (const h of chosen.slice(0, 6)) {
        const titleShort = h.interview_title.slice(0, 24).padEnd(24);
        console.log(`[editorial]      ${h.similarity.toFixed(3)}  ${titleShort}  ${h.transcription.slice(0, 80)}…`);
      }
      if (sourceCount < 2) {
        console.log(
          `[editorial]    ⚠ skipping ${entry.label}: only ${sourceCount} recording matched (need 2+) — try a softer threshold or seed`,
        );
        continue;
      }

      const uuid = deterministicThreadUuid(entry.question_level, entry.id);
      const properties = {
        thread_id: `editorial:${entry.id}`,
        thread_question: seed,
        theme_label: entry.label,
        question_level: entry.question_level,
        source_count: sourceCount,
        convergence: 'DIVERGE',
        published: true,
        conflict_ids: [],
        collection_id: collectionId,
      };

      if (dryRun) {
        console.log(`[editorial]    DRY-RUN — would upsert ${uuid}`);
        continue;
      }
      await upsertThread(
        client,
        uuid,
        properties,
        chosen.map((h) => h.chunk_uuid),
        vec,
      );
      console.log(`[editorial]    ✓ upserted ${uuid}`);
    }

    console.log('');
    console.log('[editorial] done.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
