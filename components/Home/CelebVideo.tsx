'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import MuxPlayer from '@mux/mux-player-react';
import { Box, Button, Typography, CircularProgress } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import VideocamIcon from '@mui/icons-material/Videocam';
import { findStoryByTitleHint } from '@/lib/weaviate/search';
import { getMuxPlaybackId } from '@/app/utils/converters';

const SHARE_STORY_URL = 'https://theirstory.io/AmericanStories/home-page/s/Neld7Yo8d7/solo';
const CELEB_HINT = 'Takei';

type CelebStory = { uuid: string; title: string; playbackId: string } | null;

export const CelebVideo = () => {
  const [story, setStory] = useState<CelebStory | undefined>(undefined);
  const [hasPlayed, setHasPlayed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    findStoryByTitleHint(CELEB_HINT)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setStory(null);
          return;
        }
        const playbackId = getMuxPlaybackId(result.videoUrl);
        if (!playbackId) {
          setStory(null);
          return;
        }
        setStory({ uuid: result.uuid, title: result.title, playbackId });
      })
      .catch((err) => {
        console.error('Failed to load celeb story:', err);
        if (!cancelled) setStory(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box
      sx={{
        height: '100%',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1.55fr 1fr' },
        gap: { xs: 2.5, md: 4 },
        alignItems: 'center',
        px: { xs: 2, md: 4 },
      }}>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          maxHeight: '100%',
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: 'common.black',
          boxShadow: '0 18px 48px rgba(0,0,0,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          '& mux-player': {
            width: '100%',
            height: '100%',
            '--media-object-fit': 'cover',
          },
          '&:hover .mux-hover-preview': { opacity: 1 },
          '&:hover .mux-hover-play-icon': { opacity: 1 },
        }}>
        {story === undefined ? (
          <CircularProgress size={28} sx={{ color: 'secondary.main' }} />
        ) : story === null ? (
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.875rem', textAlign: 'center', px: 2 }}>
            Celeb video unavailable.
          </Typography>
        ) : (
          <>
            <MuxPlayer
              playbackId={story.playbackId}
              streamType="on-demand"
              thumbnailTime={5}
              metadata={{ video_title: story.title }}
              accentColor="#F96044"
              onPlaying={() => setHasPlayed(true)}
              style={{ aspectRatio: '16 / 9' }}
            />
            {!hasPlayed && (
              <>
                <Box
                  className="mux-hover-preview"
                  aria-hidden="true"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage: `url(https://image.mux.com/${story.playbackId}/animated.webp?width=640&height=360&fps=15&start=5&end=10)`,
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
                      width: { xs: 56, md: 80 },
                      height: 'auto',
                      fill: '#ffffff',
                      filter: 'drop-shadow(0 2px 14px rgba(0,0,0,0.65))',
                    }}>
                    <path d="M15.5987 6.2911L3.45577 0.110898C2.83667 -0.204202 2.06287 0.189698 2.06287 0.819798V13.1802C2.06287 13.8103 2.83667 14.2042 3.45577 13.8891L15.5987 7.7089C16.2178 7.3938 16.2178 6.6061 15.5987 6.2911Z" />
                  </Box>
                </Box>
              </>
            )}
          </>
        )}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
        <Typography
          variant="overline"
          sx={{
            letterSpacing: '0.18em',
            color: 'secondary.main',
            fontWeight: 700,
            display: 'block',
            mb: 1.5,
            fontSize: '0.7rem',
          }}>
          George Takei
        </Typography>
        <Typography
          component="blockquote"
          sx={{
            fontFamily: 'var(--font-serif), Georgia, serif',
            fontSize: { xs: '1.125rem', md: '1.4rem', lg: '1.55rem' },
            fontStyle: 'italic',
            fontWeight: 400,
            lineHeight: 1.3,
            color: 'common.black',
            m: 0,
            mb: 2.5,
            position: 'relative',
            pl: 2.5,
            '&::before': {
              content: '""',
              position: 'absolute',
              left: 0,
              top: 4,
              bottom: 4,
              width: '3px',
              backgroundColor: 'secondary.main',
              borderRadius: '2px',
            },
          }}>
          This is history as we lived it, in our own words.
        </Typography>
        <Button
          component="a"
          href={SHARE_STORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          variant="contained"
          color="secondary"
          size="medium"
          startIcon={<VideocamIcon />}
          sx={{
            alignSelf: 'flex-start',
            px: { xs: 2.5, md: 3 },
            py: 1.25,
            fontSize: '0.9375rem',
            fontWeight: 700,
            letterSpacing: '0.02em',
          }}>
          Record Your American Story
        </Button>
        {story && story.uuid && (
          <Box
            component={Link}
            href={`/story/${story.uuid}`}
            sx={{
              alignSelf: 'flex-start',
              mt: 1.5,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'common.black',
              textDecoration: 'none',
              opacity: 0.75,
              transition: 'opacity 0.15s, color 0.15s',
              '&:hover': { opacity: 1, color: 'secondary.main' },
              '&:hover .arrow': { transform: 'translateX(3px)' },
            }}>
            Watch full interview
            <ArrowForwardIcon className="arrow" sx={{ fontSize: 16, transition: 'transform 0.15s ease' }} />
          </Box>
        )}
      </Box>
    </Box>
  );
};
