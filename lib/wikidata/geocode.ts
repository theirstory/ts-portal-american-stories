'use server';

/** Wikidata SPARQL/wbgetentities-based geocoder.
 *
 * Looks up coordinate-location (Wikidata property P625) for a batch of QIDs.
 * Module-level cache so reruns within a process don't repeat HTTP calls.
 * 30s timeout per request; failures yield silent omissions (we'd rather
 * skip a pin than block the whole map).
 */

const COORD_CACHE = new Map<string, { lat: number; lon: number } | null>();

const WBGETENTITIES_BATCH_SIZE = 50;

type WbGetEntitiesResp = {
  entities?: Record<
    string,
    {
      claims?: Record<
        string,
        Array<{ mainsnak?: { datavalue?: { value?: { latitude?: number; longitude?: number } } } }>
      >;
    }
  >;
};

async function fetchBatch(qids: string[]): Promise<Map<string, { lat: number; lon: number } | null>> {
  const out = new Map<string, { lat: number; lon: number } | null>();
  if (qids.length === 0) return out;

  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('format', 'json');
  url.searchParams.set('props', 'claims');
  url.searchParams.set('ids', qids.join('|'));
  url.searchParams.set('origin', '*');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'AmericanStories/1.0 (https://americanstories-demo.theirstory.io)' },
      signal: controller.signal,
    });
    if (!res.ok) {
      for (const qid of qids) out.set(qid, null);
      return out;
    }
    const data = (await res.json()) as WbGetEntitiesResp;
    for (const qid of qids) {
      const entity = data.entities?.[qid];
      const p625 = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      if (p625 && typeof p625.latitude === 'number' && typeof p625.longitude === 'number') {
        out.set(qid, { lat: p625.latitude, lon: p625.longitude });
      } else {
        out.set(qid, null);
      }
    }
  } catch (err) {
    console.error('Wikidata geocode batch failed:', err);
    for (const qid of qids) out.set(qid, null);
  } finally {
    clearTimeout(t);
  }
  return out;
}

/** Returns a Map<qid, {lat, lon} | null>. Null = lookup ran but the entity
 * has no coordinate property. Use `.has(qid)` to distinguish "we tried" from
 * "we haven't looked yet". */
export async function geocodeQids(qids: string[]): Promise<Map<string, { lat: number; lon: number } | null>> {
  const result = new Map<string, { lat: number; lon: number } | null>();
  const toFetch: string[] = [];

  for (const raw of qids) {
    const qid = raw?.trim();
    if (!qid) continue;
    if (COORD_CACHE.has(qid)) {
      result.set(qid, COORD_CACHE.get(qid)!);
    } else if (!toFetch.includes(qid)) {
      toFetch.push(qid);
    }
  }

  for (let i = 0; i < toFetch.length; i += WBGETENTITIES_BATCH_SIZE) {
    const batch = toFetch.slice(i, i + WBGETENTITIES_BATCH_SIZE);
    const fetched = await fetchBatch(batch);
    for (const [qid, coord] of fetched) {
      COORD_CACHE.set(qid, coord);
      result.set(qid, coord);
    }
  }

  return result;
}
