import { findStoryByTitleHint } from '@/lib/weaviate/search';
import { getMuxPlaybackId } from '@/app/utils/converters';
import { GettingStartedView } from './GettingStartedView';

export const metadata = {
  title: 'Getting Started · American Stories',
  description: 'How to record your American Story — guidance, prompts, and a conversation starter.',
};

// Page depends on Weaviate at request time to look up the "What is American
// Stories?" testimony for the embedded video. Skip static prerender during
// `next build`, which has no Weaviate available — without this the prod
// build silently produces a frozen, video-less page (same root cause as
// the earlier /map prerender issue).
export const dynamic = 'force-dynamic';

export default async function GettingStartedPage() {
  const intro = await findStoryByTitleHint('what is american stories').catch(() => null);
  const playbackId = intro?.videoUrl ? getMuxPlaybackId(intro.videoUrl) : null;
  const introTitle = intro?.title ?? 'What is American Stories?';
  return <GettingStartedView playbackId={playbackId} videoTitle={introTitle} />;
}
