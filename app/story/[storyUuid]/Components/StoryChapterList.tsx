'use client';

import { Box, Typography } from '@mui/material';
import { useEffect, useMemo, useRef } from 'react';
import usePlayerStore from '@/app/stores/usePlayerStore';
import { useSemanticSearchStore } from '@/app/stores/useSemanticSearchStore';
import { useTranscriptNavigation } from '@/app/hooks/useTranscriptNavigation';
import { formatTime } from '@/app/utils/util';
import { colors } from '@/lib/theme';

type Chapter = {
  index: number;
  title: string;
  synopsis: string;
  start_time: number;
  end_time: number;
};

export const StoryChapterList = () => {
  const transcript = useSemanticSearchStore((s) => s.transcript);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const { seekAndScroll } = useTranscriptNavigation();
  const listRef = useRef<HTMLDivElement>(null);

  const chapters = useMemo<Chapter[]>(() => {
    const sections = transcript?.sections ?? [];
    return sections.map((s, i) => ({
      index: i,
      title: (s.title ?? '').trim() || `Chapter ${i + 1}`,
      synopsis: (s.synopsis ?? '').trim(),
      start_time: Number(s.start ?? 0),
      end_time: Number(s.end ?? 0),
    }));
  }, [transcript]);

  const activeIndex = useMemo(() => {
    if (chapters.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < chapters.length; i += 1) {
      if (chapters[i].start_time <= currentTime + 0.001) idx = i;
      else break;
    }
    return idx;
  }, [chapters, currentTime]);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-chapter-index="${activeIndex}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeIndex]);

  if (chapters.length === 0) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
          bgcolor: colors.common.white,
          borderRadius: 2,
          border: '1px solid',
          borderColor: colors.grey[200],
        }}>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.85rem', textAlign: 'center' }}>
          No chapters available for this recording yet.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: colors.common.white,
        borderRadius: 2,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: colors.grey[200],
      }}>
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: colors.grey[200],
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 1,
        }}>
        <Typography
          variant="overline"
          sx={{
            letterSpacing: '0.18em',
            color: 'secondary.main',
            fontWeight: 700,
            fontSize: '0.72rem',
          }}>
          Chapters
        </Typography>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.72rem' }}>{chapters.length}</Typography>
      </Box>

      <Box
        ref={listRef}
        sx={{
          flex: 1,
          overflowY: 'auto',
          py: 0.5,
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 4 },
        }}>
        {chapters.map((chapter) => {
          const isActive = chapter.index === activeIndex;
          return (
            <Box
              key={chapter.index}
              data-chapter-index={chapter.index}
              component="button"
              onClick={() => seekAndScroll(chapter.start_time)}
              sx={{
                width: '100%',
                textAlign: 'left',
                background: isActive ? 'rgba(249, 96, 68, 0.06)' : 'transparent',
                border: 'none',
                borderLeft: '3px solid',
                borderColor: isActive ? 'secondary.main' : 'transparent',
                px: 2,
                py: 1.25,
                cursor: 'pointer',
                transition: 'background 0.15s ease, border-color 0.15s ease',
                '&:hover': {
                  background: isActive ? 'rgba(249, 96, 68, 0.10)' : 'rgba(0,0,0,0.03)',
                  borderColor: isActive ? 'secondary.main' : colors.grey[300],
                },
              }}>
              <Typography
                sx={{
                  fontFamily: 'var(--font-serif), Georgia, serif',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  color: isActive ? 'secondary.main' : colors.text.primary,
                  lineHeight: 1.3,
                  mb: 0.4,
                }}>
                {chapter.title}
              </Typography>
              <Typography
                sx={{
                  color: colors.text.secondary,
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  mb: chapter.synopsis ? 0.5 : 0,
                }}>
                {formatTime(chapter.start_time)}
              </Typography>
              {chapter.synopsis && (
                <Typography
                  sx={{
                    color: colors.text.secondary,
                    fontSize: '0.78rem',
                    lineHeight: 1.45,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                  {chapter.synopsis}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
