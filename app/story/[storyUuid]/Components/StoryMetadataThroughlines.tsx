'use client';

import { Box, CircularProgress, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useEffect, useState } from 'react';
import { useSemanticSearchStore } from '@/app/stores/useSemanticSearchStore';
import { ThreadModal } from '@/components/ThreadModal';
// Single brand accent — the FACTS / FEELINGS / IDENTITY split is internal.
const ACCENT = '#F96044';
import { getThreadsForTestimony, type ThreadSummary } from '@/lib/weaviate/threads';
import { colors } from '@/lib/theme';

/** Inventory of every cross-source throughline that this recording
 * participates in. Each row → ThreadModal. The list is the truthful answer
 * to "show me everything that connects this recording to others".
 */
export const StoryMetadataThroughlines = () => {
  const storyHubPage = useSemanticSearchStore((s) => s.storyHubPage);
  const theirstoryId = storyHubPage?.uuid ?? '';
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [activeUuid, setActiveUuid] = useState<string | null>(null);

  useEffect(() => {
    if (!theirstoryId) return;
    let cancelled = false;
    setThreads(null);
    getThreadsForTestimony(theirstoryId)
      .then((rows) => {
        if (!cancelled) setThreads(rows);
      })
      .catch((err) => {
        console.error('Failed to load throughlines:', err);
        if (!cancelled) setThreads([]);
      });
    return () => {
      cancelled = true;
    };
  }, [theirstoryId]);

  if (threads === null) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={22} sx={{ color: 'secondary.main' }} />
      </Box>
    );
  }

  if (threads.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.85rem' }}>
          No throughlines found yet — they appear once at least three recordings answer the same question.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography
        sx={{
          color: colors.text.secondary,
          fontSize: '0.78rem',
          fontStyle: 'italic',
          mb: 0.5,
        }}>
        Cross-source questions this recording helps answer.
      </Typography>
      {threads.map((t) => {
        return (
          <Box
            key={t.uuid}
            component="button"
            onClick={() => setActiveUuid(t.uuid)}
            sx={{
              cursor: 'pointer',
              textAlign: 'left',
              background: colors.common.white,
              border: '1px solid',
              borderColor: colors.grey[200],
              borderLeft: '3px solid',
              borderLeftColor: ACCENT,
              borderRadius: 2,
              px: 1.75,
              py: 1.25,
              transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
              '&:hover': {
                borderColor: ACCENT,
                boxShadow: '0 6px 18px rgba(15, 23, 42, 0.06)',
              },
            }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
              <AutoAwesomeIcon sx={{ fontSize: 14, color: ACCENT }} />
            </Box>
            <Typography
              sx={{
                fontFamily: 'var(--font-serif), Georgia, serif',
                fontSize: '0.95rem',
                fontWeight: 600,
                color: colors.text.primary,
                lineHeight: 1.3,
                mb: 0.5,
              }}>
              {t.display_label || t.theme_label}
            </Typography>
            {t.display_description && (
              <Typography sx={{ color: colors.text.secondary, fontSize: '0.78rem', lineHeight: 1.45 }}>
                {t.display_description}
              </Typography>
            )}
            <Typography
              sx={{
                color: colors.text.secondary,
                fontSize: '0.7rem',
                fontWeight: 600,
                mt: 0.6,
                letterSpacing: '0.04em',
              }}>
              {t.source_count} {t.source_count === 1 ? 'recording' : 'recordings'}
              {t.local_chunk_count
                ? ` · ${t.local_chunk_count} ${t.local_chunk_count === 1 ? 'mention' : 'mentions'} here`
                : ''}
            </Typography>
          </Box>
        );
      })}
      {activeUuid && (
        <ThreadModal open onClose={() => setActiveUuid(null)} threadUuid={activeUuid} currentStoryUuid={theirstoryId} />
      )}
    </Box>
  );
};
