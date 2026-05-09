/**
 * Build a deterministic "Personal Identity" QuestionThread.
 *
 * Mirrors scripts/buildBelongingThread.ts. Pass 2's "Defining Self" cluster
 * tends to land at 3 sources / 3 chunks because the LLM-clusterer strands
 * questions about claiming-your-own-identity that didn't sit close enough to
 * the seed in vector space. We've got dozens of NARRATOR chunks across the
 * archive whose Pass 0 questions are unambiguously about personal identity
 * — pressure from how others see you, standing firm in your own sense of
 * self, defining yourself on your own terms — they just weren't all rolled
 * into the same thread.
 *
 * This script scans every NARRATOR chunk's Pass 0 questions, keeps the
 * ones that match a curated set of "personal identity" patterns, picks
 * across sources for breadth, and writes one QuestionThreads row with
 * those chunks as `answeredByChunks` members. The curation in
 * config/throughlineCuration.ts already maps "personal identity" /
 * "defining self" / "shaping identity" themes to the Personal Identity
 * chip, so this thread (with source_count > the existing Defining Self
 * thread's 3) will win curateAndDedupe and become the chip's destination.
 *
 * Run:  yarn build:personal-identity-thread
 * Workflow:  yarn pass2:run → yarn build:belonging-thread →
 *            yarn build:personal-identity-thread
 *            (Pass 2 wipes prior threads on each run, so the custom
 *            threads need to be rebuilt afterward.)
 */

import weaviate, { type WeaviateClient } from 'weaviate-client';
import { createHash } from 'node:crypto';

const COLLECTION_ID = process.env.PERSONAL_IDENTITY_COLLECTION_ID ?? 'american-stories';
const THREAD_QUESTION = 'When others have tried to define who you are, what does it take to claim your own identity?';
const THEME_LABEL = 'Personal Identity';
const QUESTION_LEVEL = 'IDENTITY';
const CONVERGENCE = 'DIVERGE';

const THREAD_NAMESPACE = '8f8a8a40-narrative-pipeline-question-threads';
const MAX_CHUNKS_PER_SOURCE = 2;
const MAX_TOTAL_CHUNKS = 18;

/** Patterns we treat as "this question is about personal identity". Earlier
 * patterns are stronger — `patternIndex` 0 wins over later matches when a
 * chunk's question matches several. The list is intentionally narrow:
 * generic "identity" hits would bleed into Family Roots / Belonging, so we
 * only catch phrasing that clearly centers on the narrator's own
 * self-definition. */
const PERSONAL_IDENTITY_PATTERNS: string[] = [
  'sense of self',
  'who you are',
  'your own identity',
  'claim your',
  'claim their',
  'define yourself',
  'define who',
  'defining self',
  'self-definition',
  'self definition',
  'self-perception',
  'self perception',
  'personal identity',
  'stand firm',
  'stand your ground',
  'push back',
  'pushed back',
  'pushing back',
  'assert your',
  'asserting your',
  'how others define',
  'how others see',
  'others see you',
  'questioning your loyalty',
  'shaping identity',
  'shaping selfhood',
  'shape your sense',
  'shaped who you',
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
  patternIndex: number;
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

function findPersonalIdentityMatch(
  chunk: ChunkRow,
): { question: string; level: 'FACTS' | 'FEELINGS' | 'IDENTITY'; patternIndex: number } | null {
  // IDENTITY → FEELINGS → FACTS: identity-level questions about claiming
  // selfhood are the strongest signal.
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
      for (let i = 0; i < PERSONAL_IDENTITY_PATTERNS.length; i += 1) {
        if (!lower.includes(PERSONAL_IDENTITY_PATTERNS[i])) continue;
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
  const sorted = [...candidates].sort((a, b) => a.patternIndex - b.patternIndex);
  const perSource = new Map<string, number>();
  const picked: Candidate[] = [];
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

async function clearExistingThread(client: WeaviateClient, uuid: string): Promise<void> {
  const collection = client.collections.get('QuestionThreads');
  try {
    const existing = await collection.query.fetchObjectById(uuid);
    if (existing) {
      await collection.data.deleteById(uuid);
      console.log(`[personal-identity] removed previous thread ${uuid.slice(0, 8)}`);
    }
  } catch {
    // missing id is fine
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
    console.log(`[personal-identity] target thread uuid=${uuid} collection=${COLLECTION_ID} level=${QUESTION_LEVEL}`);

    console.log('[personal-identity] loading NARRATOR chunks...');
    const chunks = await loadNarratorChunks(client, COLLECTION_ID);
    console.log(`[personal-identity] ${chunks.length} narrator chunks loaded`);

    const candidates: Candidate[] = [];
    for (const chunk of chunks) {
      const hit = findPersonalIdentityMatch(chunk);
      if (!hit) continue;
      candidates.push({
        chunk,
        matchedQuestion: hit.question,
        matchedLevel: hit.level,
        patternIndex: hit.patternIndex,
      });
    }
    console.log(`[personal-identity] ${candidates.length} chunks match personal-identity patterns`);

    const sourcesAll = new Set(candidates.map((c) => c.chunk.theirstory_id));
    console.log(`[personal-identity] those chunks span ${sourcesAll.size} sources`);

    const picked = pickMembers(candidates);
    const sourcesPicked = new Set(picked.map((c) => c.chunk.theirstory_id));
    console.log(`[personal-identity] picked ${picked.length} members across ${sourcesPicked.size} sources`);
    for (const c of picked) {
      const tid = c.chunk.theirstory_id.slice(0, 8);
      const cid = c.chunk.uuid.slice(0, 8);
      console.log(
        `   - ${c.matchedLevel} pat=${c.patternIndex} src=${tid} chunk=${cid} q="${c.matchedQuestion.slice(0, 90)}"`,
      );
    }

    await clearExistingThread(client, uuid);
    await writeThread(client, uuid, picked, sourcesPicked);
    console.log(
      `[personal-identity] wrote Personal Identity thread ${uuid.slice(0, 8)} with ${picked.length} members.`,
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
