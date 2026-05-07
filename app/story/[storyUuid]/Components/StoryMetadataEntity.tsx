import { useSemanticSearchStore } from '@/app/stores/useSemanticSearchStore';

import { Box, Chip, Typography, Tooltip, useMediaQuery } from '@mui/material';
import React, { useMemo, useState, useEffect } from 'react';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { getNerColor } from '@/config/organizationConfig';
import { groupBy } from 'lodash';
import usePlayerStore from '@/app/stores/usePlayerStore';
import { NerEntityModal } from './NerEntityModal';
import { colors, theme } from '@/lib/theme';
import { getNerEntityRecordingCounts } from '@/lib/weaviate/search';
import { getEntityRecordingCounts } from '@/lib/weaviate/entities';
import { useTranscriptNavigation } from '@/app/hooks/useTranscriptNavigation';

const recordingCountKey = (text: string, label: string) => `${text.toLowerCase()}|${label}`;
const DUPLICATE_TIME_EPSILON = 0.001;

type NerDataItem = {
  text: string;
  label: string;
  start_time: number;
  /** Present on entity_mentions; absent on legacy ner_data. */
  entity_uuid?: string;
  /** Present on entity_mentions; absent on legacy ner_data. */
  canonical_form?: string;
};

const isNerDataItem = (value: unknown): value is NerDataItem => {
  if (typeof value !== 'object' || value == null) return false;
  const maybe = value as Partial<NerDataItem>;
  return typeof maybe.text === 'string' && typeof maybe.label === 'string' && typeof maybe.start_time === 'number';
};

export const StoryMetadataEntity = () => {
  /**
   * hooks
   */
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'));

  /**
   * store
   */
  const { storyHubPage, selected_ner_labels, setUpdateSelectedNerLabel } = useSemanticSearchStore();
  const { currentTime } = usePlayerStore();
  const { seekAndScroll } = useTranscriptNavigation();

  /**
   * state
   */
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<{
    text: string;
    label: string;
    entity_uuid?: string;
  } | null>(null);
  const [recordingCounts, setRecordingCounts] = useState<Record<string, number>>({});

  /**
   * handlers
   */
  const handleOpenModal = (text: string, label: string, entity_uuid?: string) => {
    setSelectedEntity({ text, label, entity_uuid });
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedEntity(null);
  };

  const handleCategoryClick = (category: string) => {
    const categoryLabel = category as (typeof selected_ner_labels)[number];

    // Toggle the NER label on if it's not already selected
    if (!selected_ner_labels.includes(categoryLabel)) {
      setUpdateSelectedNerLabel(categoryLabel);
    }

    // Find all instances of this category/label
    const categoryInstances = normalizedNerData
      .filter((item) => item.label === category)
      .sort((a, b) => a.start_time - b.start_time);

    if (categoryInstances.length === 0) return;

    // Deduplicate instances that are very close together (within 0.001 seconds)
    const deduplicatedInstances = categoryInstances.filter(
      (instance, index, arr) =>
        index === 0 || Math.abs(instance.start_time - arr[index - 1].start_time) > DUPLICATE_TIME_EPSILON,
    );

    // Find the next instance after current time
    const nextInstance = deduplicatedInstances.find((item) => item.start_time > currentTime);

    // If no next instance, wrap around to the first one
    const targetInstance = nextInstance || deduplicatedInstances[0];

    if (targetInstance) {
      seekAndScroll(targetInstance.start_time);
    }
  };

  /**
   * variables
   */
  const { ner_data } = storyHubPage?.properties || {};
  // Prefer the precise per-occurrence list (carries entity_uuid + canonical_form);
  // fall back to legacy ner_data for un-backfilled testimonies.
  const mentionsSource = useMemo(() => {
    const props = storyHubPage?.properties as { entity_mentions?: unknown[] } | undefined;
    const mentions = props?.entity_mentions;
    if (Array.isArray(mentions) && mentions.length > 0) return mentions;
    return (ner_data as unknown[]) ?? [];
  }, [storyHubPage, ner_data]);
  const normalizedNerData = useMemo(() => mentionsSource.filter(isNerDataItem), [mentionsSource]);
  const currentStoryUuid = useMemo(() => {
    const props = (storyHubPage?.properties ?? {}) as Partial<{ theirstory_id: string }>;
    return props.theirstory_id;
  }, [storyHubPage?.properties]);

  const groupedEntities = useMemo(() => {
    const grouped = groupBy(normalizedNerData, 'label');

    return Object.fromEntries(
      Object.entries(grouped).map(([label, entries]) => {
        // Group by entity_uuid (preferred) so "Karen" and "Karen Matsuoka"
        // collapse to a single canonical chip. Falls back to text for legacy
        // un-backfilled testimonies that lack entity_uuid.
        type Acc = {
          entity_uuid?: string;
          display_text: string;
          start_times: number[];
        };
        const byKey = new Map<string, Acc>();

        for (const item of entries) {
          const key = item.entity_uuid || item.canonical_form?.toLowerCase() || item.text.toLowerCase();
          const display = item.canonical_form || item.text;
          const existing = byKey.get(key);
          if (existing) {
            existing.start_times.push(item.start_time);
          } else {
            byKey.set(key, {
              entity_uuid: item.entity_uuid,
              display_text: display,
              start_times: [item.start_time],
            });
          }
        }

        const uniqueItems = Array.from(byKey.values())
          .map(({ entity_uuid, display_text, start_times }) => {
            const sortedTimes = start_times.sort((a, b) => a - b);
            const uniqueTimes = sortedTimes.filter(
              (time, index, arr) => index === 0 || Math.abs(time - arr[index - 1]) > 0.001,
            );

            return {
              text: display_text,
              entity_uuid,
              count: uniqueTimes.length,
              start_times: uniqueTimes,
            };
          })
          .sort((a, b) => a.text.localeCompare(b.text));

        return [label, uniqueItems];
      }),
    );
  }, [normalizedNerData]);

  const entityList = useMemo(() => {
    const list: { text: string; label: string; entity_uuid?: string }[] = [];
    Object.entries(groupedEntities).forEach(([label, items]) => {
      items.forEach(({ text, entity_uuid }) => list.push({ text, label, entity_uuid }));
    });
    return list;
  }, [groupedEntities]);

  const entityListKey = useMemo(
    () =>
      entityList
        .map((e) => recordingCountKey(e.text, e.label))
        .sort()
        .join(','),
    [entityList],
  );

  useEffect(() => {
    if (entityList.length === 0) {
      setRecordingCounts({});
      return;
    }
    let cancelled = false;

    // When every entity has a canonical uuid, use the precise cross-ref count.
    // Otherwise fall back to legacy text-based aggregation. Chips render
    // immediately with their in-recording count; project counts populate
    // progressively as this resolves.
    const allHaveUuid = entityList.every((e) => Boolean(e.entity_uuid));
    const loader = allHaveUuid
      ? getEntityRecordingCounts(entityList.map((e) => e.entity_uuid as string)).then((byUuid) => {
          const out: Record<string, number> = {};
          for (const e of entityList) {
            if (e.entity_uuid && byUuid[e.entity_uuid] != null) {
              out[recordingCountKey(e.text, e.label)] = byUuid[e.entity_uuid];
            }
          }
          return out;
        })
      : getNerEntityRecordingCounts(entityList);

    loader.then((counts) => {
      if (!cancelled) setRecordingCounts(counts);
    });
    return () => {
      cancelled = true;
    };
  }, [entityList, entityListKey]);

  /**
   * render
   */
  return (
    <Box display="flex" flexDirection="column" gap={1}>
      {Object.entries(groupedEntities).map(([category, items]) => (
        <Box
          key={category}
          id="ner-category-container"
          sx={{ backgroundColor: colors.background.paper, borderRadius: 2, p: 1 }}>
          <Tooltip title={`Click to navigate to next ${category} instance`} arrow>
            <Box
              display="flex"
              alignItems="center"
              mb={0.5}
              gap={1}
              sx={{
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '8px',
                transition: 'background-color 0.2s ease',
                '&:hover': {
                  backgroundColor: colors.grey[100],
                },
              }}
              onClick={() => handleCategoryClick(category)}>
              <AutoAwesomeIcon fontSize="small" color="action" />
              <Typography variant="subtitle2" fontWeight="bold" color="info">
                {category}
              </Typography>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: getNerColor(category),
                }}
              />
              {!isMobile && <NavigateNextIcon fontSize="small" sx={{ opacity: 0.6, ml: 0.5 }} />}
            </Box>
          </Tooltip>
          <Box
            display="flex"
            flexWrap="wrap"
            gap={0.5}
            maxHeight="200px"
            overflow="auto"
            p={1}
            sx={{ borderRadius: 1 }}>
            {[...items]
              .sort((a, b) => {
                const recA = recordingCounts[recordingCountKey(a.text, category)] ?? 0;
                const recB = recordingCounts[recordingCountKey(b.text, category)] ?? 0;
                if (recB !== recA) return recB - recA;
                if (b.count !== a.count) return b.count - a.count;
                return a.text.localeCompare(b.text);
              })
              .map(({ text, count, entity_uuid }, index) => {
                const recCount = recordingCounts[recordingCountKey(text, category)];
                const recordingLabel = recCount != null ? ` in ${recCount} recording${recCount !== 1 ? 's' : ''}` : '';
                return (
                  <Tooltip
                    key={`${entity_uuid || text}-${category}-${index}`}
                    title={
                      recCount != null
                        ? `${count} mention${count !== 1 ? 's' : ''} in this recording · appears${recordingLabel}`
                        : `${count} mention${count !== 1 ? 's' : ''} in this recording`
                    }
                    arrow>
                    <Chip
                      id="ner-entity-chip"
                      variant="outlined"
                      label={
                        <>
                          <Box component="span" sx={{ fontWeight: 600 }}>
                            {text}
                          </Box>
                          <Box component="span" sx={{ fontWeight: 400, opacity: 0.85 }}>
                            {recCount != null
                              ? ` (${count} here · ${recCount} ${recCount === 1 ? 'recording' : 'recordings'})`
                              : ` (${count} here)`}
                          </Box>
                        </>
                      }
                      onClick={() => handleOpenModal(text, category, entity_uuid)}
                      clickable
                      size="small"
                      sx={{ fontSize: '0.75rem', height: 22, minHeight: 22 }}
                    />
                  </Tooltip>
                );
              })}
          </Box>
        </Box>
      ))}
      {selectedEntity && (
        <NerEntityModal
          open={modalOpen}
          onClose={handleCloseModal}
          entityText={selectedEntity.text}
          entityLabel={selectedEntity.label}
          entityUuid={selectedEntity.entity_uuid}
          currentStoryUuid={currentStoryUuid}
        />
      )}
    </Box>
  );
};
