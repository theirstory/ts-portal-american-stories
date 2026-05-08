'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import MuxPlayer from '@mux/mux-player-react';
import { Box, IconButton, Typography, CircularProgress } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { isChatEnabled } from '@/config/organizationConfig';
import { getAllStoriesFromCollection } from '@/lib/weaviate/search';
import { SchemaTypes } from '@/types/weaviate';
import { getMuxPlaybackId, getThumbnailTimeForTitle } from '@/app/utils/converters';
import { findStoryHashtags, renderHashtag } from '@/config/featuredStoriesHashtags';

const FEATURED_LIMIT = 12;
const RETURN_PROPERTIES = ['interview_title', 'video_url', 'collection_name'] as const;

// Pin specific videos to the front of the carousel by title-substring match (case insensitive).
const FEATURED_PIN_ORDER = ['teaser', 'what is american stories', 'karen matsuoka', 'sarah adams'];

const sortByPinOrder = <T extends { title: string }>(items: T[]): T[] => {
  const pinned: T[] = [];
  const rest: T[] = [];
  const remaining = [...items];
  for (const pin of FEATURED_PIN_ORDER) {
    const idx = remaining.findIndex((s) => s.title.toLowerCase().includes(pin));
    if (idx !== -1) {
      pinned.push(remaining[idx]);
      remaining.splice(idx, 1);
    }
  }
  rest.push(...remaining);
  return [...pinned, ...rest];
};

type FeaturedStory = {
  uuid: string;
  title: string;
  videoUrl: string;
  playbackId: string;
  hashtags: string[];
  collectionName?: string;
};

export const FeaturedStories = () => {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stories, setStories] = useState<FeaturedStory[] | null>(null);
  const [playedMap, setPlayedMap] = useState<Record<string, boolean>>({});

  const onHashtagClick = (phrase: string) => {
    const trimmed = phrase.trim();
    if (!trimmed) return;
    router.push(`/stories?q=${encodeURIComponent(trimmed)}&searchType=hybrid`);
  };

  useEffect(() => {
    let cancelled = false;
    getAllStoriesFromCollection(SchemaTypes.Testimonies, [...RETURN_PROPERTIES], FEATURED_LIMIT, 0)
      .then((response) => {
        if (cancelled) return;
        const mapped: FeaturedStory[] = [];
        for (const obj of response.objects) {
          const props = obj.properties as Record<string, unknown>;
          const videoUrl = typeof props.video_url === 'string' ? props.video_url : '';
          const playbackId = getMuxPlaybackId(videoUrl);
          if (!playbackId) continue;
          const title = typeof props.interview_title === 'string' ? props.interview_title : 'Untitled story';
          const story: FeaturedStory = {
            uuid: obj.uuid ?? '',
            title,
            videoUrl,
            playbackId,
            hashtags: findStoryHashtags(title),
          };
          if (typeof props.collection_name === 'string') story.collectionName = props.collection_name;
          mapped.push(story);
        }
        setStories(sortByPinOrder(mapped));
      })
      .catch((err) => {
        console.error('Failed to load featured stories:', err);
        if (!cancelled) setStories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = 280;
    el.scrollBy({ left: direction === 'left' ? -cardWidth : cardWidth, behavior: 'smooth' });
  };

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        px: { xs: 2, md: 4 },
        py: { xs: 2, md: 0 },
        minHeight: 0,
      }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          mb: 1.5,
          gap: 2,
        }}>
        <Typography
          variant="overline"
          sx={{
            letterSpacing: '0.2em',
            color: 'secondary.main',
            fontWeight: 700,
            fontSize: { xs: '0.7rem', md: '0.75rem' },
          }}>
          Featured American Stories
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: { xs: 1.5, md: 2.5 },
            '& .home-nav-link': {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              color: 'common.black',
              textDecoration: 'none',
              fontSize: '0.8125rem',
              fontWeight: 600,
              opacity: 0.75,
              transition: 'opacity 0.15s, color 0.15s',
              '&:hover': { opacity: 1, color: 'secondary.main' },
              '&:hover .arrow': { transform: 'translateX(3px)' },
            },
          }}>
          <Box component={Link} href="/stories" className="home-nav-link">
            All stories
            <ArrowForwardIcon className="arrow" sx={{ fontSize: 15, transition: 'transform 0.15s ease' }} />
          </Box>
          <Box component={Link} href="/indexes" className="home-nav-link">
            Indexes
          </Box>
          {isChatEnabled && (
            <Box component={Link} href="/discover" className="home-nav-link">
              <AutoAwesomeIcon sx={{ fontSize: 14 }} />
              Discover
            </Box>
          )}
          {stories && stories.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, ml: { xs: 0, md: 1 } }}>
              <IconButton
                onClick={() => scroll('left')}
                size="small"
                aria-label="Scroll left"
                sx={{
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  width: 32,
                  height: 32,
                  '&:hover': { bgcolor: 'background.subtle' },
                }}>
                <ChevronLeftIcon fontSize="small" />
              </IconButton>
              <IconButton
                onClick={() => scroll('right')}
                size="small"
                aria-label="Scroll right"
                sx={{
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  width: 32,
                  height: 32,
                  '&:hover': { bgcolor: 'background.subtle' },
                }}>
                <ChevronRightIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
        </Box>
      </Box>

      {stories === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
          <CircularProgress sx={{ color: 'secondary.main' }} size={28} />
        </Box>
      ) : stories.length === 0 ? (
        <Typography sx={{ color: 'text.secondary' }}>No featured stories yet.</Typography>
      ) : (
        <Box
          ref={scrollRef}
          sx={{
            display: 'flex',
            gap: 2,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollSnapType: 'x mandatory',
            pb: 1.5,
            flex: 1,
            minHeight: 0,
            WebkitOverflowScrolling: 'touch',
            '&::-webkit-scrollbar': { height: 6 },
            '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 4 },
          }}>
          {stories.map((story) => (
            <Box
              key={story.uuid}
              sx={{
                flex: '0 0 auto',
                width: { xs: 220, sm: 240, md: 260 },
                scrollSnapAlign: 'start',
                display: 'flex',
                flexDirection: 'column',
              }}>
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '16 / 9',
                  borderRadius: 1.5,
                  overflow: 'hidden',
                  bgcolor: 'common.black',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.1)',
                  mb: 1,
                  '& mux-player': {
                    width: '100%',
                    height: '100%',
                    '--media-object-fit': 'cover',
                  },
                  '&:hover .mux-hover-preview': { opacity: 1 },
                  '&:hover .mux-hover-play-icon': { opacity: 1 },
                }}>
                <MuxPlayer
                  playbackId={story.playbackId}
                  streamType="on-demand"
                  thumbnailTime={getThumbnailTimeForTitle(story.title)}
                  metadata={{ video_title: story.title }}
                  accentColor="#F96044"
                  onPlaying={() => setPlayedMap((prev) => ({ ...prev, [story.uuid]: true }))}
                  style={{ aspectRatio: '16 / 9' }}
                />
                {!playedMap[story.uuid] && (
                  <>
                    <Box
                      className="mux-hover-preview"
                      aria-hidden="true"
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        backgroundImage: `url(https://image.mux.com/${story.playbackId}/animated.webp?width=480&height=270&fps=15&start=${getThumbnailTimeForTitle(story.title)}&end=${getThumbnailTimeForTitle(story.title) + 5})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        opacity: 0,
                        transition: 'opacity 0.4s ease',
                        pointerEvents: 'none',
                      }}
                    />
                    <Box
                      className="mux-hover-play-icon"
                      aria-hidden="true"
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: 0,
                        transition: 'opacity 0.4s ease',
                        pointerEvents: 'none',
                      }}>
                      <Box
                        component="svg"
                        aria-hidden="true"
                        viewBox="0 0 18 14"
                        sx={{
                          width: { xs: 38, md: 44 },
                          height: 'auto',
                          fill: '#ffffff',
                          filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.6))',
                        }}>
                        <path d="M15.5987 6.2911L3.45577 0.110898C2.83667 -0.204202 2.06287 0.189698 2.06287 0.819798V13.1802C2.06287 13.8103 2.83667 14.2042 3.45577 13.8891L15.5987 7.7089C16.2178 7.3938 16.2178 6.6061 15.5987 6.2911Z" />
                      </Box>
                    </Box>
                  </>
                )}
              </Box>
              {/* Title links to the story page; hashtags sit outside the
                  Link so each chip can route to its own search query
                  without nested-anchor warnings. */}
              <Box
                component={Link}
                href={`/story/${story.uuid}`}
                sx={{
                  display: 'block',
                  textDecoration: 'none',
                  color: 'inherit',
                  '&:hover .featured-title': { color: 'secondary.main' },
                }}>
                <Typography
                  className="featured-title"
                  sx={{
                    fontFamily: 'var(--font-serif), Georgia, serif',
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    lineHeight: 1.25,
                    color: 'common.black',
                    transition: 'color 0.15s ease',
                    mb: 0.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                  {story.title}
                </Typography>
              </Box>
              {story.hashtags.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.25 }}>
                  {story.hashtags.map((phrase) => (
                    <Box
                      key={phrase}
                      component="button"
                      type="button"
                      onClick={() => onHashtagClick(phrase)}
                      title={`Search for "${phrase}"`}
                      sx={{
                        appearance: 'none',
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        letterSpacing: '0.02em',
                        color: 'text.secondary',
                        transition: 'color 0.15s ease',
                        '&:hover': { color: 'secondary.main', textDecoration: 'underline' },
                        '&:focus-visible': {
                          outline: '2px solid',
                          outlineColor: 'secondary.main',
                          outlineOffset: 2,
                          borderRadius: 2,
                        },
                      }}>
                      {renderHashtag(phrase)}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
