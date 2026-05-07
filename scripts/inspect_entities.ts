/**
 * Read-only debugging helper. Lists every Entity row grouped by type, plus
 * common-noun PERSON entities with their variants, plus any "Gestapo" hits.
 * Useful when planning a merge / delete pass to see what's actually in the
 * Entities collection.
 *
 * Run:  npx dotenv -e .env.local -- tsx scripts/inspect_entities.ts
 */

import weaviate from 'weaviate-client';

async function main() {
  const httpHost = process.env.WEAVIATE_HOST_URL ?? 'localhost';
  const httpPort = Number(process.env.WEAVIATE_PORT ?? 8080);
  const grpcHost = process.env.WEAVIATE_GRPC_HOST_URL ?? httpHost;
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT ?? 50051);
  const client = await weaviate.connectToCustom({ httpHost, httpPort, grpcHost, grpcPort });
  try {
    const col = client.collections.get('Entities');
    const r = await col.query.fetchObjects({ limit: 10000 });

    console.log('--- common-noun PERSON entities ---');
    const persons = r.objects
      .map((o) => o.properties as Record<string, unknown>)
      .filter((p) => String(p.entity_type) === 'PERSON');
    for (const p of persons) {
      const cf = String(p.canonical_form ?? '');
      if (!cf || cf[0] !== cf[0].toLowerCase()) continue;
      const vars = Array.isArray(p.variants) ? (p.variants as string[]) : [];
      console.log(`${cf.padEnd(28)} | variants=[${vars.join(', ')}]`);
    }

    console.log('\n--- entities by type ---');
    const byType = new Map<string, string[]>();
    for (const obj of r.objects) {
      const p = obj.properties as Record<string, unknown>;
      const t = String(p.entity_type ?? '');
      const cf = String(p.canonical_form ?? '');
      if (!cf) continue;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(cf);
    }
    for (const [t, names] of byType) {
      const sorted = [...new Set(names)].sort();
      console.log(`\n${t} (${sorted.length} unique):`);
      for (const n of sorted) console.log(`  ${n}`);
    }
  } finally {
    await client.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
