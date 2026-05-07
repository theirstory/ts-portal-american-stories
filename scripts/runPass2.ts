/**
 * Trigger Pass 2 — cross-source question thread synthesis — over a collection.
 *
 * The Python service (nlp-processor) does the actual work. This is a thin
 * runner so an operator can `yarn pass2:run` from the host without spelunking
 * for curl invocations.
 *
 * Run:  yarn pass2:run                        # default collection (american-stories)
 *       yarn pass2:run --collection my-id
 *       yarn pass2:run --threshold 0.82       # tighter clustering
 *       yarn pass2:run --no-write             # preview only, don't write threads
 */

const args = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

const collectionId = flagValue('collection') ?? 'american-stories';
const threshold = flagValue('threshold');
const minSources = flagValue('min-sources');
const minMembers = flagValue('min-members');
const maxPerLevel = flagValue('max-per-level');
const mergeThreshold = flagValue('merge-threshold');
const writeToWeaviate = !args.includes('--no-write');

const NLP_URL = process.env.NLP_PROCESSOR_URL ?? 'http://localhost:7070';

async function main(): Promise<void> {
  const body: Record<string, unknown> = {
    collection_id: collectionId,
    write_to_weaviate: writeToWeaviate,
  };
  if (threshold) body.similarity_threshold = Number(threshold);
  if (minSources) body.min_sources = Number(minSources);
  if (minMembers) body.min_members = Number(minMembers);
  if (maxPerLevel) body.max_threads_per_level = Number(maxPerLevel);
  if (mergeThreshold) body.thread_merge_threshold = Number(mergeThreshold);

  console.error(`[pass2:run] POST ${NLP_URL}/run-pass2`, body);
  const res = await fetch(`${NLP_URL}/run-pass2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[pass2:run] HTTP ${res.status}`);
    console.error(text);
    process.exit(1);
  }
  // Pretty-print the threads summary; full payload to stdout for piping.
  const data = JSON.parse(text);
  const threads: Array<{
    level: string;
    source_count: number;
    thread_question: string;
    theme_label: string;
    convergence: string;
  }> = data.threads ?? [];
  console.error(
    `[pass2:run] ${threads.length} threads (` +
      Object.entries(data.counts ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') +
      ')',
  );
  for (const t of threads) {
    console.error(
      `  [${t.level} · ${t.source_count} sources · ${t.convergence}] ${t.theme_label} — ${t.thread_question}`,
    );
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
