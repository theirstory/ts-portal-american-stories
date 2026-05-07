/**
 * Editor-defined throughlines.
 *
 * These themes are the editorial questions the archive *should* answer —
 * curated by humans, not surfaced by Pass 2's clustering. Each entry carries
 * a "seed" sentence that's embedded via LaBSE and used to pull the most
 * semantically-similar narrator excerpts at materialization time
 * (see scripts/buildEditorialThroughlines.ts).
 *
 * Rules:
 *   - keep `id` stable; it's hashed into the deterministic UUID for the
 *     QuestionThreads row, so changing it loses the existing record.
 *   - `seed` is a single sentence in the voice of an interviewer. Stronger
 *     seeds → tighter excerpts. Spend time on these.
 *   - tone follows the same guardrail as Pass 2: no country-as-villain.
 */

export type EditorialThroughline = {
  id: string;
  label: string;
  description: string;
  question_level: 'FACTS' | 'FEELINGS' | 'IDENTITY';
  seed: string;
  /** Optional override for similarity threshold (0..1). Higher = tighter
   * matches but fewer recordings. Defaults to 0.4 in the build script. */
  similarity_threshold?: number;
  /** Cap on how many excerpts to include per recording. Defaults to 1 in the
   * build script (one strongest excerpt per narrator). */
  excerpts_per_recording?: number;
};

// No editor-defined throughlines active. The infrastructure
// (scripts/buildEditorialThroughlines.ts) still works — populate this array
// and run `yarn editorial:build` to materialize them.
export const EDITORIAL_THROUGHLINES: EditorialThroughline[] = [];
