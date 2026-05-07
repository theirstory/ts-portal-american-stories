/**
 * Look up missing Wikidata QIDs for PLACE entities by canonical_form via the
 * Wikidata search API, then persist the verified result back to the Entities
 * collection so the /map page can pin them.
 *
 * Targets:
 *   - PLACE entities where linked_data_qid is null (incl. those just nulled
 *     by `yarn cleanup:bad-qids`).
 *   - Or every PLACE when --force is passed (re-verifies even rows that
 *     already have a QID).
 *
 * Each candidate from wbsearchentities is filtered down by:
 *   1. Label-token overlap with canonical_form (same rule the verifier uses
 *      at ingest time — guards against "Mississippi → Mississippi (song)").
 *   2. Has a P625 coordinate (otherwise the map can't pin it).
 *
 * Rate-limit: 100ms between Wikidata calls; ~10s for 100 entities.
 *
 * Run:  yarn enrich:place-wikidata                   # only orphans
 *       yarn enrich:place-wikidata --force           # re-verify everyone
 *       yarn enrich:place-wikidata --dry-run         # report only
 */

import weaviate, { type WeaviateClient } from 'weaviate-client';

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'for',
  'to',
  'and',
  'or',
  'by',
  'with',
  'from',
  'is',
  'was',
  'were',
  'be',
  'been',
  'are',
  'as',
  'at',
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-zA-Z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

function labelConsistent(canonicalForm: string, label: string): boolean {
  const a = tokens(canonicalForm);
  const b = tokens(label);
  if (a.size === 0 || b.size === 0) return false;
  for (const t of a) if (b.has(t)) return true;
  return false;
}

const ARTICLES = new Set(['the', 'a', 'an']);

/** Same definition the map uses (lib/weaviate/places.ts). Skip generic
 * noun-phrase canonical_forms so we don't burn a Wikidata lookup on
 * "concentration camp" or "courthouse building". */
function isNamedPlace(canonicalForm: string): boolean {
  const trimmed = canonicalForm.trim();
  if (trimmed.length < 2) return false;
  const ts = trimmed.split(/\s+/);
  let i = 0;
  while (i < ts.length && ARTICLES.has(ts[i].toLowerCase())) i += 1;
  const head = ts[i] ?? '';
  if (!head) return false;
  const fc = head.charAt(0);
  return fc === fc.toUpperCase() && fc !== fc.toLowerCase();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UA = 'AmericanStories/1.0 (https://americanstories-demo.theirstory.io)';

async function searchWikidata(query: string): Promise<Array<{ id: string; label: string; description?: string }>> {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbsearchentities');
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'en');
  url.searchParams.set('type', 'item');
  url.searchParams.set('limit', '8');
  url.searchParams.set('search', query);
  url.searchParams.set('origin', '*');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url.toString(), { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { search?: Array<{ id?: string; label?: string; description?: string }> };
    return (data.search ?? [])
      .map((s) => ({ id: String(s.id ?? ''), label: String(s.label ?? ''), description: s.description }))
      .filter((s) => /^Q\d+$/.test(s.id));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

type Resolved = {
  qid: string;
  label: string;
  description: string;
  url: string;
  latitude: number | null;
  longitude: number | null;
};

async function fetchEntityDetails(qid: string): Promise<Resolved | null> {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('format', 'json');
  url.searchParams.set('ids', qid);
  url.searchParams.set('props', 'labels|descriptions|sitelinks/urls|claims');
  url.searchParams.set('languages', 'en');
  url.searchParams.set('sitefilter', 'enwiki');
  url.searchParams.set('origin', '*');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url.toString(), { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      entities?: Record<
        string,
        {
          labels?: { en?: { value?: string } };
          descriptions?: { en?: { value?: string } };
          sitelinks?: { enwiki?: { url?: string } };
          claims?: Record<
            string,
            Array<{ mainsnak?: { datavalue?: { value?: { latitude?: number; longitude?: number } } } }>
          >;
        }
      >;
    };
    const entity = data.entities?.[qid];
    if (!entity) return null;
    const label = entity.labels?.en?.value ?? '';
    const description = entity.descriptions?.en?.value ?? '';
    const enwiki = entity.sitelinks?.enwiki?.url ?? '';
    const fallback = `https://www.wikidata.org/wiki/${qid}`;
    const coord = entity.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    const lat = typeof coord?.latitude === 'number' ? coord.latitude : null;
    const lon = typeof coord?.longitude === 'number' ? coord.longitude : null;
    return {
      qid,
      label,
      description,
      url: enwiki || fallback,
      latitude: lat,
      longitude: lon,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchPlaceEntities(client: WeaviateClient, force: boolean) {
  const collection = client.collections.get('Entities');
  const result = await collection.query.fetchObjects({ limit: 10_000 });
  const out: Array<{ uuid: string; canonical_form: string; existing_qid: string | null }> = [];
  for (const obj of result.objects) {
    const p = obj.properties as Record<string, unknown>;
    const entity_type = typeof p.entity_type === 'string' ? p.entity_type : '';
    if (entity_type !== 'PLACE') continue;
    const canonical_form = typeof p.canonical_form === 'string' ? p.canonical_form : '';
    if (!canonical_form) continue;
    if (!isNamedPlace(canonical_form)) continue;
    const existing_qid = typeof p.linked_data_qid === 'string' ? p.linked_data_qid : null;
    if (!force && existing_qid) continue;
    out.push({ uuid: obj.uuid as string, canonical_form, existing_qid });
  }
  return out;
}

async function patchEntity(
  client: WeaviateClient,
  uuid: string,
  qid: string,
  url: string,
  description: string,
  latitude: number,
  longitude: number,
) {
  const collection = client.collections.get('Entities');
  await collection.data.update({
    id: uuid,
    properties: {
      linked_data_qid: qid,
      linked_data_url: url,
      linked_data_description: description,
      latitude,
      longitude,
    } as any,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  const httpHost = process.env.WEAVIATE_HOST_URL ?? 'localhost';
  const httpPort = Number(process.env.WEAVIATE_PORT ?? 8080);
  const grpcHost = process.env.WEAVIATE_GRPC_HOST_URL ?? httpHost;
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT ?? 50051);

  const client = await weaviate.connectToCustom({ httpHost, httpPort, grpcHost, grpcPort });
  try {
    console.log(`[enrich] dry-run: ${dryRun}, force: ${force}`);
    const places = await fetchPlaceEntities(client, force);
    console.log(`[enrich] ${places.length} PLACE entit${places.length === 1 ? 'y' : 'ies'} to evaluate`);

    let resolvedCount = 0;
    let skippedNoMatch = 0;
    let skippedNoCoords = 0;

    for (const place of places) {
      const candidates = await searchWikidata(place.canonical_form);
      await sleep(120);
      let chosen: Resolved | null = null;

      for (const c of candidates) {
        // 1. Label-overlap rule. Same as the verifier in entity_extraction.
        if (!labelConsistent(place.canonical_form, c.label)) continue;
        // 2. Pull coordinates + sitelink. We only commit if it has P625.
        const detail = await fetchEntityDetails(c.id);
        await sleep(120);
        if (!detail || detail.latitude == null || detail.longitude == null) continue;
        chosen = detail;
        break;
      }

      if (!chosen) {
        // Distinguish "search returned nothing matching the label rule" from
        // "candidate matched the label but had no coordinates" so the report
        // is debuggable.
        const labelMatched = candidates.some((c) => labelConsistent(place.canonical_form, c.label));
        if (labelMatched) skippedNoCoords += 1;
        else skippedNoMatch += 1;
        continue;
      }

      console.log(
        `[enrich] ${place.canonical_form.padEnd(28)} → ${chosen.qid} (${chosen.label})${
          place.existing_qid ? ` [was ${place.existing_qid}]` : ''
        }`,
      );
      resolvedCount += 1;
      if (!dryRun) {
        await patchEntity(
          client,
          place.uuid,
          chosen.qid,
          chosen.url,
          chosen.description,
          chosen.latitude!,
          chosen.longitude!,
        );
      }
    }

    console.log('');
    console.log(
      `[enrich] ${dryRun ? 'WOULD resolve' : 'resolved'} ${resolvedCount} place${
        resolvedCount === 1 ? '' : 's'
      } (skipped ${skippedNoMatch} unmatched, ${skippedNoCoords} without coordinates)`,
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
