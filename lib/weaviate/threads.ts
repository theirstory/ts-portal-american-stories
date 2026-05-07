'use server';

import { initWeaviateClient } from './client';
import { Chunks, QuestionThreads, SchemaTypes } from '@/types/weaviate';
import type { FilterValue, WeaviateGenericObject } from 'weaviate-client';

export type ThreadRecord = {
  uuid: string;
  properties: Partial<QuestionThreads>;
};

const PUBLISHED_ONLY = (process.env.QUESTION_THREADS_PUBLISHED_ONLY ?? 'false') === 'true';

function maybePublishedFilter(collection: {
  filter: { byProperty: (p: string) => { equal: (v: boolean) => FilterValue } };
}): FilterValue | undefined {
  if (!PUBLISHED_ONLY) return undefined;
  return collection.filter.byProperty('published').equal(true);
}

/** Top threads for the home page word cloud, sorted by source_count desc.
 * Defaults to all levels; pass `level` to narrow (FACTS / FEELINGS / IDENTITY).
 */
export async function getTopThreads(limit = 24, level?: 'FACTS' | 'FEELINGS' | 'IDENTITY'): Promise<ThreadRecord[]> {
  const client = await initWeaviateClient();
  const collection = client.collections.get<QuestionThreads>(SchemaTypes.QuestionThreads);
  const filter = (
    collection as unknown as {
      filter: { byProperty: (p: string) => { equal: (v: any) => FilterValue } };
    }
  ).filter;

  const filters: FilterValue[] = [];
  const published = maybePublishedFilter(filter as any);
  if (published) filters.push(published);
  if (level) filters.push(filter.byProperty('question_level').equal(level));

  const combined: FilterValue | undefined =
    filters.length === 0
      ? undefined
      : filters.length === 1
        ? filters[0]
        : ({ operator: 'And', filters, value: true } as FilterValue);

  const response = await collection.query.fetchObjects({
    limit,
    filters: combined,
  });

  const records: ThreadRecord[] = response.objects.map((obj) => ({
    uuid: obj.uuid as string,
    properties: obj.properties as Partial<QuestionThreads>,
  }));

  records.sort((a, b) => {
    const sa = (a.properties.source_count as number | undefined) ?? 0;
    const sb = (b.properties.source_count as number | undefined) ?? 0;
    return sb - sa;
  });

  return records;
}

/** Fetch a single canonical thread by Weaviate UUID. */
export async function fetchThreadByUuid(uuid: string): Promise<ThreadRecord | null> {
  if (!uuid) return null;
  const client = await initWeaviateClient();
  const collection = client.collections.get<QuestionThreads>(SchemaTypes.QuestionThreads);
  const obj = await collection.query.fetchObjectById(uuid);
  if (!obj) return null;
  return { uuid: obj.uuid ?? uuid, properties: obj.properties as Partial<QuestionThreads> };
}

/** Find every chunk that answers a thread. The answeredByChunks cross-ref
 * is one-directional (only on QuestionThreads), so we resolve via the thread's
 * references API rather than a chunk-side filter.
 */
export async function searchChunksByThreadUuid(
  threadUuid: string,
  opts: { limit?: number } = {},
): Promise<WeaviateGenericObject<Chunks, any>[]> {
  if (!threadUuid) return [];
  const { limit = 200 } = opts;

  const client = await initWeaviateClient();
  const chunkCollection = client.collections.get<Chunks>(SchemaTypes.Chunks);
  const threadCollection = client.collections.get<QuestionThreads>(SchemaTypes.QuestionThreads);
  const threadObj = await threadCollection.query.fetchObjectById(threadUuid, {
    returnReferences: [{ linkOn: 'answeredByChunks' }],
  });
  if (!threadObj) return [];
  const linked =
    (threadObj.references as Record<string, { objects: { uuid: string }[] }> | undefined)?.answeredByChunks?.objects ??
    [];
  const ids = linked
    .map((l) => l.uuid)
    .filter(Boolean)
    .slice(0, limit);
  if (ids.length === 0) return [];

  const results = await Promise.all(ids.map((id) => chunkCollection.query.fetchObjectById(id).catch(() => null)));
  return results.filter((r): r is WeaviateGenericObject<Chunks, any> => r !== null);
}

export type ThreadModalChunk = {
  chunk_uuid: string;
  theirstory_id: string;
  interview_title: string;
  start_time: number;
  end_time: number;
  transcription: string;
  segment_summary?: string;
};

export type ThreadModalRecording = {
  theirstory_id: string;
  interview_title: string;
  excerpts: ThreadModalChunk[];
};

export type ThreadModalData = {
  thread: ThreadRecord;
  recordings: ThreadModalRecording[];
};

/** Single-call helper for the home page ThreadModal. Returns the canonical
 * thread + every NARRATOR-spoken chunk that answers it, grouped by testimony
 * (one row per recording, each carrying its excerpts in start_time order).
 *
 * INTERVIEWER chunks are filtered out of the modal display so users see the
 * narrator's answer rather than the interviewer's question. If the thread has
 * zero narrator chunks (extreme edge case) we fall back to all chunks so the
 * modal still shows something rather than going empty.
 */
export async function getThreadModalData(threadUuid: string): Promise<ThreadModalData | null> {
  const thread = await fetchThreadByUuid(threadUuid);
  if (!thread) return null;

  const chunks = await searchChunksByThreadUuid(threadUuid, { limit: 50 });

  const isNarrator = (obj: (typeof chunks)[number]) =>
    String((obj.properties as Partial<Chunks>).speaker_role ?? '').toUpperCase() === 'NARRATOR';

  const narratorChunks = chunks.filter(isNarrator);
  const sourceChunks = narratorChunks.length > 0 ? narratorChunks : chunks;

  const byTestimony = new Map<string, ThreadModalRecording>();
  for (const obj of sourceChunks) {
    const props = obj.properties as Partial<Chunks>;
    const theirstoryId = (props.theirstory_id as string) ?? '';
    if (!theirstoryId) continue;
    const excerpt: ThreadModalChunk = {
      chunk_uuid: obj.uuid as string,
      theirstory_id: theirstoryId,
      interview_title: (props.interview_title as string) ?? 'Untitled recording',
      start_time: Number(props.start_time ?? 0),
      end_time: Number(props.end_time ?? 0),
      transcription: (props.transcription as string) ?? '',
      segment_summary: (props.segment_summary as string) || undefined,
    };
    let row = byTestimony.get(theirstoryId);
    if (!row) {
      row = {
        theirstory_id: theirstoryId,
        interview_title: excerpt.interview_title,
        excerpts: [],
      };
      byTestimony.set(theirstoryId, row);
    }
    row.excerpts.push(excerpt);
  }

  for (const row of byTestimony.values()) {
    row.excerpts.sort((a, b) => a.start_time - b.start_time);
  }

  return { thread, recordings: Array.from(byTestimony.values()) };
}
