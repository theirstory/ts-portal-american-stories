'use client';

import { Box, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { ThreadModal } from '@/components/ThreadModal';
import { useSemanticSearchStore } from '@/app/stores/useSemanticSearchStore';
import { getQuestionLevelColor, getQuestionLevelDisplayName } from '@/config/organizationConfig';
import type { ThreadSummary } from '@/lib/weaviate/threads';

type Props = {
  threads: ThreadSummary[];
};

/** Compact "also asked in N other recordings" affordance shown next to the
 * chapter title. Click opens the strongest thread (highest source_count); the
 * tooltip lists the rest if there's more than one.
 *
 * The cluster of other recordings is computed by Pass 2 — see
 * lib/weaviate/threads.ts:getThreadsByChapterForTestimony.
 */
export const StoryChapterThreadBadge = ({ threads }: Props) => {
  const [openUuid, setOpenUuid] = useState<string | null>(null);
  const currentStoryUuid = useSemanticSearchStore((s) => s.storyHubPage?.uuid);

  if (!threads || threads.length === 0) return null;

  const primary = threads[0];
  // Only badge a chapter that genuinely leans into the throughline — at
  // least 2 chunks from this chapter feed it. Chapters that just brush
  // against a thread once still appear in the Throughlines tab + the
  // tooltip on stronger chapters.
  const localCount = primary.local_chunk_count ?? 0;
  if (localCount < 2) return null;
  // source_count includes the narrator we're already on; "also" recordings is
  // count - 1 (clamped to 0).
  const otherCount = Math.max(0, primary.source_count - 1);
  if (otherCount === 0) return null;

  const tooltip = (
    <Box sx={{ p: 0.5, maxWidth: 320 }}>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, mb: 0.5, color: 'inherit' }}>
        {threads.length === 1 ? 'Cross-source throughline' : `${threads.length} cross-source throughlines`}
      </Typography>
      {threads.slice(0, 5).map((t) => (
        <Box
          key={t.uuid}
          component="span"
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            setOpenUuid(t.uuid);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              setOpenUuid(t.uuid);
            }
          }}
          sx={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            color: 'inherit',
            cursor: 'pointer',
            mb: 0.4,
            '&:hover': { textDecoration: 'underline' },
          }}>
          <Typography sx={{ fontSize: '0.74rem', fontWeight: 600 }}>{t.theme_label}</Typography>
          <Typography sx={{ fontSize: '0.7rem', opacity: 0.8 }}>
            {getQuestionLevelDisplayName(t.question_level)} · {t.source_count} recordings
          </Typography>
        </Box>
      ))}
    </Box>
  );

  const accent = getQuestionLevelColor(primary.question_level);

  // Important: the parent AccordionSummary is already a <button>, so this
  // affordance must NOT be a nested real <button> (invalid HTML, hydration
  // error). Use a span with the button role + keyboard handlers and stop
  // event propagation so the accordion doesn't toggle when activated.
  const activate = () => setOpenUuid(primary.uuid);

  return (
    <>
      <Tooltip title={tooltip} arrow placement="bottom-start">
        <Box
          component="span"
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            activate();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              activate();
            }
          }}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            background: 'rgba(255, 255, 255, 0.18)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            color: 'inherit',
            cursor: 'pointer',
            px: 1,
            py: 0.35,
            borderRadius: 999,
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.02em',
            transition: 'background 0.15s ease, border-color 0.15s ease',
            '&:hover': {
              background: 'rgba(255, 255, 255, 0.28)',
              borderColor: 'rgba(255, 255, 255, 0.4)',
            },
          }}>
          <AutoAwesomeIcon sx={{ fontSize: 12, color: accent }} />
          Also asked in {otherCount} other {otherCount === 1 ? 'recording' : 'recordings'}
        </Box>
      </Tooltip>
      {openUuid && (
        <ThreadModal open onClose={() => setOpenUuid(null)} threadUuid={openUuid} currentStoryUuid={currentStoryUuid} />
      )}
    </>
  );
};
