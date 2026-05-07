/**
 * List the `theirstory_id` of every Testimony currently in Weaviate.
 *
 * Used by the Phase 1 narrative-pipeline backfill: capture the existing
 * testimony IDs, reset the Weaviate schema, then re-import each ID via
 * `yarn theirstory:import-stories --ids '<id>'` so it goes through the new
 * Pass 0 pipeline.
 *
 * Run:  yarn list-theirstory-ids                # plain ids, one per line
 *       yarn list-theirstory-ids --json         # JSON array
 *       yarn list-theirstory-ids > backfill.txt
 */

import weaviate from 'weaviate-client';

type Args = { json: boolean };

function parseArgs(): Args {
  const json = process.argv.includes('--json');
  return { json };
}

async function main(): Promise<void> {
  const args = parseArgs();

  const httpHost = process.env.WEAVIATE_HOST_URL ?? 'localhost';
  const httpPort = Number(process.env.WEAVIATE_PORT ?? 8080);
  const grpcHost = process.env.WEAVIATE_GRPC_HOST_URL ?? httpHost;
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT ?? 50051);

  const client = await weaviate.connectToCustom({ httpHost, httpPort, grpcHost, grpcPort });
  try {
    const collection = client.collections.get('Testimonies');
    // The original TheirStory `_id` is not stored as its own property — it
    // lives inside the `transcription` JSON property's `id` field. Parse it out.
    const result = await collection.query.fetchObjects({
      limit: 5000,
      returnProperties: ['interview_title', 'transcription'],
    });

    const seen = new Set<string>();
    const ids: string[] = [];
    let withoutId = 0;

    for (const obj of result.objects) {
      const props = obj.properties as Record<string, unknown>;
      const transcription = typeof props.transcription === 'string' ? props.transcription : '';
      let theirstoryId = '';
      if (transcription) {
        try {
          const parsed = JSON.parse(transcription) as { id?: unknown };
          if (typeof parsed.id === 'string') theirstoryId = parsed.id.trim();
        } catch {
          // ignore parse errors, treat as missing
        }
      }
      if (!theirstoryId || seen.has(theirstoryId)) {
        if (!theirstoryId) withoutId += 1;
        continue;
      }
      seen.add(theirstoryId);
      ids.push(theirstoryId);
    }

    if (args.json) {
      console.log(JSON.stringify(ids, null, 2));
    } else {
      for (const id of ids) console.log(id);
    }
    console.error(
      `[list-theirstory-ids] ${ids.length} TheirStory ids found from ${result.objects.length} testimonies.`,
    );
    if (withoutId) {
      console.error(
        `[list-theirstory-ids] WARNING: ${withoutId} testimony rows had no parseable id in their transcription JSON.`,
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
