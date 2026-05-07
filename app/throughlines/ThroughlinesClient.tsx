'use client';

import { useCallback, useEffect, useState } from 'react';
import { Box, CircularProgress, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import ViewStreamIcon from '@mui/icons-material/ViewStream';
import ViewWeekIcon from '@mui/icons-material/ViewWeek';
import { getThreadModalData, type ThreadModalData, type ThreadRecord } from '@/lib/weaviate/threads';
import type { EntitiesByType } from '@/lib/weaviate/entities';
import { colors } from '@/lib/theme';
import { RecordingsRenderer } from './RecordingsRenderer';
import { EntitiesBrowse } from './EntitiesBrowse';

// Single brand accent — the FACTS / FEELINGS / IDENTITY split is internal
// pipeline scaffolding, not editorial content.
const ACCENT = '#F96044';

// Hash routing: prefix `t:` for themes, `e:` for entities. Mode flips to the
// matching view automatically when a deep link comes in.
const THEME_PREFIX = 't:';
const ENTITY_PREFIX = 'e:';

type ViewMode = 'themes' | 'entities';

type Props = {
  threads: ThreadRecord[];
  entitiesByType: EntitiesByType[];
};

const readHash = (): { mode: ViewMode; uuid: string | null } => {
  if (typeof window === 'undefined') return { mode: 'themes', uuid: null };
  const raw = (window.location.hash ?? '').replace(/^#/, '');
  if (raw.startsWith(THEME_PREFIX)) return { mode: 'themes', uuid: raw.slice(THEME_PREFIX.length) || null };
  if (raw.startsWith(ENTITY_PREFIX)) return { mode: 'entities', uuid: raw.slice(ENTITY_PREFIX.length) || null };
  // Backward-compat: bare uuid means themes view (the old hash format).
  if (raw) return { mode: 'themes', uuid: raw };
  return { mode: 'themes', uuid: null };
};

export const ThroughlinesClient = ({ threads, entitiesByType }: Props) => {
  const [viewMode, setViewMode] = useState<ViewMode>('themes');
  const [hashThemeUuid, setHashThemeUuid] = useState<string | null>(null);
  const [hashEntityUuid, setHashEntityUuid] = useState<string | null>(null);

  // On mount, read the hash. Stay in sync with browser back/forward too.
  useEffect(() => {
    const apply = () => {
      const { mode, uuid } = readHash();
      setViewMode(mode);
      if (mode === 'themes') setHashThemeUuid(uuid);
      else setHashEntityUuid(uuid);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  const switchMode = (next: ViewMode) => {
    setViewMode(next);
    // Update the URL hash to reflect the mode without a uuid (or with one if
    // the user already had a selection in that mode).
    const carry = next === 'themes' ? hashThemeUuid : hashEntityUuid;
    const prefix = next === 'themes' ? THEME_PREFIX : ENTITY_PREFIX;
    if (typeof window !== 'undefined') {
      const next_hash = carry ? `#${prefix}${carry}` : `#${prefix}`;
      window.history.replaceState(null, '', next_hash);
    }
  };

  const setHashUuidForMode = useCallback((mode: ViewMode, uuid: string | null) => {
    const prefix = mode === 'themes' ? THEME_PREFIX : ENTITY_PREFIX;
    if (typeof window === 'undefined') return;
    const hash = uuid ? `#${prefix}${uuid}` : `#${prefix}`;
    window.history.replaceState(null, '', hash);
  }, []);

  return (
    <>
      <Box
        sx={{
          px: { xs: 2, md: 4 },
          py: { xs: 1.5, md: 2 },
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 1.5,
          flexWrap: 'wrap',
        }}>
        <Box>
          <Typography
            variant="overline"
            sx={{
              letterSpacing: '0.2em',
              color: 'secondary.main',
              fontWeight: 700,
              fontSize: { xs: '0.7rem', md: '0.75rem' },
            }}>
            Throughlines
          </Typography>
          <Typography
            sx={{
              fontFamily: 'var(--font-display), Helvetica, sans-serif',
              fontSize: { xs: '1.5rem', md: '1.85rem' },
              color: 'common.black',
              letterSpacing: '0.01em',
              lineHeight: 1.1,
              mt: 0.25,
            }}>
            {viewMode === 'themes' ? 'Themes across the archive' : 'Entities across the archive'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            size="small"
            onChange={(_e, v) => v && switchMode(v)}
            aria-label="throughlines view mode">
            <ToggleButton value="themes" aria-label="themes" sx={{ textTransform: 'none', px: 1.5 }}>
              Themes
            </ToggleButton>
            <ToggleButton value="entities" aria-label="entities" sx={{ textTransform: 'none', px: 1.5 }}>
              Entities
            </ToggleButton>
          </ToggleButtonGroup>
          <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem', maxWidth: 460, textAlign: 'right' }}>
            {viewMode === 'themes'
              ? 'Each theme is a thread that runs through several recordings. Pick one to read how different narrators answered the same human question, side by side.'
              : 'Browse the people, places, and events that appear across multiple recordings. Pick one to see how each narrator references it.'}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {viewMode === 'themes' ? (
          <ThemesBranch
            threads={threads}
            hashUuid={hashThemeUuid}
            setHashUuid={(u) => setHashUuidForMode('themes', u)}
          />
        ) : (
          <EntitiesBrowse
            entitiesByType={entitiesByType}
            hashUuid={hashEntityUuid}
            setHashUuid={(u) => setHashUuidForMode('entities', u)}
          />
        )}
      </Box>
    </>
  );
};

type ThemesBranchProps = {
  threads: ThreadRecord[];
  hashUuid: string | null;
  setHashUuid: (uuid: string | null) => void;
};

const ThemesBranch = ({ threads, hashUuid, setHashUuid }: ThemesBranchProps) => {
  const [activeUuid, setActiveUuid] = useState<string | null>(hashUuid);
  const [data, setData] = useState<ThreadModalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedRecordings, setExpandedRecordings] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'stack' | 'compare'>('stack');

  // Pick a default selection when there's nothing in the hash.
  useEffect(() => {
    if (activeUuid) return;
    if (hashUuid && threads.some((t) => t.uuid === hashUuid)) setActiveUuid(hashUuid);
    else if (threads.length > 0) setActiveUuid(threads[0].uuid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads]);

  // Sync incoming hash changes.
  useEffect(() => {
    if (!hashUuid) return;
    if (hashUuid !== activeUuid && threads.some((t) => t.uuid === hashUuid)) setActiveUuid(hashUuid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashUuid]);

  useEffect(() => {
    if (!activeUuid) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData(null);
    getThreadModalData(activeUuid)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setExpandedRecordings(new Set(result?.recordings.map((r) => r.theirstory_id) ?? []));
      })
      .catch((err) => {
        console.error('ThemesBranch: load failed', err);
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeUuid]);

  const select = useCallback(
    (uuid: string) => {
      setActiveUuid(uuid);
      setHashUuid(uuid);
    },
    [setHashUuid],
  );

  const toggleRecording = useCallback((theirstoryId: string) => {
    setExpandedRecordings((prev) => {
      const next = new Set(prev);
      if (next.has(theirstoryId)) next.delete(theirstoryId);
      else next.add(theirstoryId);
      return next;
    });
  }, []);

  const handleExcerptClick = useCallback((theirstoryId: string, startTime: number) => {
    const url = `/story/${theirstoryId}?start=${startTime}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const detailProps = data?.thread.properties;

  if (threads.length === 0) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%', p: 4 }}>
        <Typography sx={{ color: colors.text.secondary, textAlign: 'center', maxWidth: 480 }}>
          No throughlines yet — they appear once at least three recordings answer the same question.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: '100%',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(320px, 380px) minmax(0, 1fr)' },
      }}>
      {/* Left: themes list */}
      <Box
        sx={{
          borderRight: { xs: 'none', md: '1px solid' },
          borderBottom: { xs: '1px solid', md: 'none' },
          borderColor: 'divider',
          overflowY: 'auto',
          maxHeight: { xs: '46vh', md: 'calc(100dvh - 56px - 90px)' },
        }}>
        {threads.map((t) => {
          const props = t.properties;
          const isActive = t.uuid === activeUuid;
          const sourceCount = (props.source_count as number) ?? 0;
          return (
            <Box
              key={t.uuid}
              onClick={() => select(t.uuid)}
              sx={{
                cursor: 'pointer',
                display: 'block',
                borderLeft: '3px solid',
                borderLeftColor: isActive ? ACCENT : 'transparent',
                borderBottom: '1px solid',
                borderBottomColor: colors.grey[200],
                px: { xs: 2, md: 2.5 },
                py: 1.5,
                bgcolor: isActive ? 'rgba(249, 96, 68, 0.06)' : 'transparent',
                transition: 'background 0.15s ease, border-color 0.15s ease',
                '&:hover': {
                  bgcolor: isActive ? 'rgba(249, 96, 68, 0.10)' : 'rgba(0,0,0,0.03)',
                },
              }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                <Typography sx={{ fontSize: '0.72rem', color: colors.text.secondary, ml: 'auto' }}>
                  {sourceCount} {sourceCount === 1 ? 'recording' : 'recordings'}
                </Typography>
              </Box>
              <Typography
                sx={{
                  fontFamily: 'var(--font-serif), Georgia, serif',
                  fontSize: '1rem',
                  fontWeight: 600,
                  color: isActive ? ACCENT : colors.text.primary,
                  lineHeight: 1.3,
                }}>
                {t.display_label || (props.theme_label as string) || 'Throughline'}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* Right: theme detail */}
      <Box sx={{ overflowY: 'auto', maxHeight: { xs: 'auto', md: 'calc(100dvh - 56px - 90px)' } }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress sx={{ color: 'secondary.main' }} />
          </Box>
        ) : !data ? (
          <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 200, p: 4 }}>
            <Typography sx={{ color: colors.text.secondary, fontSize: '0.9rem' }}>
              Pick a throughline on the left to read every recording's response.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ p: { xs: 2, md: 3 } }}>
            {/* Theme header */}
            <Box
              sx={{
                bgcolor: colors.common.white,
                border: '1px solid',
                borderColor: colors.grey[200],
                borderRadius: 2,
                p: { xs: 2, md: 2.5 },
                mb: 2,
              }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Box
                  component="span"
                  sx={{
                    color: ACCENT,
                    border: '1px solid',
                    borderColor: ACCENT,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    px: 1.25,
                    py: 0.35,
                    borderRadius: 999,
                  }}>
                  {(detailProps?.source_count as number) ?? data.recordings.length} recordings
                </Box>
              </Box>
              <Typography
                sx={{
                  fontFamily: 'var(--font-serif), Georgia, serif',
                  fontSize: { xs: '1.5rem', md: '1.85rem' },
                  fontWeight: 700,
                  color: colors.text.primary,
                  lineHeight: 1.15,
                  mb: 1,
                }}>
                {data.thread.display_label || (detailProps?.theme_label as string) || ''}
              </Typography>
              {data.thread.display_description && (
                <Typography
                  sx={{
                    color: colors.text.secondary,
                    fontSize: { xs: '0.95rem', md: '1rem' },
                    lineHeight: 1.5,
                  }}>
                  {data.thread.display_description}
                </Typography>
              )}

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
                <ToggleButtonGroup
                  value={viewMode}
                  exclusive
                  size="small"
                  onChange={(_e, v) => v && setViewMode(v)}
                  aria-label="recordings view mode">
                  <ToggleButton value="stack" aria-label="stack" sx={{ textTransform: 'none', px: 1.5 }}>
                    <ViewStreamIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Stack
                  </ToggleButton>
                  <ToggleButton value="compare" aria-label="compare" sx={{ textTransform: 'none', px: 1.5 }}>
                    <ViewWeekIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Compare
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </Box>

            <RecordingsRenderer
              recordings={data.recordings}
              viewMode={viewMode}
              expandedRecordings={expandedRecordings}
              onToggleRecording={toggleRecording}
              onExcerptClick={handleExcerptClick}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};
