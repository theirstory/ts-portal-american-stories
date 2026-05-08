'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Box,
  Typography,
  List,
  ListItem,
  Collapse,
  CircularProgress,
  Button,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import { getNerColor, getNerDisplayName } from '@/config/organizationConfig';
import { searchNerEntitiesAcrossCollection } from '@/lib/weaviate/search';
import { fetchEntityByUuid, searchChunksByEntityUuid, type EntityRecord } from '@/lib/weaviate/entities';
import { WeaviateGenericObject } from 'weaviate-client';
import { Chunks } from '@/types/weaviate';
import { colors } from '@/lib/theme';
import { useTranscriptNavigation } from '@/app/hooks/useTranscriptNavigation';
import { formatTime } from '@/app/utils/util';
import { getMuxPlaybackId, getThumbnailTimeForTitle } from '@/app/utils/converters';

type HighlightPart = string | { highlight: true; text: string };

type ChunkProps = Partial<Chunks>;

interface NerEntityModalProps {
  open: boolean;
  onClose: () => void;
  entityText: string;
  entityLabel: string;
  /** Preferred: canonical Entities-collection UUID. When provided, occurrences
   * are looked up by exact entity reference (no text-overlap matching) and the
   * canonical entity card (Wikidata, description, relationships) is shown. */
  entityUuid?: string;
  /** Optional — the recording the user is currently inside. When set, that
   * recording is pinned to the top of the cross-source list. */
  currentStoryUuid?: string;
}

interface ExpandableHighlightedTextProps {
  collapsedText?: string;
  expandedText?: string;
  collapsedHighlightedParts?: HighlightPart[] | null;
  expandedHighlightedParts?: HighlightPart[] | null;
  collapsedLines?: number;
}

const COLLAPSED_CHAR_WINDOW = 40;
const EXPANDED_CHAR_WINDOW = 200;

const ExpandableHighlightedText: React.FC<ExpandableHighlightedTextProps> = ({
  collapsedText = '',
  expandedText,
  collapsedHighlightedParts,
  expandedHighlightedParts,
  collapsedLines = 3,
}) => {
  const [expanded, setExpanded] = useState(false);

  const collapsedPlainText = useMemo(() => {
    if (collapsedHighlightedParts && collapsedHighlightedParts.length > 0) {
      return collapsedHighlightedParts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
    }
    return collapsedText;
  }, [collapsedHighlightedParts, collapsedText]);

  const expandedPlainText = useMemo(() => {
    if (expandedHighlightedParts && expandedHighlightedParts.length > 0) {
      return expandedHighlightedParts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
    }
    return expandedText || collapsedText;
  }, [expandedHighlightedParts, expandedText, collapsedText]);

  const showExpand =
    expandedPlainText.trim().length > collapsedPlainText.trim().length || collapsedPlainText.includes('...');

  const partsToRender = expanded
    ? expandedHighlightedParts || [expandedText || collapsedText]
    : collapsedHighlightedParts || [collapsedText];

  return (
    <Box>
      <Typography
        variant="body2"
        sx={{
          lineHeight: 1.75,
          color: colors.text.primary,
          fontSize: { xs: '1rem', md: '0.9rem' },
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: expanded ? 'unset' : collapsedLines,
          overflow: expanded ? 'visible' : 'hidden',
          textOverflow: 'ellipsis',
        }}>
        {partsToRender.map((part, idx) =>
          typeof part === 'string' ? (
            <span key={idx}>{part}</span>
          ) : (
            <span
              key={idx}
              style={{
                backgroundColor: colors.warning.main,
                fontWeight: 700,
                padding: '1px 3px',
                borderRadius: '4px',
              }}>
              {part.text}
            </span>
          ),
        )}
      </Typography>

      {showExpand && (
        <Button
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            setExpanded((prev) => !prev);
          }}
          sx={{
            mt: 1,
            pl: 0,
            minWidth: 0,
            textTransform: 'none',
            fontWeight: 700,
            color: colors.primary.main,
            fontSize: { xs: '0.95rem', md: '0.82rem' },
          }}>
          {expanded ? 'Show less' : 'Show more'}
        </Button>
      )}
    </Box>
  );
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Build a single regex that matches any of the provided terms as whole words.
 * Longest-first ordering ensures "great grandmother" wins over "grandmother"
 * when both appear in the term list. */
const buildEntityRegex = (terms: string[]) => {
  const cleaned = Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean))).sort((a, b) => b.length - a.length);
  if (cleaned.length === 0) return null;
  const alt = cleaned.map(escapeRegExp).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}'’])(?:${alt})(?![\\p{L}\\p{N}'’])`, 'giu');
};

const createHighlightedParts = (text: string, terms: string[]): HighlightPart[] => {
  const entityRegex = buildEntityRegex(terms);
  if (!entityRegex) return [text] as HighlightPart[];
  const matches = text.match(entityRegex);
  if (!matches?.length) return [text] as HighlightPart[];

  let matchIndex = 0;
  return text.split(entityRegex).reduce((acc, part, index, array) => {
    if (index === array.length - 1) {
      return [...acc, part];
    }
    const matchText = matches[matchIndex] || terms[0] || '';
    matchIndex += 1;
    return [...acc, part, { highlight: true, text: matchText }];
  }, [] as HighlightPart[]);
};

export const NerEntityModal: React.FC<NerEntityModalProps> = ({
  open,
  onClose,
  entityText,
  entityLabel,
  entityUuid,
  currentStoryUuid,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [loading, setLoading] = useState(false);
  const [collectionOccurrences, setCollectionOccurrences] = useState<WeaviateGenericObject<Chunks, any>[]>([]);
  const [projectMentionCount, setProjectMentionCount] = useState<number | null>(null);
  const [projectRecordingCount, setProjectRecordingCount] = useState<number | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [canonicalEntity, setCanonicalEntity] = useState<EntityRecord | null>(null);

  const labelColor = useMemo(() => getNerColor(entityLabel), [entityLabel]);
  const labelDisplayName = useMemo(() => getNerDisplayName(entityLabel), [entityLabel]);

  // Match terms = canonical_form + every recorded surface variant. This is how
  // a click on the "mother" entity gets snippets containing "mom"/"mama" to
  // highlight: each variant becomes an alternation in one regex. Falls back to
  // the chip's display text when the canonical row hasn't loaded yet.
  const matchTerms = useMemo<string[]>(() => {
    const seen = new Set<string>();
    const terms: string[] = [];
    const push = (v: unknown) => {
      if (typeof v !== 'string') return;
      const t = v.trim();
      if (!t) return;
      const key = t.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      terms.push(t);
    };
    if (canonicalEntity) {
      push(canonicalEntity.properties.canonical_form);
      const variants = canonicalEntity.properties.variants;
      if (Array.isArray(variants)) for (const v of variants) push(v);
    }
    push(entityText);
    return terms;
  }, [canonicalEntity, entityText]);

  // Load canonical entity record (Wikidata, relationships, description) when
  // we have an entity_uuid. Cached per-uuid implicitly by React's effect deps.
  useEffect(() => {
    if (!open || !entityUuid) {
      setCanonicalEntity(null);
      return;
    }
    let cancelled = false;
    fetchEntityByUuid(entityUuid)
      .then((rec) => {
        if (!cancelled) setCanonicalEntity(rec);
      })
      .catch((err) => {
        console.error('Failed to fetch canonical entity:', err);
        if (!cancelled) setCanonicalEntity(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entityUuid]);

  // Load cross-source occurrences. With entity_uuid we use the precise
  // mentionsEntities cross-ref; otherwise we fall back to text-based search.
  useEffect(() => {
    if (!open) return;
    setProjectRecordingCount(null);
    setProjectMentionCount(null);
    setLoading(true);

    // Cross-source list now includes the current recording (pinned to top of
    // the grouped result below). Drop the previous excludeTestimonyId.
    const loader = entityUuid
      ? searchChunksByEntityUuid(entityUuid, { limit: 10_000 }).then((objects) => ({ objects }))
      : searchNerEntitiesAcrossCollection(entityText, entityLabel, undefined, 10_000);

    loader
      .then((searchResult) => {
        const objects = searchResult.objects;
        const recordingIds = new Set<string>();
        for (const obj of objects) {
          const id = (obj.properties as ChunkProps)?.theirstory_id;
          if (id) recordingIds.add(String(id));
        }
        setCollectionOccurrences(objects);
        setProjectMentionCount(objects.length);
        setProjectRecordingCount(recordingIds.size);
      })
      .catch((error) => {
        console.error('Error loading collection occurrences:', error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, entityText, entityLabel, entityUuid, currentStoryUuid]);

  const createSimpleContext = (
    transcription: string,
    terms: string[],
    window: number = COLLAPSED_CHAR_WINDOW,
  ): { text: string; highlightedParts: HighlightPart[] } | null => {
    const source = transcription;
    const entityRegex = buildEntityRegex(terms);
    if (!entityRegex) return null;
    const match = entityRegex.exec(source);
    const matchStart = match?.index ?? -1;

    if (matchStart === -1) return null;

    const matchText = match?.[0] ?? terms[0] ?? '';
    const matchEnd = matchStart + matchText.length;
    const start = Math.max(0, matchStart - window);
    const end = Math.min(source.length, matchEnd + window);
    const before = source.slice(start, matchStart);
    const after = source.slice(matchEnd, end);
    const hasLeadingText = start > 0;
    const hasTrailingText = end < source.length;

    const highlightedParts: HighlightPart[] = [];
    if (hasLeadingText) highlightedParts.push('...');
    highlightedParts.push(before);
    highlightedParts.push({ highlight: true, text: matchText });
    highlightedParts.push(after);
    if (hasTrailingText) highlightedParts.push('...');

    const text = `${hasLeadingText ? '...' : ''}${before}${matchText}${after}${hasTrailingText ? '...' : ''}`;

    return { text, highlightedParts };
  };

  const { seekAndScroll } = useTranscriptNavigation();

  /** Pick the precise mention range inside this chunk for the active entity.
   *
   * Each chunk is ~30s — 2 mins long, but every mention has word-level
   * start_time / end_time (e.g. mother@378.13-378.41 inside a chunk that
   * runs 347.89-405). Returning that exact range lets us:
   *   - seek the player to the word, not the chunk start (was off by up
   *     to 30 seconds);
   *   - pass the same range to /story?start&end so the transcript page's
   *     existing urlRangeHighlightFade animation lights up the entity
   *     word on arrival, not the whole chunk.
   *
   * `precise=true` means we found a real mention. When `precise=false`,
   * the entity_uuid wasn't supplied or the chunk lacks a matching
   * mention; we fall back to the chunk's range so the link still works.
   */
  const mentionRangeForChunk = (props: ChunkProps): { start: number; end: number; precise: boolean } => {
    const chunkStart = Number(props?.start_time ?? 0);
    const chunkEnd = Number(props?.end_time ?? chunkStart);
    if (!entityUuid) return { start: chunkStart, end: chunkEnd, precise: false };
    const mentions = (props?.entity_mentions ?? []) as Array<{
      entity_uuid?: string;
      start_time?: number;
      end_time?: number;
    }>;
    if (!Array.isArray(mentions) || mentions.length === 0) {
      return { start: chunkStart, end: chunkEnd, precise: false };
    }
    const hits = mentions
      .filter((m) => m?.entity_uuid === entityUuid && typeof m.start_time === 'number')
      .map((m) => ({
        start: Number(m.start_time),
        end: Number(m.end_time ?? m.start_time),
      }))
      .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end))
      .sort((a, b) => a.start - b.start);
    if (hits.length === 0) return { start: chunkStart, end: chunkEnd, precise: false };
    return { start: hits[0].start, end: hits[0].end, precise: true };
  };

  const handleRecordingExcerptClick = (occurrence: WeaviateGenericObject<Chunks, any>) => {
    const props = occurrence.properties as ChunkProps;
    const theirstoryId = String(props?.theirstory_id ?? '');
    if (!theirstoryId) return;
    const range = mentionRangeForChunk(props);
    if (currentStoryUuid && theirstoryId === currentStoryUuid) {
      // Same recording — seek inside the player instead of opening a new
      // tab. Lead in by half a second so listeners hear the run-up to the
      // word; the in-page transcript scroller doesn't run the URL-range
      // highlight animation, so this branch only cares about audio start.
      const seekTo = range.precise ? Math.max(0, range.start - 0.5) : range.start;
      seekAndScroll(seekTo);
      onClose();
      return;
    }
    // New-tab navigation: pass the mention's exact start/end so the
    // transcript page's urlRangeHighlightFade lands on the entity word
    // rather than spanning the whole chunk.
    const url = `/story/${theirstoryId}?start=${range.start}&end=${range.end}&nerLabel=${entityLabel}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    onClose();
  };

  // Group project occurrences by recording. Carry video_url + isAudioFile
  // through so the row can render a thumbnail. Pin the current recording to
  // the top of the list so the reader can jump back to where they were.
  type RecordingGroup = {
    interview_title: string;
    theirstory_id: string;
    video_url?: string;
    isAudioFile?: boolean;
    occurrences: WeaviateGenericObject<Chunks, any>[];
  };
  const occurrencesByRecording = useMemo<RecordingGroup[]>(() => {
    const byId = new Map<string, RecordingGroup>();
    for (const obj of collectionOccurrences) {
      const props = obj.properties as ChunkProps;
      const id = (props?.theirstory_id as string) ?? '';
      const title = (props?.interview_title as string) ?? 'Unknown recording';
      if (!byId.has(id)) {
        byId.set(id, {
          interview_title: title,
          theirstory_id: id,
          video_url: (props?.video_url as string) || undefined,
          isAudioFile: Boolean(props?.isAudioFile),
          occurrences: [],
        });
      }
      byId.get(id)!.occurrences.push(obj);
    }
    const list = Array.from(byId.values());
    // Pin the current recording first; the rest sort by mention count desc
    // so the most-resonant cross-source recordings come next.
    list.sort((a, b) => {
      const aCurrent = currentStoryUuid && a.theirstory_id === currentStoryUuid ? 1 : 0;
      const bCurrent = currentStoryUuid && b.theirstory_id === currentStoryUuid ? 1 : 0;
      if (aCurrent !== bCurrent) return bCurrent - aCurrent;
      return b.occurrences.length - a.occurrences.length;
    });
    return list;
  }, [collectionOccurrences, currentStoryUuid]);

  // When modal opens or entity/data changes, expand all recording sections by default
  useEffect(() => {
    if (open && occurrencesByRecording.length > 0) {
      setExpandedSections(new Set(occurrencesByRecording.map((g) => g.theirstory_id)));
    }
  }, [open, entityText, entityLabel, occurrencesByRecording]);

  const toggleSection = (theirstoryId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(theirstoryId)) next.delete(theirstoryId);
      else next.add(theirstoryId);
      return next;
    });
  };

  const recordingCount = projectRecordingCount ?? occurrencesByRecording.length;
  const mentionCount = projectMentionCount ?? collectionOccurrences.length;
  const mentionCountDisplay = mentionCount >= 10_000 ? '10,000+' : String(mentionCount);
  const summaryLine =
    mentionCount > 0
      ? `${mentionCountDisplay} mention${mentionCount !== 1 ? 's' : ''} across ${recordingCount} recording${recordingCount !== 1 ? 's' : ''}`
      : '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isMobile}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: isMobile ? 0 : 4,
          maxHeight: isMobile ? '100dvh' : '88vh',
          minHeight: isMobile ? '100dvh' : 'auto',
          bgcolor: colors.grey[50],
          overflow: 'hidden',
          boxShadow: isMobile ? 'none' : '0 24px 80px rgba(0,0,0,0.28)',
          width: isMobile ? '100%' : 'min(1000px, calc(100vw - 64px))',
        },
      }}>
      <DialogTitle
        sx={{
          m: 0,
          px: { xs: 2, md: 3 },
          py: { xs: 1.5, md: 1.75 },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: colors.grey[200],
          bgcolor: colors.common.white,
          position: 'sticky',
          top: 0,
          zIndex: 3,
        }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, pr: 1 }}>
          <Box
            component="span"
            sx={{
              backgroundColor: labelColor,
              color: colors.text.primary,
              fontWeight: 800,
              fontSize: { xs: '1rem', md: '0.88rem' },
              lineHeight: 1,
              px: { xs: 1.25, md: 1.15 },
              py: { xs: 0.85, md: 0.75 },
              borderRadius: '8px',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)',
              flexShrink: 0,
            }}>
            {labelDisplayName}
          </Box>
          <Typography
            variant="h6"
            component="div"
            sx={{
              fontWeight: 700,
              color: colors.text.primary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: { xs: '1.125rem', md: '1rem' },
            }}>
            {canonicalEntity?.properties.canonical_form || entityText}
          </Typography>
        </Box>

        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            color: colors.grey[500],
            ml: 1,
            flexShrink: 0,
          }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent
        dividers
        sx={{
          p: 0,
          bgcolor: colors.grey[50],
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
        {canonicalEntity && (
          <Box
            sx={{
              px: { xs: 2, md: 3 },
              py: { xs: 1.25, md: 1.5 },
              bgcolor: colors.common.white,
              borderBottom: '1px solid',
              borderColor: colors.grey[200],
            }}>
            {canonicalEntity.properties.context_summary && (
              <Typography
                variant="body2"
                sx={{
                  fontSize: { xs: '0.95rem', md: '0.85rem' },
                  color: colors.text.primary,
                  lineHeight: 1.5,
                  mb: canonicalEntity.properties.linked_data_url ? 0.75 : 0,
                }}>
                {canonicalEntity.properties.context_summary}
              </Typography>
            )}
            {canonicalEntity.properties.linked_data_url && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography
                  variant="caption"
                  sx={{ color: colors.text.secondary, fontSize: { xs: '0.85rem', md: '0.75rem' } }}>
                  Linked data:
                </Typography>
                <Typography
                  component="a"
                  href={canonicalEntity.properties.linked_data_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    color: colors.primary.main,
                    fontSize: { xs: '0.85rem', md: '0.75rem' },
                    fontWeight: 600,
                    textDecoration: 'none',
                    '&:hover': { textDecoration: 'underline' },
                  }}>
                  Wikidata {canonicalEntity.properties.linked_data_qid}
                </Typography>
                {canonicalEntity.properties.linked_data_description && (
                  <Typography
                    variant="caption"
                    sx={{ color: colors.text.secondary, fontSize: { xs: '0.85rem', md: '0.75rem' } }}>
                    — {canonicalEntity.properties.linked_data_description}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        )}
        <Box
          sx={{
            p: { xs: 1.25, md: 1.5 },
            overflowY: 'auto',
            flex: 1,
          }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : collectionOccurrences.length === 0 ? (
            <Typography
              color="text.secondary"
              sx={{
                textAlign: 'center',
                py: 6,
                px: 2,
                border: '1px dashed',
                borderColor: colors.grey[300],
                borderRadius: 3,
                bgcolor: colors.common.white,
              }}>
              No occurrences found across recordings.
            </Typography>
          ) : (
            <>
              {summaryLine && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5, px: { xs: 0.5, md: 0.25 }, fontSize: { xs: '1rem', md: '0.86rem' } }}>
                  {summaryLine}
                </Typography>
              )}
              <List sx={{ p: 0 }}>
                {occurrencesByRecording.map((group) => {
                  const isExpanded = expandedSections.has(group.theirstory_id);
                  const isCurrent = currentStoryUuid && group.theirstory_id === currentStoryUuid;
                  const playbackId = group.video_url ? getMuxPlaybackId(group.video_url) : null;
                  const thumbTime = getThumbnailTimeForTitle(group.interview_title);
                  return (
                    <Box key={group.theirstory_id} sx={{ mb: 2 }}>
                      <Box
                        component="button"
                        onClick={() => toggleSection(group.theirstory_id)}
                        sx={{
                          width: '100%',
                          lineHeight: 1.5,
                          py: { xs: 1.25, md: 1 },
                          px: { xs: 1.25, md: 1.25 },
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 1,
                          backgroundColor: colors.common.white,
                          border: '1px solid',
                          borderColor: isCurrent ? colors.primary.main : colors.grey[200],
                          borderRadius: isExpanded ? '14px 14px 0 0' : '14px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          boxShadow: '0 4px 14px rgba(15, 23, 42, 0.05)',
                          '&:hover': {
                            backgroundColor: colors.common.white,
                            borderColor: isCurrent ? colors.primary.main : colors.grey[300],
                          },
                        }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
                          <Box
                            component="span"
                            sx={{
                              p: 0.25,
                              display: 'inline-flex',
                              alignItems: 'center',
                              color: colors.text.primary,
                              flexShrink: 0,
                            }}
                            aria-hidden="true">
                            {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                          </Box>
                          {group.isAudioFile || !playbackId ? (
                            <Box
                              sx={{
                                width: { xs: 64, md: 72 },
                                aspectRatio: '16 / 9',
                                borderRadius: 1,
                                bgcolor: colors.grey[200],
                                display: 'grid',
                                placeItems: 'center',
                                flexShrink: 0,
                              }}
                              aria-hidden="true">
                              <GraphicEqIcon sx={{ fontSize: 18, color: colors.grey[500] }} />
                            </Box>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`https://image.mux.com/${playbackId}/thumbnail.jpg?time=${thumbTime}&width=180&height=101&fit_mode=crop`}
                              alt=""
                              loading="lazy"
                              style={{
                                width: 'min(72px, 18vw)',
                                aspectRatio: '16 / 9',
                                objectFit: 'cover',
                                borderRadius: 4,
                                flexShrink: 0,
                                display: 'block',
                                background: colors.grey[200],
                              }}
                            />
                          )}
                          <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <Typography
                              variant="subtitle1"
                              fontWeight="700"
                              color="primary"
                              noWrap
                              sx={{ fontSize: { xs: '1rem', md: '0.88rem' } }}>
                              {group.interview_title}
                            </Typography>
                            {isCurrent && (
                              <Typography
                                sx={{
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  letterSpacing: '0.06em',
                                  color: colors.primary.main,
                                  textTransform: 'uppercase',
                                }}>
                                You are here
                              </Typography>
                            )}
                          </Box>
                        </Box>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ fontSize: { xs: '0.95rem', md: '0.82rem' } }}>
                          {group.occurrences.length} mention{group.occurrences.length !== 1 ? 's' : ''}
                        </Typography>
                      </Box>
                      <Collapse in={isExpanded} timeout="auto">
                        <Box
                          sx={{
                            mt: 0.25,
                            p: { xs: 0.75, md: 0.75 },
                            border: '1px solid',
                            borderTop: 'none',
                            borderColor: colors.grey[200],
                            borderRadius: '0 0 14px 14px',
                            bgcolor: '#F8FAFC',
                          }}>
                          {group.occurrences.map((occurrence, index) => {
                            const transcription = occurrence.properties.transcription || '';
                            const collapsedContext = createSimpleContext(
                              transcription,
                              matchTerms,
                              COLLAPSED_CHAR_WINDOW,
                            );
                            const expandedContext = createSimpleContext(
                              transcription,
                              matchTerms,
                              EXPANDED_CHAR_WINDOW,
                            );

                            return (
                              <ListItem
                                key={`${occurrence.uuid ?? occurrence.properties.theirstory_id}-${occurrence.properties.start_time}-${index}`}
                                onClick={() => handleRecordingExcerptClick(occurrence)}
                                sx={{
                                  cursor: 'pointer',
                                  alignItems: 'stretch',
                                  borderRadius: 3,
                                  mb: index === group.occurrences.length - 1 ? 0 : 1,
                                  px: { xs: 1.25, md: 1.25 },
                                  py: { xs: 1.25, md: 1.1 },
                                  bgcolor: colors.common.white,
                                  '&:hover': {
                                    backgroundColor: colors.common.white,
                                    borderColor: colors.primary.main,
                                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
                                  },
                                  border: '1px solid',
                                  borderColor: colors.grey[200],
                                  boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
                                }}>
                                <Box sx={{ width: '100%' }}>
                                  <Box
                                    sx={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'flex-end',
                                      mb: 1,
                                    }}>
                                    <Typography
                                      variant="body2"
                                      color="text.secondary"
                                      sx={{ fontSize: { xs: '0.95rem', md: '0.84rem' }, fontWeight: 500 }}>
                                      {formatTime(mentionRangeForChunk(occurrence.properties as ChunkProps).start)}
                                    </Typography>
                                  </Box>

                                  <ExpandableHighlightedText
                                    collapsedText={collapsedContext?.text || transcription}
                                    expandedText={expandedContext?.text || transcription}
                                    collapsedHighlightedParts={collapsedContext?.highlightedParts || null}
                                    expandedHighlightedParts={expandedContext?.highlightedParts || null}
                                    collapsedLines={3}
                                  />
                                </Box>
                              </ListItem>
                            );
                          })}
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}
              </List>
            </>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
};
