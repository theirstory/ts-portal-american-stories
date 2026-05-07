'use client';

import { Box, Typography } from '@mui/material';
import { useState } from 'react';
import { colors } from '@/lib/theme';

type Props = {
  text: string;
  /** When the visible (collapsed) line count differs from the default. */
  collapsedLines?: number;
  /** When estimated full text length is below this, hide the toggle entirely. */
  alwaysShowChars?: number;
};

/** Shows transcript prose with a "Show more" toggle. Collapses to a CSS
 * line-clamp; click "Show more" to render the full text inline. Reusable
 * across the throughline page, throughline modal, and entity modal. */
export const ExpandableExcerpt = ({ text, collapsedLines = 4, alwaysShowChars = 240 }: Props) => {
  const [expanded, setExpanded] = useState(false);

  if (!text) return null;
  // Cheap heuristic for whether expansion adds anything. CSS line-clamp is the
  // visual gate, but if the text is very short we still want to skip the
  // chrome.
  const showToggle = text.length > alwaysShowChars;

  return (
    <Box>
      <Typography
        sx={{
          color: colors.text.primary,
          fontSize: { xs: '0.95rem', md: '0.92rem' },
          lineHeight: 1.55,
          ...(expanded
            ? { whiteSpace: 'pre-wrap' }
            : {
                display: '-webkit-box',
                WebkitLineClamp: collapsedLines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }),
        }}>
        {text}
      </Typography>
      {showToggle && (
        <Box
          component="span"
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((p) => !p);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              setExpanded((p) => !p);
            }
          }}
          sx={{
            display: 'inline-block',
            mt: 0.5,
            cursor: 'pointer',
            color: 'secondary.main',
            fontSize: { xs: '0.85rem', md: '0.8rem' },
            fontWeight: 600,
            letterSpacing: '0.02em',
            '&:hover': { textDecoration: 'underline' },
          }}>
          {expanded ? 'Show less' : 'Show more'}
        </Box>
      )}
    </Box>
  );
};
