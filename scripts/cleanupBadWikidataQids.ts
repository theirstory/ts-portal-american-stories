/**
 * One-off cleanup: walk every Entities row, compare canonical_form to the
 * Wikipedia page slug stored in linked_data_url. If there is zero substantive
 * token overlap, null out linked_data_qid / linked_data_url /
 * linked_data_description so the entity falls back to its internal_id and
 * the map drops the wrong pin.
 *
 * Background: an early build of the Wikidata verifier accepted any QID whose
 * description token-overlapped the LLM hint, and incidentally let through
 * cases like "New Orleans" → Q35794 (University of Cambridge). The verifier
 * has since been tightened (label-overlap is now load-bearing); this script
 * cleans up rows already in Weaviate.
 *
 * Run:  yarn cleanup:bad-qids                # apply
 *       yarn cleanup:bad-qids --dry-run      # report only
 */

import weaviate, { type WeaviateClient } from 'weaviate-client';

const NORMALIZE = /[^a-z0-9]+/g;
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
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
      .map((t) => t.replace(NORMALIZE, '')),
  );
}

function slugFromUrl(url: string): string | null {
  // https://en.wikipedia.org/wiki/University_of_Cambridge → "University of Cambridge"
  // Wikidata fallback pages (https://www.wikidata.org/wiki/Q1234) carry no
  // human label, so return null and let the caller skip the slug check.
  if (!url.includes('en.wikipedia.org/wiki/')) return null;
  const m = url.match(/\/wiki\/([^?#]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/_/g, ' ');
  } catch {
    return m[1].replace(/_/g, ' ');
  }
}

async function fetchEntitiesWithLinks(client: WeaviateClient) {
  const collection = client.collections.get('Entities');
  const result = await collection.query.fetchObjects({ limit: 10_000 });
  const out: Array<{
    uuid: string;
    canonical_form: string;
    qid: string | null;
    url: string | null;
    description: string | null;
  }> = [];
  for (const obj of result.objects) {
    const p = obj.properties as Record<string, unknown>;
    const qid = typeof p.linked_data_qid === 'string' ? p.linked_data_qid : null;
    const url = typeof p.linked_data_url === 'string' ? p.linked_data_url : null;
    const description = typeof p.linked_data_description === 'string' ? p.linked_data_description : null;
    if (!qid && !url) continue;
    out.push({
      uuid: obj.uuid as string,
      canonical_form: typeof p.canonical_form === 'string' ? p.canonical_form : '',
      qid,
      url,
      description,
    });
  }
  return out;
}

async function nullifyEntity(client: WeaviateClient, uuid: string) {
  const collection = client.collections.get('Entities');
  await collection.data.update({
    id: uuid,
    properties: {
      linked_data_qid: null,
      linked_data_url: null,
      linked_data_description: null,
    } as any,
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const httpHost = process.env.WEAVIATE_HOST_URL ?? 'localhost';
  const httpPort = Number(process.env.WEAVIATE_PORT ?? 8080);
  const grpcHost = process.env.WEAVIATE_GRPC_HOST_URL ?? httpHost;
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT ?? 50051);

  const client = await weaviate.connectToCustom({ httpHost, httpPort, grpcHost, grpcPort });
  try {
    console.log(`[cleanup] dry-run: ${dryRun}`);
    const rows = await fetchEntitiesWithLinks(client);
    console.log(`[cleanup] ${rows.length} entities have linked data`);

    let toClear = 0;
    let skippedNoSlug = 0;
    for (const e of rows) {
      const slug = e.url ? slugFromUrl(e.url) : null;
      const canonicalTokens = tokens(e.canonical_form);
      const descriptionTokens = tokens(e.description ?? '');

      // Without a human-readable Wikipedia slug we have no positive evidence
      // of mismatch — leave the entry alone rather than clear it.
      if (!slug) {
        skippedNoSlug += 1;
        continue;
      }

      const slugTokens = tokens(slug);
      if (canonicalTokens.size === 0 || slugTokens.size === 0) continue;

      // Clear ONLY when canonical_form has zero overlap with both the slug
      // AND the description. Permits 1-token canonical_forms that match a
      // multi-word slug ("Mississippi" vs "Mississippi River").
      const slugOverlap = [...canonicalTokens].some((t) => slugTokens.has(t));
      const descriptionOverlap = [...canonicalTokens].some((t) => descriptionTokens.has(t));
      if (slugOverlap || descriptionOverlap) continue;

      console.log(`[cleanup] ${e.canonical_form.padEnd(30)} → ${e.qid ?? '?'} (${slug}) — clearing`);
      toClear += 1;
      if (!dryRun) await nullifyEntity(client, e.uuid);
    }

    console.log(
      `[cleanup] ${dryRun ? 'WOULD clear' : 'cleared'} ${toClear} bad linkages` +
        (skippedNoSlug ? ` (skipped ${skippedNoSlug} entries with no English Wikipedia sitelink)` : ''),
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
