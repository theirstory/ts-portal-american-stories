'use server';

import { initWeaviateClient } from './client';
import { Chunks, QuestionThreads, SchemaTypes } from '@/types/weaviate';
import type { FilterValue, WeaviateGenericObject } from 'weaviate-client';
import { findThroughlineCuration } from '@/config/throughlineCuration';

export type ThreadRecord = {
  uuid: string;
  properties: Partial<QuestionThreads>;
  /** Curated display label (replaces theme_label in UI). */
  display_label?: string;
  /** Curated brief description, not phrased as a question. */
  display_description?: string;
};

const PUBLISHED_ONLY = (process.env.QUESTION_THREADS_PUBLISHED_ONLY ?? 'false') === 'true';

function maybePublishedFilter(collection: {
  filter: { byProperty: (p: string) => { equal: (v: boolean) => FilterValue } };
}): FilterValue | undefined {
  if (!PUBLISHED_ONLY) return undefined;
  return collection.filter.byProperty('published').equal(true);
}

// Tone guard — drop throughlines that frame the country / government /
// institutions as the antagonist. The archive deals with struggle, but
// the throughline language should sit in personal experience and
// meaning-making, not "America as villain". Patterns are intentionally
// conservative; refine here when something slips through.
const TONE_REJECT_PATTERNS: RegExp[] = [
  /deny(?:ing)?\s+(?:your|their|the speaker['’]s)?\s*belonging/i,
  /denies?\s+belonging/i,
  /(?:country|nation|government|america)[^.?!]{0,40}\b(?:deny|denies|denying|denied|reject|rejects|rejected|excludes?|excluded|oppress(?:es|ed)?)/i,
  /\bdenied\s+(?:by|from)\s+(?:the\s+)?(?:country|nation|government|america)/i,
  /\bvillain(?:ize|ized|izing)?\b/i,
];

function isAcceptableTone(thread: { thread_question?: string | null; theme_label?: string | null }): boolean {
  const haystack = `${thread.thread_question ?? ''} ${thread.theme_label ?? ''}`;
  return !TONE_REJECT_PATTERNS.some((re) => re.test(haystack));
}

/** Curate + dedupe a list of throughlines for the demo. Anything not on the
 * curation list is dropped. Multiple records that map to the same curation
 * entry collapse to the strongest (highest source_count) — they're variants
 * of the same theme and showing both is noise.
 *
 * Returned items carry `display_label` + `display_description` so consumers
 * don't repeat curation lookups.
 */
function curateAndDedupe<
  T extends { uuid: string; thread_question?: string | null; theme_label?: string | null; source_count?: number },
>(threads: T[]): Array<T & { display_label: string; display_description: string }> {
  const winnerByLabel = new Map<string, T & { display_label: string; display_description: string }>();
  for (const t of threads) {
    const entry = findThroughlineCuration({ theme_label: t.theme_label, thread_question: t.thread_question });
    if (!entry) continue;
    const decorated = { ...t, display_label: entry.label, display_description: entry.description };
    const existing = winnerByLabel.get(entry.label);
    if (!existing || (decorated.source_count ?? 0) > (existing.source_count ?? 0)) {
      winnerByLabel.set(entry.label, decorated);
    }
  }
  return Array.from(winnerByLabel.values());
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

  const flat = response.objects
    .map((obj) => {
      const p = obj.properties as Partial<QuestionThreads>;
      return {
        uuid: obj.uuid as string,
        properties: p,
        thread_question: (p.thread_question as string) ?? '',
        theme_label: (p.theme_label as string) ?? '',
        source_count: (p.source_count as number) ?? 0,
      };
    })
    .filter((r) => isAcceptableTone({ thread_question: r.thread_question, theme_label: r.theme_label }));

  const curated = curateAndDedupe(flat);
  const records: ThreadRecord[] = curated.map((c) => ({
    uuid: c.uuid,
    properties: c.properties,
    display_label: c.display_label,
    display_description: c.display_description,
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
  /** Mux/HLS source URL — used to render a small thumbnail next to the title
   * so the eye distinguishes recordings at a glance. */
  video_url?: string;
  /** True when the recording is audio-only (no thumbnail to render). */
  isAudioFile?: boolean;
  /** Total duration in seconds, for the optional duration badge. */
  interview_duration?: number;
  excerpts: ThreadModalChunk[];
};

export type ThreadModalData = {
  thread: ThreadRecord;
  recordings: ThreadModalRecording[];
};

export type ThreadSummary = {
  uuid: string;
  thread_question: string;
  theme_label: string;
  question_level: string;
  source_count: number;
  /** Curated display label (replaces theme_label in UI). */
  display_label?: string;
  /** Curated brief description, not phrased as a question. */
  display_description?: string;
  /** How many chunks within the *current* chapter this thread touches.
   * Used to sort by local relevance so different chapters surface different
   * threads instead of all picking the globally dominant one.
   */
  local_chunk_count?: number;
};

/** For a single testimony, returns a Map<sectionStart, ThreadSummary[]>
 * describing which cross-source threads each chapter contributes to.
 *
 * Strategy: pull every thread (with answeredByChunks references) in one
 * batch, intersect with the testimony's chunks (mapped to chapters by
 * start_time), then group. Cheap because thread count is small (<100) and
 * everything reads through warm in-memory data after the initial fetch.
 */
export async function getThreadsByChapterForTestimony(
  theirstoryId: string,
  sections: Array<{ start: number; end: number }>,
): Promise<Map<number, ThreadSummary[]>> {
  const out = new Map<number, ThreadSummary[]>();
  if (!theirstoryId || sections.length === 0) return out;

  const client = await initWeaviateClient();
  const threadCollection = client.collections.get<QuestionThreads>(SchemaTypes.QuestionThreads);
  const chunkCollection = client.collections.get<Chunks>(SchemaTypes.Chunks);

  const chunkFilter = (
    chunkCollection as unknown as {
      filter: { byProperty: (p: string) => { equal: (v: string) => FilterValue } };
    }
  ).filter.byProperty;

  // 1. Pull every chunk for this testimony just to know each chunk's start_time.
  const chunkResp = await chunkCollection.query.fetchObjects({
    limit: 5000,
    filters: chunkFilter('theirstory_id').equal(theirstoryId),
  });
  const startByChunkUuid = new Map<string, number>();
  for (const obj of chunkResp.objects) {
    const start = Number((obj.properties as Partial<Chunks>)?.start_time ?? 0);
    startByChunkUuid.set(obj.uuid as string, start);
  }
  if (startByChunkUuid.size === 0) return out;

  // 2. Pull every thread + its answeredByChunks references in one batch.
  const threadResp = await threadCollection.query.fetchObjects({
    limit: 500,
    returnReferences: [{ linkOn: 'answeredByChunks' }],
  });

  const findSection = (start: number) => sections.find((s) => start >= s.start && start < s.end);

  for (const thread of threadResp.objects) {
    const refs =
      (thread.references as Record<string, { objects: { uuid: string }[] }> | undefined)?.answeredByChunks?.objects ??
      [];
    const localChunkUuids = refs.map((r) => r.uuid).filter((u) => startByChunkUuid.has(u));
    if (localChunkUuids.length === 0) continue;

    // Tally chunks per chapter so we know how strongly the thread is rooted
    // in each chapter (vs. just brushing through with one chunk).
    const chunkCountBySection = new Map<number, number>();
    for (const cu of localChunkUuids) {
      const start = startByChunkUuid.get(cu);
      if (start === undefined) continue;
      const section = findSection(start);
      if (!section) continue;
      chunkCountBySection.set(section.start, (chunkCountBySection.get(section.start) ?? 0) + 1);
    }

    const props = thread.properties as Partial<QuestionThreads>;
    const baseSummary = {
      uuid: thread.uuid as string,
      thread_question: (props.thread_question as string) ?? '',
      theme_label: (props.theme_label as string) ?? '',
      question_level: (props.question_level as string) ?? '',
      source_count: (props.source_count as number) ?? 0,
    };
    if (!isAcceptableTone(baseSummary)) continue;

    for (const [sectionStart, localCount] of chunkCountBySection) {
      if (!out.has(sectionStart)) out.set(sectionStart, []);
      out.get(sectionStart)!.push({ ...baseSummary, local_chunk_count: localCount });
    }
  }

  // Sort each chapter's threads by *local* chunk count desc (the thread that
  // sits most thickly in this chapter wins the badge). Tiebreak on global
  // source_count so a 1-chunk-vs-1-chunk tie still picks the broader
  // cross-source thread.
  for (const list of out.values()) {
    list.sort((a, b) => {
      const localDiff = (b.local_chunk_count ?? 0) - (a.local_chunk_count ?? 0);
      if (localDiff !== 0) return localDiff;
      return b.source_count - a.source_count;
    });
  }

  return out;
}

/** Flat list of every throughline (cross-source thread) this testimony
 * participates in. Ranked by source_count desc. Used by the testimony page's
 * Throughlines tab.
 */
export async function getThreadsForTestimony(theirstoryId: string): Promise<ThreadSummary[]> {
  if (!theirstoryId) return [];

  const client = await initWeaviateClient();
  const threadCollection = client.collections.get<QuestionThreads>(SchemaTypes.QuestionThreads);
  const chunkCollection = client.collections.get<Chunks>(SchemaTypes.Chunks);

  const chunkFilter = (
    chunkCollection as unknown as {
      filter: { byProperty: (p: string) => { equal: (v: string) => FilterValue } };
    }
  ).filter.byProperty;

  const chunkResp = await chunkCollection.query.fetchObjects({
    limit: 5000,
    filters: chunkFilter('theirstory_id').equal(theirstoryId),
  });
  const localChunkUuids = new Set<string>(chunkResp.objects.map((o) => o.uuid as string));
  if (localChunkUuids.size === 0) return [];

  const threadResp = await threadCollection.query.fetchObjects({
    limit: 500,
    returnReferences: [{ linkOn: 'answeredByChunks' }],
  });

  const candidates: ThreadSummary[] = [];
  for (const thread of threadResp.objects) {
    const refs =
      (thread.references as Record<string, { objects: { uuid: string }[] }> | undefined)?.answeredByChunks?.objects ??
      [];
    const localCount = refs.filter((r) => localChunkUuids.has(r.uuid)).length;
    if (localCount === 0) continue;
    const props = thread.properties as Partial<QuestionThreads>;
    const summary: ThreadSummary = {
      uuid: thread.uuid as string,
      thread_question: (props.thread_question as string) ?? '',
      theme_label: (props.theme_label as string) ?? '',
      question_level: (props.question_level as string) ?? '',
      source_count: (props.source_count as number) ?? 0,
      local_chunk_count: localCount,
    };
    if (!isAcceptableTone(summary)) continue;
    candidates.push(summary);
  }

  // Curate + dedupe by curation entry. local_chunk_count needs to survive the
  // dedupe — keep the entry whose local count is highest (best signal "in
  // this recording"). We do dedupe manually here rather than via the generic
  // helper so we can choose the local-strongest variant.
  const winnerByLabel = new Map<string, ThreadSummary & { display_label: string; display_description: string }>();
  for (const c of candidates) {
    const entry = findThroughlineCuration({ theme_label: c.theme_label, thread_question: c.thread_question });
    if (!entry) continue;
    const decorated = { ...c, display_label: entry.label, display_description: entry.description };
    const existing = winnerByLabel.get(entry.label);
    if (!existing || (decorated.local_chunk_count ?? 0) > (existing.local_chunk_count ?? 0)) {
      winnerByLabel.set(entry.label, decorated);
    }
  }
  const out = Array.from(winnerByLabel.values());

  out.sort((a, b) => b.source_count - a.source_count);
  return out;
}

/** Single-call helper for the throughline modal. Returns the canonical
 * thread + every NARRATOR-spoken chunk that answers it, grouped by testimony
 * (one row per recording, each carrying its excerpts in start_time order).
 *
 * INTERVIEWER chunks are filtered out of the modal display so users see the
 * narrator's answer rather than the interviewer's question. If the thread has
 * zero narrator chunks (extreme edge case) we fall back to all chunks so the
 * modal still shows something rather than going empty.
 */
export async function getThreadModalData(
  threadUuid: string,
  currentStoryUuid?: string,
): Promise<ThreadModalData | null> {
  const thread = await fetchThreadByUuid(threadUuid);
  if (!thread) return null;
  // Tone gate — if the canonical thread itself is flagged, treat the modal
  // as if the throughline doesn't exist. Same rule as the list views, so
  // links to a hidden throughline don't open it.
  if (
    !isAcceptableTone({
      thread_question: thread.properties.thread_question as string | undefined,
      theme_label: thread.properties.theme_label as string | undefined,
    })
  ) {
    return null;
  }
  // Curation gate — if the throughline isn't on the demo's curated list,
  // pretend it doesn't exist. Otherwise decorate with display_label/desc so
  // the modal can show the editorial copy instead of the raw question.
  const curation = findThroughlineCuration({
    theme_label: thread.properties.theme_label as string | undefined,
    thread_question: thread.properties.thread_question as string | undefined,
  });
  if (!curation) return null;
  thread.display_label = curation.label;
  thread.display_description = curation.description;

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
        video_url: (props.video_url as string) || undefined,
        isAudioFile: Boolean(props.isAudioFile),
        interview_duration:
          typeof props.interview_duration === 'number' ? (props.interview_duration as number) : undefined,
        excerpts: [],
      };
      byTestimony.set(theirstoryId, row);
    }
    row.excerpts.push(excerpt);
  }

  for (const row of byTestimony.values()) {
    row.excerpts.sort((a, b) => a.start_time - b.start_time);
  }

  // Pin the current recording first when one is provided; the rest sort by
  // excerpt count desc so the most-resonant other recordings come next.
  const recordings = Array.from(byTestimony.values()).sort((a, b) => {
    const aCurrent = currentStoryUuid && a.theirstory_id === currentStoryUuid ? 1 : 0;
    const bCurrent = currentStoryUuid && b.theirstory_id === currentStoryUuid ? 1 : 0;
    if (aCurrent !== bCurrent) return bCurrent - aCurrent;
    return b.excerpts.length - a.excerpts.length;
  });

  return { thread, recordings };
}
