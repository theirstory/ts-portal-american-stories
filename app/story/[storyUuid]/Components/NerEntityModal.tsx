'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Box,
  Typography,
  Tabs,
  Tab,
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
import { useSemanticSearchStore } from '@/app/stores/useSemanticSearchStore';
import { getNerColor, getNerDisplayName } from '@/config/organizationConfig';
import { searchNerEntitiesAcrossCollection } from '@/lib/weaviate/search';
import { fetchEntityByUuid, searchChunksByEntityUuid, type EntityRecord } from '@/lib/weaviate/entities';
import { WeaviateGenericObject } from 'weaviate-client';
import { Chunks, EntityMention } from '@/types/weaviate';
import { colors } from '@/lib/theme';
import { Word } from '@/types/transcription';
import { useTranscriptNavigation } from '@/app/hooks/useTranscriptNavigation';
import { formatTime } from '@/app/utils/util';

type HighlightPart = string | { highlight: true; text: string };

interface NerDataItem {
  text: string;
  label: string;
  start_time: number;
  end_time: number;
}

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
  currentStoryUuid?: string;
  /** Hide the "In the interview" tab (used on pages with no current story, e.g. the homepage word cloud). */
  hideInterviewTab?: boolean;
}

interface EntityOccurrence {
  text: string;
  start_time: number;
  end_time: number;
  context: string;
  expandedContext: string;
  highlightedContext: HighlightPart[];
  expandedHighlightedContext: HighlightPart[];
  interview_title?: string;
  story_uuid?: string;
}

interface ExpandableHighlightedTextProps {
  collapsedText?: string;
  expandedText?: string;
  collapsedHighlightedParts?: HighlightPart[] | null;
  expandedHighlightedParts?: HighlightPart[] | null;
  collapsedLines?: number;
}

const COLLAPSED_WORD_WINDOW = 10;
const EXPANDED_WORD_WINDOW = 50;
const COLLAPSED_CHAR_WINDOW = 40;
const EXPANDED_CHAR_WINDOW = 200;
const DUPLICATE_TIME_EPSILON = 0.001;

const normalizeNerData = (nerData: unknown[]): NerDataItem[] =>
  nerData.filter(
    (item): item is NerDataItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as NerDataItem).text === 'string' &&
      typeof (item as NerDataItem).label === 'string' &&
      typeof (item as NerDataItem).start_time === 'number' &&
      typeof (item as NerDataItem).end_time === 'number',
  );

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
          {expanded ? 'Expand less' : 'Expand more'}
        </Button>
      )}
    </Box>
  );
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildEntityRegex = (entityText: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}'’])${escapeRegExp(entityText)}(?![\\p{L}\\p{N}'’])`, 'giu');

const createHighlightedParts = (text: string, entityText: string): HighlightPart[] => {
  const entityRegex = buildEntityRegex(entityText);
  const matches = text.match(entityRegex);
  if (!matches?.length) return [text] as HighlightPart[];

  let matchIndex = 0;
  return text.split(entityRegex).reduce((acc, part, index, array) => {
    if (index === array.length - 1) {
      return [...acc, part];
    }
    const matchText = matches[matchIndex] || entityText;
    matchIndex += 1;
    return [...acc, part, { highlight: true, text: matchText }];
  }, [] as HighlightPart[]);
};

const buildContextWindow = (words: Word[], centerIndex: number, window: number) => {
  const startIndex = Math.max(0, centerIndex - window);
  const endIndex = Math.min(words.length - 1, centerIndex + window);
  const hasLeadingText = startIndex > 0;
  const hasTrailingText = endIndex < words.length - 1;
  return `${hasLeadingText ? '... ' : ''}${words
    .slice(startIndex, endIndex + 1)
    .map((word) => word.text)
    .join(' ')}${hasTrailingText ? ' ...' : ''}`;
};

const getTargetWordIndex = (words: Word[], targetStartTime: number, targetEndTime: number) => {
  const overlappingWords = words.filter(
    (word) =>
      (word.start >= targetStartTime && word.start <= targetEndTime) ||
      (word.end >= targetStartTime && word.end <= targetEndTime) ||
      (word.start <= targetStartTime && word.end >= targetEndTime),
  );

  if (overlappingWords.length > 0) {
    return words.indexOf(overlappingWords[0]);
  }

  const targetMidpoint = (targetStartTime + targetEndTime) / 2;
  const closestWord = words.reduce((closest, word) => {
    const wordMidpoint = (word.start + word.end) / 2;
    const closestMidpoint = (closest.start + closest.end) / 2;
    return Math.abs(wordMidpoint - targetMidpoint) < Math.abs(closestMidpoint - targetMidpoint) ? word : closest;
  });

  return words.indexOf(closestWord);
};

const getContextAroundTime = (
  words: Word[],
  targetStartTime: number,
  targetEndTime: number,
  entityText: string,
): Pick<EntityOccurrence, 'context' | 'expandedContext' | 'highlightedContext' | 'expandedHighlightedContext'> => {
  if (!words || words.length === 0) {
    return {
      context: '',
      expandedContext: '',
      highlightedContext: [],
      expandedHighlightedContext: [],
    };
  }

  const targetWordIndex = getTargetWordIndex(words, targetStartTime, targetEndTime);
  const collapsed = buildContextWindow(words, targetWordIndex, COLLAPSED_WORD_WINDOW);
  const expanded = buildContextWindow(words, targetWordIndex, EXPANDED_WORD_WINDOW);

  return {
    context: collapsed,
    expandedContext: expanded,
    highlightedContext: createHighlightedParts(collapsed, entityText),
    expandedHighlightedContext: createHighlightedParts(expanded, entityText),
  };
};

export const NerEntityModal: React.FC<NerEntityModalProps> = ({
  open,
  onClose,
  entityText,
  entityLabel,
  entityUuid,
  currentStoryUuid,
  hideInterviewTab = false,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [tabValue, setTabValue] = useState(hideInterviewTab ? 1 : 0);
  const [loading, setLoading] = useState(false);
  const [collectionOccurrences, setCollectionOccurrences] = useState<WeaviateGenericObject<Chunks, any>[]>([]);
  const [projectMentionCount, setProjectMentionCount] = useState<number | null>(null);
  const [projectRecordingCount, setProjectRecordingCount] = useState<number | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [canonicalEntity, setCanonicalEntity] = useState<EntityRecord | null>(null);
  const { storyHubPage, setUpdateSelectedNerLabel, selected_ner_labels, allWords } = useSemanticSearchStore();
  const { seekAndScroll } = useTranscriptNavigation();
  const nerLabel = entityLabel as (typeof selected_ner_labels)[number];

  const labelColor = useMemo(() => getNerColor(entityLabel), [entityLabel]);
  const labelDisplayName = useMemo(() => getNerDisplayName(entityLabel), [entityLabel]);

  // Pull the precise entity_mentions list from the testimony when available;
  // fall back to the legacy ner_data shape for un-backfilled stories.
  const testimonyMentions = useMemo<EntityMention[]>(() => {
    const props = storyHubPage?.properties;
    const mentions = (props as { entity_mentions?: EntityMention[] } | undefined)?.entity_mentions;
    if (Array.isArray(mentions) && mentions.length > 0) return mentions;
    return normalizeNerData((props?.ner_data as unknown[]) ?? []) as unknown as EntityMention[];
  }, [storyHubPage]);

  // Get occurrences in current interview
  const currentInterviewOccurrences = useMemo<EntityOccurrence[]>(() => {
    if (!testimonyMentions.length || !allWords) return [];

    // Prefer exact entity_uuid match; fall back to text+label for legacy data.
    const filtered = testimonyMentions
      .filter((m: any) => {
        if (entityUuid && m.entity_uuid) return m.entity_uuid === entityUuid;
        const mentionText = (m.canonical_form ?? m.text ?? '').toLowerCase();
        return mentionText === entityText.toLowerCase() && m.label === entityLabel;
      })
      .sort((a: any, b: any) => a.start_time - b.start_time);

    const unique = filtered.filter(
      (m: any, index, arr) =>
        index === 0 || Math.abs(m.start_time - arr[index - 1].start_time) > DUPLICATE_TIME_EPSILON,
    );

    return unique.map(
      (m: any): EntityOccurrence => ({
        text: m.text || m.canonical_form || entityText,
        start_time: m.start_time,
        end_time: m.end_time,
        ...getContextAroundTime(allWords, m.start_time, m.end_time, m.text || m.canonical_form || entityText),
      }),
    );
  }, [allWords, entityLabel, entityText, entityUuid, testimonyMentions]);

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

    const loader = entityUuid
      ? searchChunksByEntityUuid(entityUuid, { excludeTestimonyId: currentStoryUuid, limit: 10_000 }).then(
          (objects) => ({
            objects,
          }),
        )
      : searchNerEntitiesAcrossCollection(entityText, entityLabel, currentStoryUuid, 10_000);

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
    entityText: string,
    window: number = COLLAPSED_CHAR_WINDOW,
  ): { text: string; highlightedParts: HighlightPart[] } | null => {
    const source = transcription;
    const entityRegex = buildEntityRegex(entityText);
    const match = entityRegex.exec(source);
    const matchStart = match?.index ?? -1;

    if (matchStart === -1) return null;

    const matchText = match?.[0] ?? entityText;
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

  const handleCurrentInterviewClick = (occurrence: EntityOccurrence) => {
    // Ensure the NER filter is enabled (don't toggle if already on)
    if (!selected_ner_labels.includes(nerLabel)) {
      setUpdateSelectedNerLabel(nerLabel);
    }

    seekAndScroll(occurrence.start_time);

    onClose();
  };

  const handleCollectionClick = (occurrence: WeaviateGenericObject<Chunks, any>) => {
    if (occurrence.uuid) {
      const url = `/story/${occurrence.properties.theirstory_id}?start=${occurrence.properties.start_time}&end=${occurrence.properties.end_time}&nerLabel=${entityLabel}`;
      window.open(url, '_blank');
      onClose();
    }
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  // Group project occurrences by recording (theirstory_id) for clearer display
  const occurrencesByRecording = useMemo(() => {
    const byId = new Map<
      string,
      { interview_title: string; theirstory_id: string; occurrences: WeaviateGenericObject<Chunks, any>[] }
    >();
    for (const obj of collectionOccurrences) {
      const props = obj.properties as ChunkProps;
      const id = props?.theirstory_id ?? '';
      const title = props?.interview_title ?? 'Unknown recording';
      if (!byId.has(id)) {
        byId.set(id, { interview_title: title, theirstory_id: id, occurrences: [] });
      }
      byId.get(id)!.occurrences.push(obj);
    }
    return Array.from(byId.values());
  }, [collectionOccurrences]);

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
  const interviewTabLabel = isMobile
    ? `Interview (${currentInterviewOccurrences.length})`
    : `In the interview (${currentInterviewOccurrences.length})`;
  const projectTabLabel =
    mentionCount > 0 || collectionOccurrences.length > 0
      ? isMobile
        ? `Project (${mentionCountDisplay})`
        : `In the project (${mentionCountDisplay} mention${mentionCount !== 1 ? 's' : ''} in ${recordingCount} recording${recordingCount !== 1 ? 's' : ''})`
      : isMobile
        ? 'Project'
        : 'In the project';

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
            borderBottom: '1px solid',
            borderColor: colors.grey[200],
            bgcolor: colors.common.white,
            position: 'sticky',
            top: 0,
            zIndex: 2,
          }}>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            aria-label="entity occurrences tabs"
            variant={isMobile ? 'scrollable' : 'standard'}
            scrollButtons={isMobile ? 'auto' : false}
            allowScrollButtonsMobile
            sx={{
              px: { xs: 1, md: 2 },
              minHeight: { xs: 56, md: 52 },
              '& .MuiTabs-scroller': {
                overflowX: isMobile ? 'auto !important' : 'hidden',
              },
              '& .MuiTabs-flexContainer': {
                gap: { xs: 1, md: 2 },
              },
              '& .MuiTabs-scrollButtons': {
                color: colors.primary.main,
              },
              '& .MuiTabs-indicator': {
                height: 3,
                borderRadius: '999px 999px 0 0',
                backgroundColor: colors.primary.main,
              },
            }}>
            {!hideInterviewTab && (
              <Tab
                value={0}
                label={interviewTabLabel}
                sx={{
                  textTransform: 'none',
                  minHeight: { xs: 56, md: 52 },
                  minWidth: 'max-content',
                  px: { xs: 1, md: 1.5 },
                  fontSize: { xs: '0.95rem', md: '0.82rem' },
                  fontWeight: 600,
                  color: colors.text.secondary,
                  '&.Mui-selected': {
                    color: colors.primary.main,
                  },
                }}
              />
            )}
            <Tab
              value={1}
              label={projectTabLabel}
              sx={{
                textTransform: 'none',
                minHeight: { xs: 56, md: 52 },
                minWidth: 'max-content',
                px: { xs: 1, md: 1.5 },
                fontSize: { xs: '0.95rem', md: '0.82rem' },
                fontWeight: 600,
                color: colors.text.secondary,
                '&.Mui-selected': {
                  color: colors.primary.main,
                },
              }}
            />
          </Tabs>
        </Box>

        {tabValue === 0 && !hideInterviewTab && (
          <Box
            sx={{
              p: { xs: 1.25, md: 1.5 },
              overflowY: 'auto',
              flex: 1,
            }}>
            {currentInterviewOccurrences.length === 0 ? (
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
                No occurrences found in this interview
              </Typography>
            ) : (
              <List sx={{ p: 0 }}>
                {currentInterviewOccurrences.map((occurrence: EntityOccurrence, index: number) => (
                  <ListItem
                    key={`${occurrence.start_time}-${occurrence.end_time}-${occurrence.text}-${index}`}
                    onClick={() => handleCurrentInterviewClick(occurrence)}
                    sx={{
                      cursor: 'pointer',
                      alignItems: 'stretch',
                      borderRadius: 3,
                      mb: 1,
                      px: { xs: 1.25, md: 1.5 },
                      py: { xs: 1.25, md: 1.25 },
                      bgcolor: colors.common.white,
                      boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
                      '&:hover': {
                        backgroundColor: colors.common.white,
                        borderColor: colors.primary.main,
                        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
                      },
                      border: '1px solid',
                      borderColor: colors.grey[200],
                    }}>
                    <Box sx={{ width: '100%' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ fontSize: { xs: '0.95rem', md: '0.84rem' }, fontWeight: 500 }}>
                          {formatTime(occurrence.start_time)}
                        </Typography>
                      </Box>

                      <ExpandableHighlightedText
                        collapsedText={occurrence.context}
                        expandedText={occurrence.expandedContext}
                        collapsedHighlightedParts={occurrence.highlightedContext}
                        expandedHighlightedParts={occurrence.expandedHighlightedContext}
                        collapsedLines={3}
                      />
                    </Box>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        )}

        {tabValue === 1 && (
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
                No occurrences found in other interviews
              </Typography>
            ) : (
              <>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5, px: { xs: 0.5, md: 0.25 }, fontSize: { xs: '1rem', md: '0.86rem' } }}>
                  {mentionCountDisplay} mention{mentionCount !== 1 ? 's' : ''} across {recordingCount} recording
                  {recordingCount !== 1 ? 's' : ''}
                </Typography>
                <List sx={{ p: 0 }}>
                  {occurrencesByRecording.map((group) => {
                    const isExpanded = expandedSections.has(group.theirstory_id);
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
                            borderColor: colors.grey[200],
                            borderRadius: isExpanded ? '14px 14px 0 0' : '14px',
                            cursor: 'pointer',
                            textAlign: 'left',
                            boxShadow: '0 4px 14px rgba(15, 23, 42, 0.05)',
                            '&:hover': {
                              backgroundColor: colors.common.white,
                              borderColor: colors.grey[300],
                            },
                          }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                            <Box
                              component="span"
                              sx={{
                                p: 0.25,
                                display: 'inline-flex',
                                alignItems: 'center',
                                color: colors.text.primary,
                              }}
                              aria-hidden="true">
                              {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            </Box>
                            <Typography
                              variant="subtitle1"
                              fontWeight="700"
                              color="primary"
                              noWrap
                              sx={{ fontSize: { xs: '1rem', md: '0.88rem' } }}>
                              {group.interview_title}
                            </Typography>
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
                                entityText,
                                COLLAPSED_CHAR_WINDOW,
                              );
                              const expandedContext = createSimpleContext(
                                transcription,
                                entityText,
                                EXPANDED_CHAR_WINDOW,
                              );

                              return (
                                <ListItem
                                  key={`${occurrence.uuid ?? occurrence.properties.theirstory_id}-${occurrence.properties.start_time}-${index}`}
                                  onClick={() => handleCollectionClick(occurrence)}
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
                                        {formatTime(occurrence.properties.start_time)}
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
        )}
      </DialogContent>
    </Dialog>
  );
};
