'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import MuxPlayer from '@mux/mux-player-react';
import { Box, IconButton, Typography, CircularProgress } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { getAllStoriesFromCollection } from '@/lib/weaviate/search';
import { SchemaTypes } from '@/types/weaviate';
import { getMuxPlaybackId } from '@/app/utils/converters';
import { getNerDisplayName } from '@/config/organizationConfig';

const FEATURED_LIMIT = 12;
const RETURN_PROPERTIES = ['interview_title', 'video_url', 'ner_labels', 'collection_name'] as const;

type FeaturedStory = {
  uuid: string;
  title: string;
  videoUrl: string;
  playbackId: string;
  labels: string[];
  collectionName?: string;
};

export const FeaturedStories = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stories, setStories] = useState<FeaturedStory[] | null>(null);

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
          const rawLabels = props.ner_labels;
          const labels: string[] = Array.isArray(rawLabels) ? (rawLabels as string[]).slice(0, 3) : [];
          const story: FeaturedStory = {
            uuid: obj.uuid ?? '',
            title: typeof props.interview_title === 'string' ? props.interview_title : 'Untitled story',
            videoUrl,
            playbackId,
            labels,
          };
          if (typeof props.collection_name === 'string') story.collectionName = props.collection_name;
          mapped.push(story);
        }
        setStories(mapped);
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
        {stories && stories.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
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
                }}>
                <MuxPlayer
                  playbackId={story.playbackId}
                  streamType="on-demand"
                  metadata={{ video_title: story.title }}
                  accentColor="#239B8B"
                  style={{ aspectRatio: '16 / 9' }}
                />
              </Box>
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
                {story.labels.length > 0 && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    {story.labels.map((label) => (
                      <Typography
                        key={label}
                        sx={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          letterSpacing: '0.03em',
                          color: 'text.secondary',
                          textTransform: 'lowercase',
                        }}>
                        #{getNerDisplayName(label).replace(/\s+/g, '')}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
