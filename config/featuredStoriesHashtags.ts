/**
 * Hand-picked hashtags shown on each Featured Stories card on the homepage.
 *
 * Each entry maps a testimony (by case-insensitive title substring) to a
 * short list of phrases that capture the recording's key ideas, communities,
 * and places. Entries are stored as raw phrases ("Japanese American",
 * "Oklahoma", "boarding schools"). The render helper converts them to the
 * hashtag display form: single words become lowercase ("#belonging"),
 * multi-word phrases become PascalCase joined ("#JapaneseAmerican") so they
 * read clearly while still being splittable for hybrid search on the
 * underlying phrase.
 *
 * Clicking a hashtag routes to the stories search with the original phrase
 * (with spaces) as the hybrid-search query — same path as typing into the
 * search box in the Throughlines panel on the homepage.
 */

export type StoryHashtagConfig = {
  /** Case-insensitive substring matched against the testimony title. */
  match: string;
  /** Hashtag phrases in their raw form. The display layer formats them. */
  hashtags: string[];
};

export const STORY_HASHTAGS: StoryHashtagConfig[] = [
  {
    match: 'sarah adams',
    hashtags: ['indigenous', 'Choctaw Nation', 'Oklahoma', 'sovereignty', 'boarding schools'],
  },
  {
    match: 'karen matsuoka',
    hashtags: ['Japanese American', 'internment', 'Tule Lake', 'Terminal Island', 'belonging'],
  },
  {
    match: 'george takei',
    hashtags: ['Japanese American', 'internment', 'LGBTQ', 'Hollywood', 'identity'],
  },
  {
    match: 'sheryl sutton',
    hashtags: ['Black American', 'New Orleans', 'Spelman', 'segregation', 'identity'],
  },
  {
    match: 'akir gutierrez',
    hashtags: ['Nicaragua', 'Latino', 'immigration', 'language', 'identity'],
  },
  {
    match: 'alexandra dean',
    hashtags: ['Jewish', 'Libya', 'immigration', 'storytelling', 'belonging'],
  },
  {
    match: 'elizabeth hira',
    hashtags: ['Guyana', 'voting rights', 'immigration', 'identity'],
  },
  {
    match: 'gloria and joe',
    hashtags: ['Italian', 'Sicilian', 'Tampa', 'immigration', 'family'],
  },
  {
    match: 'heidi mathers',
    hashtags: ['Scandinavian', 'Denmark', 'Minnesota', 'Nigeria', 'adoption'],
  },
  {
    match: 'pleines',
    hashtags: ['German', 'heritage', 'World War II', 'family'],
  },
  {
    match: 'what is american stories',
    hashtags: ['storytelling', 'archive', 'family'],
  },
  {
    match: 'teaser',
    hashtags: ['storytelling', 'archive', 'belonging'],
  },
];

/** Find the curated hashtag list for a testimony by title hint. Returns
 * an empty array when no entry matches — callers should hide the chip row
 * rather than fall back to anything generic. */
export function findStoryHashtags(title: string | null | undefined): string[] {
  const t = (title ?? '').toLowerCase();
  if (!t) return [];
  for (const entry of STORY_HASHTAGS) {
    if (t.includes(entry.match.toLowerCase())) return entry.hashtags;
  }
  return [];
}

/** Format a phrase as a hashtag for display. Single-word phrases become
 * lowercase ("#belonging"); multi-word phrases become PascalCase joined
 * ("#JapaneseAmerican") so two-word communities stay readable while still
 * splitting cleanly back into individual search terms. Words that are
 * already all-uppercase (acronyms like LGBTQ, II) are preserved as-is so
 * "LGBTQ" stays "LGBTQ" and "World War II" becomes "WorldWarII".
 */
export function renderHashtag(phrase: string): string {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '#';
  const isAcronym = (w: string) => w.length >= 2 && w === w.toUpperCase() && /[A-Z]/.test(w);
  if (words.length === 1) {
    return `#${isAcronym(words[0]) ? words[0] : words[0].toLowerCase()}`;
  }
  const pascal = words.map((w) => (isAcronym(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join('');
  return `#${pascal}`;
}
