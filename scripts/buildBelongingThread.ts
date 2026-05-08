/**
 * Build a single, deterministic "Belonging" QuestionThread.
 *
 * Pass 2's LLM-driven thread synthesis picks its own theme labels and
 * question wording, so the Belonging cluster doesn't always emerge cleanly
 * (one run produces "Defining American Identity", another "Shaping
 * Identity"). For the demo we want the home-cloud Belonging chip to point
 * to a thread whose underlying chunks are unambiguously about feeling at
 * home in America — or feeling outside of it.
 *
 * This script scans every NARRATOR chunk's Pass 0 questions
 * (question_facts / question_feelings / question_identity), keeps the ones
 * that explicitly ask about belonging or feeling American, picks at most
 * two chunks per testimony to keep cross-source breadth, and writes one
 * QuestionThreads row with those chunks as `answeredByChunks` members.
 *
 * The thread's deterministic UUID derives from
 * (collection_id, level, lower(thread_question)) so reruns idempotently
 * upsert. Set `published: true` so the home cloud picks it up.
 *
 * Run:  yarn build:belonging-thread
 */

import weaviate, { type WeaviateClient } from 'weaviate-client';
import { createHash } from 'node:crypto';

const COLLECTION_ID = process.env.BELONGING_COLLECTION_ID ?? 'american-stories';
const THREAD_QUESTION = 'When have you felt most at home in America — and when have you felt outside of it?';
const THEME_LABEL = 'Belonging';
const QUESTION_LEVEL = 'IDENTITY';
const CONVERGENCE = 'DIVERGE';

const THREAD_NAMESPACE = '8f8a8a40-narrative-pipeline-question-threads';
// Per-source cap so one talkative narrator can't dominate the thread. Pass 2
// uses cluster.source_count for editorial weight and the modal renders one
// excerpt per chunk; ~2 chunks per source keeps the modal readable while
// still showing each narrator's contribution.
const MAX_CHUNKS_PER_SOURCE = 2;
// Thread total cap. Pass 2's biggest threads land around 50 members; we want
// a tighter, hand-picked feel here.
const MAX_TOTAL_CHUNKS = 18;

/** Patterns we treat as "this question is about belonging". Substring match
 * (case-insensitive) against each chunk's question_facts / feelings /
 * identity entry. The first pattern that hits wins; the chunk's score is
 * the pattern's index (lower = stronger). 'belong' (root) catches both
 * "belong" and "belonging"; the rest are auxiliary phrases that often
 * appear in belonging questions even when the word itself is absent. */
const BELONGING_PATTERNS: string[] = [
  'belong',
  'feel at home',
  'feel home',
  'feel american',
  'feel like an american',
  'feeling american',
  'become american',
  'become an american',
  'considered an american',
  'considered american',
  'fit in',
  'fitting in',
  'out of place',
  'outside the country',
  'sense of home',
  'home in america',
  'home in this country',
];

type ChunkRow = {
  uuid: string;
  theirstory_id: string;
  speaker_role: string;
  question_identity: string[];
  question_feelings: string[];
  question_facts: string[];
};

type Candidate = {
  chunk: ChunkRow;
  matchedQuestion: string;
  matchedLevel: 'FACTS' | 'FEELINGS' | 'IDENTITY';
  patternIndex: number; // lower index = stronger pattern
};

function deterministicThreadUuid(collectionId: string, level: string, threadQuestion: string): string {
  const raw = `${THREAD_NAMESPACE}|${collectionId || 'default'}|${level}|${threadQuestion.trim().toLowerCase()}`;
  const digest = createHash('sha1').update(raw, 'utf-8').digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function threadIdString(level: string, threadQuestion: string): string {
  const slug = threadQuestion.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 60);
  const safe = slug.replace(/[^a-z0-9_]/g, '_');
  return `${level.toLowerCase()}__${safe}`;
}

async function loadNarratorChunks(client: WeaviateClient, collectionId: string): Promise<ChunkRow[]> {
  const collection = client.collections.get('Chunks');
  const out: ChunkRow[] = [];
  // Offset paginate (collection_id filter is fine over the testimony archive).
  let offset = 0;
  const pageSize = 500;
  while (true) {
    const result = await collection.query.fetchObjects({
      limit: pageSize,
      offset,
      filters: (collection as any).filter.byProperty('collection_id').equal(collectionId),
    });
    if (result.objects.length === 0) break;
    for (const obj of result.objects) {
      const p = obj.properties as Record<string, unknown>;
      const role = String(p.speaker_role ?? '').toUpperCase();
      if (role && role !== 'NARRATOR') continue;
      out.push({
        uuid: obj.uuid as string,
        theirstory_id: String(p.theirstory_id ?? ''),
        speaker_role: role,
        question_identity: Array.isArray(p.question_identity) ? (p.question_identity as string[]) : [],
        question_feelings: Array.isArray(p.question_feelings) ? (p.question_feelings as string[]) : [],
        question_facts: Array.isArray(p.question_facts) ? (p.question_facts as string[]) : [],
      });
    }
    if (result.objects.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

function findBelongingMatch(
  chunk: ChunkRow,
): { question: string; level: 'FACTS' | 'FEELINGS' | 'IDENTITY'; patternIndex: number } | null {
  // Scan in IDENTITY → FEELINGS → FACTS order; identity-level questions
  // about belonging are the strongest signal, then feelings, then facts.
  const buckets: Array<['FACTS' | 'FEELINGS' | 'IDENTITY', string[]]> = [
    ['IDENTITY', chunk.question_identity],
    ['FEELINGS', chunk.question_feelings],
    ['FACTS', chunk.question_facts],
  ];
  let best: { question: string; level: 'FACTS' | 'FEELINGS' | 'IDENTITY'; patternIndex: number } | null = null;
  for (const [level, qs] of buckets) {
    for (const q of qs) {
      if (typeof q !== 'string') continue;
      const lower = q.toLowerCase();
      for (let i = 0; i < BELONGING_PATTERNS.length; i += 1) {
        if (!lower.includes(BELONGING_PATTERNS[i])) continue;
        if (!best || i < best.patternIndex) {
          best = { question: q, level, patternIndex: i };
          break;
        }
      }
      if (best && best.patternIndex === 0) break;
    }
    if (best && best.patternIndex === 0) break;
  }
  return best;
}

function pickMembers(candidates: Candidate[]): Candidate[] {
  // Sort by pattern strength (ascending), then by source diversity. We greedy-
  // pick across sources so every narrator with a belonging-themed question
  // contributes before any source contributes a second time, then a third
  // round for stronger signals up to the per-source cap.
  const sorted = [...candidates].sort((a, b) => a.patternIndex - b.patternIndex);

  const perSource = new Map<string, number>();
  const picked: Candidate[] = [];

  // Multi-pass: first pick 1 per source, then up to MAX_CHUNKS_PER_SOURCE.
  for (let pass = 1; pass <= MAX_CHUNKS_PER_SOURCE; pass += 1) {
    for (const c of sorted) {
      if (picked.length >= MAX_TOTAL_CHUNKS) break;
      const taken = perSource.get(c.chunk.theirstory_id) ?? 0;
      if (taken >= pass) continue;
      if (picked.includes(c)) continue;
      perSource.set(c.chunk.theirstory_id, taken + 1);
      picked.push(c);
    }
    if (picked.length >= MAX_TOTAL_CHUNKS) break;
  }

  return picked;
}

async function clearExistingBelongingThread(client: WeaviateClient, uuid: string): Promise<void> {
  const collection = client.collections.get('QuestionThreads');
  try {
    const existing = await collection.query.fetchObjectById(uuid);
    if (existing) {
      await collection.data.deleteById(uuid);
      console.log(`[belonging] removed previous Belonging thread ${uuid.slice(0, 8)}`);
    }
  } catch {
    // ignore — fetchObjectById can throw for missing ids
  }
}

async function writeThread(
  client: WeaviateClient,
  uuid: string,
  members: Candidate[],
  sources: Set<string>,
): Promise<void> {
  const collection = client.collections.get('QuestionThreads');
  await collection.data.insert({
    id: uuid,
    properties: {
      thread_id: threadIdString(QUESTION_LEVEL, THREAD_QUESTION),
      thread_question: THREAD_QUESTION,
      theme_label: THEME_LABEL,
      question_level: QUESTION_LEVEL,
      source_count: sources.size,
      convergence: CONVERGENCE,
      published: true,
      conflict_ids: [],
      collection_id: COLLECTION_ID,
    } as any,
    references: {
      answeredByChunks: members.map((m) => m.chunk.uuid),
    },
  });
}

async function main(): Promise<void> {
  const httpHost = process.env.WEAVIATE_HOST_URL ?? 'localhost';
  const httpPort = Number(process.env.WEAVIATE_PORT ?? 8080);
  const grpcHost = process.env.WEAVIATE_GRPC_HOST_URL ?? httpHost;
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT ?? 50051);
  const client = await weaviate.connectToCustom({ httpHost, httpPort, grpcHost, grpcPort });

  try {
    const uuid = deterministicThreadUuid(COLLECTION_ID, QUESTION_LEVEL, THREAD_QUESTION);
    console.log(`[belonging] target thread uuid=${uuid} collection=${COLLECTION_ID} level=${QUESTION_LEVEL}`);

    console.log('[belonging] loading NARRATOR chunks...');
    const chunks = await loadNarratorChunks(client, COLLECTION_ID);
    console.log(`[belonging] ${chunks.length} narrator chunks loaded`);

    const candidates: Candidate[] = [];
    for (const chunk of chunks) {
      const hit = findBelongingMatch(chunk);
      if (!hit) continue;
      candidates.push({
        chunk,
        matchedQuestion: hit.question,
        matchedLevel: hit.level,
        patternIndex: hit.patternIndex,
      });
    }
    console.log(`[belonging] ${candidates.length} chunks have a belonging-themed Pass 0 question`);

    const sourcesAll = new Set(candidates.map((c) => c.chunk.theirstory_id));
    console.log(`[belonging] those chunks span ${sourcesAll.size} sources`);

    const picked = pickMembers(candidates);
    const sourcesPicked = new Set(picked.map((c) => c.chunk.theirstory_id));
    console.log(`[belonging] picked ${picked.length} members across ${sourcesPicked.size} sources`);
    for (const c of picked) {
      const tid = c.chunk.theirstory_id.slice(0, 8);
      const cid = c.chunk.uuid.slice(0, 8);
      console.log(
        `   - ${c.matchedLevel} pat=${c.patternIndex} src=${tid} chunk=${cid} q="${c.matchedQuestion.slice(0, 90)}"`,
      );
    }

    await clearExistingBelongingThread(client, uuid);
    await writeThread(client, uuid, picked, sourcesPicked);
    console.log(`[belonging] wrote Belonging thread ${uuid.slice(0, 8)} with ${picked.length} members.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
