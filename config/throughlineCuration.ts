/**
 * Hand-picked throughline curation for the demo.
 *
 * Pass 2 produces ~20 throughlines for American Stories — many overlap, and a
 * few don't read well in editorial copy. This config picks the highest-signal
 * ones, gives each a clean human label, and a brief non-question description.
 *
 * The throughline page (and home cloud, story tab, modal) only shows entries
 * that match a curation row. First match wins, so semantic duplicates
 * collapse to a single chip — e.g. two "American Identity" throughlines map
 * to one entry.
 *
 * Match strategy: case-insensitive substring against theme_label OR
 * thread_question. Be specific enough to avoid bleeding across rows.
 */

export type ThroughlineCuration = {
  /** Human-readable display title (replaces theme_label everywhere). */
  label: string;
  /** Brief, non-question description. Two sentences max. */
  description: string;
  /** Substrings (case-insensitive) checked against theme_label and
   * thread_question. ANY match counts. */
  matchAny: string[];
};

export const THROUGHLINE_CURATION: ThroughlineCuration[] = [
  {
    label: 'Identity Formation',
    description:
      'How early-life experiences — language, family origins, the journey itself — shape who a person comes to feel they are.',
    matchAny: ['identity formation'],
  },
  {
    label: 'American Identity',
    description:
      "What 'being American' means in a person's own life, and how that meaning sits alongside the country they came from.",
    matchAny: ['american identity', 'becoming american', 'defining american'],
  },
  {
    label: 'Belonging',
    description:
      'Holding onto heritage, faith, and food while learning how to belong inside a new culture at the same time.',
    matchAny: ['cultural belonging', 'cultural identity'],
  },
  {
    label: 'Family Pride',
    description:
      'What a family carries forward with pride — recipes, traditions, names, sacrifices — and how those choices travel.',
    matchAny: ['family pride'],
  },
  {
    label: 'Generational Influence',
    description:
      'How the dreams, sacrifices, and silences of earlier generations shape who their grandchildren become.',
    matchAny: ['generational identity', 'generational influence', 'parental legacy', 'inherited identity'],
  },
  {
    label: 'Ancestral Hopes',
    description: 'The hopes that crossed oceans — what the people who came first wanted for the people who came after.',
    matchAny: ['ancestral hope', 'ancestral identity', 'ancestral connection'],
  },
  {
    label: 'Personal Identity',
    description:
      'The work of telling your own story — through how you speak, what you claim, and what you push back against.',
    matchAny: [
      'self perception',
      'self-perception',
      'self-definition',
      'personal identity',
      'identity and narrative',
      'identity and othering',
      'defining self',
      'shaping selfhood',
      'shaping identity',
      'defining selfhood',
    ],
  },
  {
    label: 'Family Roots',
    description: 'How family origins, ancestry, and the places people came from shape the person they become.',
    matchAny: ['roots and identity', 'roots and belonging', 'ancestral roots', 'family roots', 'navigating heritage'],
  },
  {
    label: 'Cultural Heritage',
    description: 'The traditions, languages, and rituals carried across borders — what gets kept, what gets adapted.',
    matchAny: ['cultural heritage', 'navigating multiple heritages', 'bridging identities', 'heritage and identity'],
  },
  {
    label: 'Navigating Language',
    description:
      'What languages were spoken at home, what got translated, what got lost — and how that shaped family life.',
    matchAny: ['language atmosphere', 'navigating language'],
  },
  {
    label: 'Sense of Belonging',
    description:
      'Where a person finds the feeling of being known — in family, in community, in landscape, in routines.',
    matchAny: ['sense of belonging', 'belonging and community'],
  },
  {
    label: 'Immigrant Hopes & Hardships',
    description:
      'The hopes immigrant families carried into a new country, and the hardships they navigated to keep them alive.',
    matchAny: [
      'immigrant identity',
      'immigrant feelings',
      'immigrant emotions',
      'belonging and alienation',
      'claiming identity',
    ],
  },
];

/** Returns the matching curation entry for a given thread, or null when the
 * thread isn't on the demo's curated list. Substring-matches are checked
 * against theme_label first, then thread_question. */
export function findThroughlineCuration(thread: {
  theme_label?: string | null;
  thread_question?: string | null;
}): ThroughlineCuration | null {
  const label = (thread.theme_label ?? '').toLowerCase();
  const question = (thread.thread_question ?? '').toLowerCase();
  for (const entry of THROUGHLINE_CURATION) {
    for (const needle of entry.matchAny) {
      const n = needle.toLowerCase();
      if (label.includes(n) || question.includes(n)) return entry;
    }
  }
  return null;
}
