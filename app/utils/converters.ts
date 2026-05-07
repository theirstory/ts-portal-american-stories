export const getMuxPlaybackId = (videoUrl: string | null): string | null => {
  if (!videoUrl) return null;
  const playbackIdFromUrl = videoUrl?.match(/stream\.mux\.com\/([^.?/]+)/)?.[1];
  return playbackIdFromUrl || null;
};

// Per-title thumbnail-time overrides. The default 5s lands the speaker on
// screen for most American Stories testimonies, but the teaser and the
// "What is American Stories?" intro have slow opens / title cards.
const THUMBNAIL_TIME_BY_TITLE: Array<{ match: string; time: number }> = [
  { match: 'what is american stories', time: 10 },
  { match: 'teaser', time: 19 },
];

export const DEFAULT_THUMBNAIL_TIME = 5;

export const getThumbnailTimeForTitle = (title: string | null | undefined): number => {
  const lower = (title ?? '').toLowerCase();
  for (const { match, time } of THUMBNAIL_TIME_BY_TITLE) {
    if (lower.includes(match)) return time;
  }
  return DEFAULT_THUMBNAIL_TIME;
};
