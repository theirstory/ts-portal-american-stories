'use server';

import { initWeaviateClient } from './client';
import { Chunks, Entities, EntityMention, SchemaTypes } from '@/types/weaviate';
import type { FilterValue, WeaviateGenericObject } from 'weaviate-client';

export type EntityRecord = {
  uuid: string;
  properties: Partial<Entities>;
};

/** Fetch a single canonical entity record by Weaviate UUID. */
export async function fetchEntityByUuid(uuid: string): Promise<EntityRecord | null> {
  if (!uuid) return null;
  const client = await initWeaviateClient();
  const collection = client.collections.get<Entities>(SchemaTypes.Entities);
  const obj = await collection.query.fetchObjectById(uuid);
  if (!obj) return null;
  return { uuid: obj.uuid ?? uuid, properties: obj.properties as Partial<Entities> };
}

/** Bulk-fetch canonical entity records for the given UUIDs (de-duped).
 * Uses parallel single-id fetches because the v4 client's id-filter API isn't
 * uniformly available; per-call latency is low and we typically have ≤30 ids
 * per testimony so the request count stays bounded.
 */
export async function fetchEntitiesByUuids(uuids: string[]): Promise<Map<string, EntityRecord>> {
  const out = new Map<string, EntityRecord>();
  const unique = Array.from(new Set(uuids.filter(Boolean)));
  if (unique.length === 0) return out;

  const client = await initWeaviateClient();
  const collection = client.collections.get<Entities>(SchemaTypes.Entities);

  const results = await Promise.all(unique.map((id) => collection.query.fetchObjectById(id).catch(() => null)));

  results.forEach((obj, i) => {
    if (!obj) return;
    const id = obj.uuid ?? unique[i];
    out.set(id, { uuid: id, properties: obj.properties as Partial<Entities> });
  });
  return out;
}

/** Find every chunk that mentions a given entity. Filters via the
 * `mentionsEntities` cross-ref by entity UUID — Weaviate's nested-object
 * filtering on object[] columns can't reach into entity_mentions.entity_uuid
 * directly, but the cross-ref carries the same canonical link.
 */
export async function searchChunksByEntityUuid(
  entityUuid: string,
  opts: { excludeTestimonyId?: string; limit?: number } = {},
): Promise<WeaviateGenericObject<Chunks, any>[]> {
  if (!entityUuid) return [];
  const { excludeTestimonyId, limit = 200 } = opts;

  const client = await initWeaviateClient();
  const collection = client.collections.get<Chunks>(SchemaTypes.Chunks);
  const filter = (
    collection as unknown as {
      filter: {
        byRef: (linkOn: string) => { byId: () => { equal: (v: string) => FilterValue } };
        byProperty: (p: string) => { notEqual: (v: string) => FilterValue };
      };
    }
  ).filter;

  const filters: FilterValue[] = [filter.byRef('mentionsEntities').byId().equal(entityUuid)];
  if (excludeTestimonyId) {
    filters.push(filter.byProperty('theirstory_id').notEqual(excludeTestimonyId));
  }

  const combined: FilterValue =
    filters.length === 1 ? filters[0] : ({ operator: 'And', filters, value: true } as FilterValue);

  try {
    const response = await collection.query.fetchObjects({
      limit,
      filters: combined,
    });
    return response.objects;
  } catch (err) {
    console.error('searchChunksByEntityUuid failed:', err);
    return [];
  }
}

export type TopEntity = {
  entity_uuid: string;
  canonical_form: string;
  label: string;
  count: number;
  /** Number of distinct testimonies this entity is mentioned in. */
  recording_count: number;
};

export type EntitiesByType = {
  /** Entity type, e.g. PERSON / PLACE / EVENT / INSTITUTION / CULTURAL_ITEM / DATE. */
  type: string;
  entities: TopEntity[];
};

/** Aggregate canonical entity mentions across all chunks and return the top
 * N by mention count. Uses the precise per-occurrence entity_mentions list,
 * so counts reflect actual mentions (not unique chunks). Also tallies the
 * number of distinct testimonies each entity appears in for cross-source
 * filtering downstream. */
export async function getTopEntities(limit = 15, sampleSize = 4000): Promise<TopEntity[]> {
  const client = await initWeaviateClient();
  const collection = client.collections.get<Chunks>(SchemaTypes.Chunks);
  // NB: explicitly listing entity_mentions in returnProperties triggers a
  // gRPC proto serialization error against object[] columns. Pull all props.
  const response = await collection.query.fetchObjects({ limit: sampleSize });

  type Acc = TopEntity & { _testimonies: Set<string> };
  const counts = new Map<string, Acc>();
  for (const obj of response.objects) {
    const props = (obj.properties as Partial<Chunks>) ?? {};
    const theirstoryId = (props.theirstory_id as string) ?? '';
    const mentions = props.entity_mentions as EntityMention[] | undefined;
    if (!Array.isArray(mentions)) continue;
    for (const m of mentions) {
      if (!m?.entity_uuid || !m.canonical_form) continue;
      let existing = counts.get(m.entity_uuid);
      if (!existing) {
        existing = {
          entity_uuid: m.entity_uuid,
          canonical_form: m.canonical_form,
          label: m.label,
          count: 0,
          recording_count: 0,
          _testimonies: new Set<string>(),
        };
        counts.set(m.entity_uuid, existing);
      }
      existing.count += 1;
      if (theirstoryId) existing._testimonies.add(theirstoryId);
    }
  }

  return Array.from(counts.values())
    .map(({ _testimonies, ...rest }) => ({ ...rest, recording_count: _testimonies.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Every entity in the project, grouped by entity_type, with mention and
 * recording counts. Single chunk-scan (same as getTopEntities) so cost is
 * the same regardless of entity count. Used by the /throughlines page's
 * Entities browse panel.
 */
export async function getEntitiesGroupedByType(sampleSize = 4000): Promise<EntitiesByType[]> {
  const client = await initWeaviateClient();
  const collection = client.collections.get<Chunks>(SchemaTypes.Chunks);
  const response = await collection.query.fetchObjects({ limit: sampleSize });

  type Acc = TopEntity & { _testimonies: Set<string> };
  const counts = new Map<string, Acc>();
  for (const obj of response.objects) {
    const props = (obj.properties as Partial<Chunks>) ?? {};
    const theirstoryId = (props.theirstory_id as string) ?? '';
    const mentions = props.entity_mentions as EntityMention[] | undefined;
    if (!Array.isArray(mentions)) continue;
    for (const m of mentions) {
      if (!m?.entity_uuid || !m.canonical_form) continue;
      let existing = counts.get(m.entity_uuid);
      if (!existing) {
        existing = {
          entity_uuid: m.entity_uuid,
          canonical_form: m.canonical_form,
          label: m.label,
          count: 0,
          recording_count: 0,
          _testimonies: new Set<string>(),
        };
        counts.set(m.entity_uuid, existing);
      }
      existing.count += 1;
      if (theirstoryId) existing._testimonies.add(theirstoryId);
    }
  }

  // Group by entity type, then sort each group by recording_count desc so the
  // most-cross-source entities float to the top of each section.
  const byType = new Map<string, TopEntity[]>();
  for (const acc of counts.values()) {
    const flat: TopEntity = {
      entity_uuid: acc.entity_uuid,
      canonical_form: acc.canonical_form,
      label: acc.label,
      count: acc.count,
      recording_count: acc._testimonies.size,
    };
    const type = flat.label || 'OTHER';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(flat);
  }

  for (const list of byType.values()) {
    list.sort((a, b) => {
      if (b.recording_count !== a.recording_count) return b.recording_count - a.recording_count;
      if (b.count !== a.count) return b.count - a.count;
      return a.canonical_form.localeCompare(b.canonical_form);
    });
  }

  // Stable presentation order — most "human" types first.
  const ORDER = ['PERSON', 'PLACE', 'EVENT', 'INSTITUTION', 'CULTURAL_ITEM', 'DATE', 'ORGANIZATION'];
  const out: EntitiesByType[] = [];
  for (const type of ORDER) {
    if (byType.has(type)) out.push({ type, entities: byType.get(type)! });
  }
  // Anything not in the canonical order list trails alphabetically.
  for (const [type, entities] of byType) {
    if (ORDER.includes(type)) continue;
    out.push({ type, entities });
  }
  return out;
}

/** Top entities that appear in at least `minRecordings` distinct testimonies.
 * Useful for the home page cloud — single-recording entities are noisy there;
 * the connective tissue (entities multiple sources mention) is the signal.
 */
export async function getTopCrossSourceEntities(
  limit = 15,
  minRecordings = 2,
  sampleSize = 4000,
): Promise<TopEntity[]> {
  // Pull a wider set then filter so we can still hit `limit` after the
  // cross-source filter knocks out single-recording entities.
  const broad = await getTopEntities(limit * 4, sampleSize);
  return broad.filter((e) => e.recording_count >= minRecordings).slice(0, limit);
}

/** Returns how many distinct testimonies mention each entity_uuid.
 * Filters chunks via the `mentionsEntities` cross-ref (canonical) and counts
 * unique theirstory_ids. Runs queries in parallel — sequential would be
 * ~30 entities × ~200ms = 6s of skeleton; parallel collapses to roughly
 * the slowest single query.
 */
export async function getEntityRecordingCounts(uuids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const unique = Array.from(new Set(uuids.filter(Boolean)));
  if (unique.length === 0) return out;

  const client = await initWeaviateClient();
  const collection = client.collections.get<Chunks>(SchemaTypes.Chunks);
  const byRef = (
    collection as unknown as {
      filter: { byRef: (linkOn: string) => { byId: () => { equal: (v: string) => FilterValue } } };
    }
  ).filter.byRef;

  const results = await Promise.all(
    unique.map(async (uuid) => {
      try {
        const response = await collection.query.fetchObjects({
          limit: 1000,
          filters: byRef('mentionsEntities').byId().equal(uuid),
          returnProperties: ['theirstory_id'] as const as any,
        });
        const ids = new Set<string>();
        for (const obj of response.objects) {
          const id = (obj.properties as Partial<Chunks>)?.theirstory_id;
          if (id) ids.add(String(id));
        }
        return [uuid, ids.size] as const;
      } catch (err) {
        console.error('getEntityRecordingCounts failed for', uuid, err);
        return [uuid, 0] as const;
      }
    }),
  );

  for (const [uuid, count] of results) {
    out[uuid] = count;
  }
  return out;
}
