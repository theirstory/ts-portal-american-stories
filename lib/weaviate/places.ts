'use server';

import { initWeaviateClient } from './client';
import { Entities, EntityMention, Chunks, SchemaTypes } from '@/types/weaviate';
import type { FilterValue } from 'weaviate-client';

const ARTICLES = new Set(['the', 'a', 'an']);

/** Treat a canonical_form as a *named place* only when its first non-article
 * token starts with an uppercase letter. Catches "concentration camp" and
 * "courthouse building" while keeping "the Mississippi River", "the States",
 * and properly title-cased forms. The map should only pin named places —
 * generic noun phrases hallucinated as PLACE muddy the geography.
 */
function isNamedPlace(canonicalForm: string): boolean {
  const trimmed = (canonicalForm ?? '').trim();
  if (trimmed.length < 2) return false;
  const tokens = trimmed.split(/\s+/);
  let i = 0;
  while (i < tokens.length && ARTICLES.has(tokens[i].toLowerCase())) i += 1;
  const head = tokens[i] ?? '';
  if (!head) return false;
  const firstChar = head.charAt(0);
  return firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
}

export type PlaceMarker = {
  entity_uuid: string;
  canonical_form: string;
  lat: number;
  lon: number;
  /** Distinct testimonies that mention this place. */
  recording_count: number;
  /** Total mentions across the project. */
  mention_count: number;
  /** Wikidata QID and URL when the place was canonically reconciled. */
  wikidata_qid: string | null;
  wikidata_url: string | null;
  context_summary?: string;
};

/** Fetch every PLACE entity with persisted Wikidata coordinates and pair
 * with project-wide mention/recording counts so the map can size pins by
 * reach. Coordinates come from the Entities row itself (written by
 * scripts/enrichPlaceWikidata.ts), so this is a pure DB read — no live
 * Wikidata calls at request time.
 */
export async function getPlaceEntitiesForMap(): Promise<PlaceMarker[]> {
  const client = await initWeaviateClient();

  const entityCollection = client.collections.get<Entities>(SchemaTypes.Entities);
  const chunkCollection = client.collections.get<Chunks>(SchemaTypes.Chunks);
  const filter = (
    entityCollection as unknown as {
      filter: { byProperty: (p: string) => { equal: (v: string) => FilterValue } };
    }
  ).filter.byProperty;

  // 1. Pull every PLACE entity. We read coordinates from the row directly
  // rather than hitting Wikidata at request time.
  const entityResp = await entityCollection.query.fetchObjects({
    limit: 5000,
    filters: filter('entity_type').equal('PLACE'),
  });
  const places = entityResp.objects
    .map((obj) => {
      const p = obj.properties as Partial<Entities>;
      return {
        entity_uuid: obj.uuid as string,
        canonical_form: (p.canonical_form as string) ?? '',
        wikidata_qid: (p.linked_data_qid as string | null) ?? null,
        wikidata_url: (p.linked_data_url as string | null) ?? null,
        context_summary: (p.context_summary as string) || undefined,
        latitude: typeof p.latitude === 'number' ? (p.latitude as number) : null,
        longitude: typeof p.longitude === 'number' ? (p.longitude as number) : null,
      };
    })
    .filter((e) => e.canonical_form && isNamedPlace(e.canonical_form) && e.latitude != null && e.longitude != null);

  if (places.length === 0) return [];

  // 2. Tally project-wide mention + recording counts in one chunk pass.
  // Same approach as getTopEntities: scan entity_mentions on every chunk and
  // accumulate counts per entity_uuid.
  const chunkResp = await chunkCollection.query.fetchObjects({ limit: 4000 });
  type Tally = { mentions: number; testimonies: Set<string> };
  const tallyByUuid = new Map<string, Tally>();
  for (const chunk of chunkResp.objects) {
    const props = chunk.properties as Partial<Chunks>;
    const theirstoryId = (props.theirstory_id as string) ?? '';
    const mentions = props.entity_mentions as EntityMention[] | undefined;
    if (!Array.isArray(mentions)) continue;
    for (const m of mentions) {
      if (!m?.entity_uuid) continue;
      let t = tallyByUuid.get(m.entity_uuid);
      if (!t) {
        t = { mentions: 0, testimonies: new Set<string>() };
        tallyByUuid.set(m.entity_uuid, t);
      }
      t.mentions += 1;
      if (theirstoryId) t.testimonies.add(theirstoryId);
    }
  }

  // 3. Assemble markers using the persisted coordinates.
  const markers: PlaceMarker[] = [];
  for (const place of places) {
    const tally = tallyByUuid.get(place.entity_uuid);
    if (!tally || tally.mentions === 0) continue; // skip entities with no chunk reach
    markers.push({
      entity_uuid: place.entity_uuid,
      canonical_form: place.canonical_form,
      lat: place.latitude as number,
      lon: place.longitude as number,
      recording_count: tally.testimonies.size,
      mention_count: tally.mentions,
      wikidata_qid: place.wikidata_qid,
      wikidata_url: place.wikidata_url,
      context_summary: place.context_summary,
    });
  }

  // Sort by recording_count desc so render order favors the most-cited places.
  markers.sort((a, b) => b.recording_count - a.recording_count);
  return markers;
}
