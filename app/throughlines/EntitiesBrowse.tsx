'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  CircularProgress,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ViewStreamIcon from '@mui/icons-material/ViewStream';
import ViewWeekIcon from '@mui/icons-material/ViewWeek';
import { getNerColor, getNerDisplayName } from '@/config/organizationConfig';
import {
  fetchEntityByUuid,
  searchChunksByEntityUuid,
  type EntitiesByType,
  type EntityRecord,
  type TopEntity,
} from '@/lib/weaviate/entities';
import { type Chunks } from '@/types/weaviate';
import { type ThreadModalRecording } from '@/lib/weaviate/threads';
import { colors } from '@/lib/theme';
import { RecordingsRenderer } from './RecordingsRenderer';

const HASH_PREFIX = 'e:';

type Props = {
  entitiesByType: EntitiesByType[];
  /** Read on mount + on hashchange so deep links to a specific entity work. */
  hashUuid: string | null;
  /** Update the URL hash when the user picks a different entity. */
  setHashUuid: (uuid: string | null) => void;
};

type RecordingDetail = {
  recordings: ThreadModalRecording[];
  canonical_entity: EntityRecord | null;
};

/** Group chunks pulled from searchChunksByEntityUuid into the same shape the
 * RecordingsRenderer consumes. Mirrors getThreadModalData's grouping. */
function groupChunksAsRecordings(chunks: Awaited<ReturnType<typeof searchChunksByEntityUuid>>): ThreadModalRecording[] {
  const byTestimony = new Map<string, ThreadModalRecording>();
  for (const obj of chunks) {
    const props = obj.properties as Partial<Chunks>;
    const theirstoryId = (props.theirstory_id as string) ?? '';
    if (!theirstoryId) continue;
    const excerpt = {
      chunk_uuid: obj.uuid as string,
      theirstory_id: theirstoryId,
      interview_title: (props.interview_title as string) ?? 'Untitled recording',
      start_time: Number(props.start_time ?? 0),
      end_time: Number(props.end_time ?? 0),
      transcription: (props.transcription as string) ?? '',
      segment_summary: (props.segment_summary as string) || undefined,
    };
    let row = byTestimony.get(theirstoryId);
    if (!row) {
      row = {
        theirstory_id: theirstoryId,
        interview_title: excerpt.interview_title,
        video_url: (props.video_url as string) || undefined,
        isAudioFile: Boolean(props.isAudioFile),
        excerpts: [],
      };
      byTestimony.set(theirstoryId, row);
    }
    row.excerpts.push(excerpt);
  }
  for (const row of byTestimony.values()) {
    row.excerpts.sort((a, b) => a.start_time - b.start_time);
  }
  // Strongest cross-source recordings first.
  return Array.from(byTestimony.values()).sort((a, b) => b.excerpts.length - a.excerpts.length);
}

export const EntitiesBrowse = ({ entitiesByType, hashUuid, setHashUuid }: Props) => {
  const [activeUuid, setActiveUuid] = useState<string | null>(hashUuid);
  const [openTypes, setOpenTypes] = useState<Set<string>>(() => {
    // Open the first non-empty type by default — usually PERSON.
    const firstWithEntities = entitiesByType.find((g) => g.entities.length > 0);
    return new Set(firstWithEntities ? [firstWithEntities.type] : []);
  });
  const [detail, setDetail] = useState<RecordingDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedRecordings, setExpandedRecordings] = useState<Set<string>>(new Set());
  const [recordingsView, setRecordingsView] = useState<'stack' | 'compare'>('stack');

  // Pick a sensible default if the URL hash didn't resolve to anything.
  useEffect(() => {
    if (activeUuid) return;
    const first = entitiesByType.find((g) => g.entities.length > 0)?.entities[0];
    if (first) {
      setActiveUuid(first.entity_uuid);
      // Don't push to URL on mount — user hasn't chosen yet.
    }
  }, [entitiesByType, activeUuid]);

  // Sync incoming hash → active selection.
  useEffect(() => {
    if (!hashUuid) return;
    if (hashUuid !== activeUuid) setActiveUuid(hashUuid);
    // Make sure the type group containing this entity is expanded.
    for (const group of entitiesByType) {
      if (group.entities.some((e) => e.entity_uuid === hashUuid)) {
        setOpenTypes((prev) => (prev.has(group.type) ? prev : new Set([...prev, group.type])));
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashUuid, entitiesByType]);

  // Load detail when activeUuid changes.
  useEffect(() => {
    if (!activeUuid) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    Promise.all([fetchEntityByUuid(activeUuid), searchChunksByEntityUuid(activeUuid, { limit: 200 })])
      .then(([canonical_entity, chunks]) => {
        if (cancelled) return;
        const recordings = groupChunksAsRecordings(chunks);
        setDetail({ canonical_entity, recordings });
        // Default to all recordings expanded so the reader sees content immediately.
        setExpandedRecordings(new Set(recordings.map((r) => r.theirstory_id)));
      })
      .catch((err) => {
        console.error('EntitiesBrowse: load failed', err);
        if (!cancelled) setDetail(null);
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

  const toggleType = (type: string) => {
    setOpenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const activeEntityRow = useMemo<TopEntity | null>(() => {
    if (!activeUuid) return null;
    for (const group of entitiesByType) {
      const hit = group.entities.find((e) => e.entity_uuid === activeUuid);
      if (hit) return hit;
    }
    return null;
  }, [activeUuid, entitiesByType]);

  if (entitiesByType.length === 0) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%', p: 4 }}>
        <Typography sx={{ color: colors.text.secondary, textAlign: 'center', maxWidth: 480 }}>
          No cross-recording entities yet. Entities surface here once they appear in at least two recordings.
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
      {/* Left rail — types collapsed/expanded with entity rows under each */}
      <Box
        sx={{
          borderRight: { xs: 'none', md: '1px solid' },
          borderBottom: { xs: '1px solid', md: 'none' },
          borderColor: 'divider',
          overflowY: 'auto',
          maxHeight: { xs: '46vh', md: 'calc(100dvh - 56px - 90px)' },
        }}>
        {entitiesByType.map((group) => {
          const open = openTypes.has(group.type);
          const accent = getNerColor(group.type);
          const totalEntities = group.entities.length;
          const totalRecordings = new Set(group.entities.flatMap((e) => Array(e.recording_count).fill(0))).size;
          void totalRecordings;
          return (
            <Box key={group.type} sx={{ borderBottom: '1px solid', borderColor: colors.grey[200] }}>
              <Box
                component="button"
                onClick={() => toggleType(group.type)}
                sx={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  px: { xs: 2, md: 2.5 },
                  py: 1.25,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  '&:hover': { background: 'rgba(0,0,0,0.03)' },
                }}>
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: accent,
                    flexShrink: 0,
                  }}
                />
                <Typography
                  sx={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: colors.text.primary,
                    flex: 1,
                  }}>
                  {getNerDisplayName(group.type)}
                </Typography>
                <Typography sx={{ fontSize: '0.72rem', color: colors.text.secondary, fontWeight: 500 }}>
                  {totalEntities}
                </Typography>
                <IconButton
                  size="small"
                  component="span"
                  sx={{ color: colors.text.secondary, p: 0 }}
                  aria-hidden="true">
                  {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </IconButton>
              </Box>
              {open && (
                <Box>
                  {group.entities.map((e) => {
                    const isActive = e.entity_uuid === activeUuid;
                    return (
                      <Box
                        key={e.entity_uuid}
                        component="button"
                        onClick={() => select(e.entity_uuid)}
                        sx={{
                          width: '100%',
                          textAlign: 'left',
                          background: isActive ? 'rgba(249, 96, 68, 0.06)' : 'transparent',
                          border: 'none',
                          borderLeft: '3px solid',
                          borderLeftColor: isActive ? 'secondary.main' : 'transparent',
                          cursor: 'pointer',
                          px: { xs: 2, md: 2.5 },
                          py: 1,
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 1,
                          transition: 'background 0.15s ease, border-color 0.15s ease',
                          '&:hover': {
                            background: isActive ? 'rgba(249, 96, 68, 0.10)' : 'rgba(0,0,0,0.03)',
                          },
                        }}>
                        <Typography
                          sx={{
                            fontSize: '0.92rem',
                            fontWeight: 600,
                            color: isActive ? 'secondary.main' : colors.text.primary,
                            lineHeight: 1.3,
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                          {e.canonical_form}
                        </Typography>
                        <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, fontWeight: 500 }}>
                          {e.recording_count}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Right detail panel */}
      <Box sx={{ overflowY: 'auto', maxHeight: { xs: 'auto', md: 'calc(100dvh - 56px - 90px)' } }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress sx={{ color: 'secondary.main' }} />
          </Box>
        ) : !detail || !activeEntityRow ? (
          <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 200, p: 4 }}>
            <Typography sx={{ color: colors.text.secondary, fontSize: '0.9rem' }}>
              Pick an entity on the left to see how it surfaces across recordings.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ p: { xs: 2, md: 3 } }}>
            {/* Header */}
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
                    backgroundColor: getNerColor(activeEntityRow.label),
                    color: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    lineHeight: 1,
                    px: 1,
                    py: 0.65,
                    borderRadius: '6px',
                  }}>
                  {getNerDisplayName(activeEntityRow.label)}
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
                {detail.canonical_entity?.properties.canonical_form || activeEntityRow.canonical_form}
              </Typography>
              {detail.canonical_entity?.properties.context_summary && (
                <Typography
                  sx={{
                    color: colors.text.secondary,
                    fontSize: { xs: '0.95rem', md: '1rem' },
                    lineHeight: 1.5,
                    mb: 1.25,
                  }}>
                  {detail.canonical_entity.properties.context_summary}
                </Typography>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
                <Box
                  component="span"
                  sx={{
                    color: 'secondary.main',
                    border: '1px solid',
                    borderColor: 'secondary.main',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    px: 1.25,
                    py: 0.35,
                    borderRadius: 999,
                  }}>
                  {detail.recordings.length} {detail.recordings.length === 1 ? 'recording' : 'recordings'}
                </Box>
                <Box
                  component="span"
                  sx={{
                    color: colors.text.secondary,
                    fontSize: '0.72rem',
                    fontWeight: 500,
                  }}>
                  {activeEntityRow.count} mention{activeEntityRow.count === 1 ? '' : 's'} across the project
                </Box>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
                <ToggleButtonGroup
                  value={recordingsView}
                  exclusive
                  size="small"
                  onChange={(_e, v) => v && setRecordingsView(v)}
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
              recordings={detail.recordings}
              viewMode={recordingsView}
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

export const ENTITY_HASH_PREFIX = HASH_PREFIX;
