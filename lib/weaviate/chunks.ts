'use server';

import { initWeaviateClient } from './client';
import { Chunks, SchemaTypes } from '@/types/weaviate';
import type { FilterValue } from 'weaviate-client';

export type ChunkRow = {
  uuid: string;
  theirstory_id: string;
  start_time: number;
  end_time: number;
  transcription: string;
  speaker: string;
  speaker_role: string;
  section_title: string;
  narrative_segment_id: string;
  segment_summary: string;
  question_facts: string[];
  question_feelings: string[];
  question_identity: string[];
  question_source_level: string;
};

/** Fetch every chunk for a testimony, ordered by start_time. Used by the
 * chapter list, spark dividers, and the "this chapter is also asked in N
 * recordings" callouts on the testimony page.
 */
export async function getChunksForTestimony(theirstoryId: string): Promise<ChunkRow[]> {
  if (!theirstoryId) return [];

  const client = await initWeaviateClient();
  const collection = client.collections.get<Chunks>(SchemaTypes.Chunks);
  const filter = (
    collection as unknown as {
      filter: { byProperty: (p: string) => { equal: (v: string) => FilterValue } };
    }
  ).filter;

  const response = await collection.query.fetchObjects({
    limit: 5000,
    filters: filter.byProperty('theirstory_id').equal(theirstoryId),
  });

  const rows: ChunkRow[] = response.objects.map((obj) => {
    const p = (obj.properties ?? {}) as Partial<Chunks>;
    return {
      uuid: (obj.uuid as string) ?? '',
      theirstory_id: (p.theirstory_id as string) ?? '',
      start_time: Number(p.start_time ?? 0),
      end_time: Number(p.end_time ?? 0),
      transcription: (p.transcription as string) ?? '',
      speaker: (p.speaker as string) ?? '',
      speaker_role: ((p.speaker_role as string) ?? '').toUpperCase(),
      section_title: (p.section_title as string) ?? '',
      narrative_segment_id: (p.narrative_segment_id as string) ?? '',
      segment_summary: (p.segment_summary as string) ?? '',
      question_facts: Array.isArray(p.question_facts) ? (p.question_facts as string[]) : [],
      question_feelings: Array.isArray(p.question_feelings) ? (p.question_feelings as string[]) : [],
      question_identity: Array.isArray(p.question_identity) ? (p.question_identity as string[]) : [],
      question_source_level: (p.question_source_level as string) ?? '',
    };
  });

  rows.sort((a, b) => a.start_time - b.start_time);
  return rows;
}
