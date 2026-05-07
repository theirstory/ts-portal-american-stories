'use client';

import { Box, Typography } from '@mui/material';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useSemanticSearchStore } from '@/app/stores/useSemanticSearchStore';
import { useSearchStore } from '@/app/stores/useSearchStore';
import usePlayerStore from '@/app/stores/usePlayerStore';
import { scrollElementIntoContainer } from '@/app/utils/scrollElementIntoContainer';
import { useTranscriptPanelStore } from '@/app/stores/useTranscriptPanelStore';
import { StoryTranscriptWord } from './StoryTranscriptWord';
import { StoryTranscriptNERGroupWords } from './StoryTranscriptNERGroupWords';
import { NerEntityModal } from './NerEntityModal';
import { WeaviateGenericObject } from 'weaviate-client';
import { Chunks } from '@/types/weaviate';
import { Paragraph, Word } from '@/types/transcription';
import { colors } from '@/lib/theme';
import { formatTime, isMobile } from '@/app/utils/util';
import { useTranscriptNavigation } from '@/app/hooks/useTranscriptNavigation';
import { getNerColor } from '@/config/organizationConfig';

type Props = {
  paragraph: Paragraph;
  wordsInParagraph: Word[];
  isProgrammaticScrollRef: React.MutableRefObject<boolean>;
  urlHighlightRange: { start: number; end: number } | null;
};

const getWordKey = (word: Word) => `s-${word.section_idx}-p-${word.para_idx}-word-${word.word_idx}`;

export const getSemanticMatchForWord = (semanticMatches: WeaviateGenericObject<Chunks, any>[], word: Word) => {
  return semanticMatches.find((match) => {
    const matchStart = match.properties?.start_time;
    const matchEnd = match.properties?.end_time;
    return word.start >= matchStart && word.end <= matchEnd;
  });
};

export const StoryTranscriptParagraph = memo(
  ({ paragraph, wordsInParagraph, isProgrammaticScrollRef, urlHighlightRange }: Props) => {
    const MATCH_EPSILON = 0.001;

    /**
     * store
     */
    const currentSemanticMatchIndex = useSemanticSearchStore((state) => state.currentMatchIndex);
    const semanticSearchMatches = useSemanticSearchStore((state) => state.matches);
    const storyHubPage = useSemanticSearchStore((state) => state.storyHubPage);
    const allWords = useSemanticSearchStore((state) => state.allWords);
    const selected_ner_labels = useSemanticSearchStore((state) => state.selected_ner_labels);

    const traditionalSearchMatches = useSearchStore((state) => state.matches);
    const traditionalCurrentMatchIndex = useSearchStore((state) => state.currentMatchIndex);
    const traditionalSearchTerm = useSearchStore((state) => state.searchTerm);

    const isPlaying = usePlayerStore((state) => state.isPlaying);
    const { seekOnly } = useTranscriptNavigation();
    const playbackTimeInParagraph = usePlayerStore((state) => {
      const t = state.currentTime;
      return t >= paragraph.start && t < paragraph.end ? t : null;
    });

    const isCurrentTimeOutOfView = useTranscriptPanelStore((state) => state.isCurrentTimeOutOfView);
    const targetScrollTime = useTranscriptPanelStore((state) => state.targetScrollTime);
    const setTargetScrollTime = useTranscriptPanelStore((state) => state.setTargetScrollTime);

    /**
     * refs
     */
    const paragraphRef = useRef<HTMLDivElement>(null);

    /**
     * variables
     */
    const { entity_mentions = [], ner_data = [] } = storyHubPage?.properties ?? {};
    // entity_mentions is the precise per-occurrence list (Phase 1C). Falls back
    // to ner_data for legacy testimonies that haven't been backfilled yet.
    const mentionsForHighlights: any[] =
      Array.isArray(entity_mentions) && entity_mentions.length > 0 ? entity_mentions : ner_data;
    const renderedWordIndexes = new Set<number>();
    const isMobileView = isMobile();
    const transcriptTopOffset = isMobileView ? -44 : -36;

    const hasTraditionalHighlight = traditionalSearchTerm.trim().length > 0;
    const hasSelectedNerLabels = selected_ner_labels.length > 0;
    const selectedNerLabelSet = useMemo(() => new Set(selected_ner_labels), [selected_ner_labels]);

    const nerMatchByWordIndex = useMemo(() => {
      if (!hasSelectedNerLabels || mentionsForHighlights.length === 0 || wordsInParagraph.length === 0) {
        return new Map<number, any>();
      }

      const selectedNers = mentionsForHighlights
        .filter((ner: any) => selectedNerLabelSet.has(ner.label))
        .sort((a: any, b: any) => a.start_time - b.start_time);

      if (selectedNers.length === 0) {
        return new Map<number, any>();
      }

      const matches = new Map<number, any>();
      let wordCursor = 0;

      for (const ner of selectedNers) {
        while (wordCursor < wordsInParagraph.length && wordsInParagraph[wordCursor].end < ner.start_time) {
          wordCursor++;
        }

        for (let i = wordCursor; i < wordsInParagraph.length; i++) {
          const word = wordsInParagraph[i];
          if (word.start > ner.end_time) break;

          if (word.start >= ner.start_time && word.end <= ner.end_time && !matches.has(i)) {
            matches.set(i, ner);
          }
        }
      }

      return matches;
    }, [hasSelectedNerLabels, mentionsForHighlights, selectedNerLabelSet, wordsInParagraph]);

    // Always-on subtle entity matches — used to render thin colored underlines
    // on entity spans regardless of the label-filter toggle. The toggle then
    // becomes a "highlight by category" focused-research mode on top of this.
    const allEntityMatchByWordIndex = useMemo(() => {
      if (mentionsForHighlights.length === 0 || wordsInParagraph.length === 0) {
        return new Map<number, any>();
      }
      const sorted = [...mentionsForHighlights].sort((a: any, b: any) => a.start_time - b.start_time);
      const matches = new Map<number, any>();
      let cursor = 0;
      for (const ner of sorted) {
        while (cursor < wordsInParagraph.length && wordsInParagraph[cursor].end < ner.start_time) {
          cursor += 1;
        }
        for (let i = cursor; i < wordsInParagraph.length; i += 1) {
          const word = wordsInParagraph[i];
          if (word.start > ner.end_time) break;
          if (word.start >= ner.start_time && word.end <= ner.end_time && !matches.has(i)) {
            matches.set(i, ner);
          }
        }
      }
      return matches;
    }, [mentionsForHighlights, wordsInParagraph]);

    const [activeEntity, setActiveEntity] = useState<{
      text: string;
      label: string;
      entity_uuid?: string;
    } | null>(null);
    const currentStoryUuid = (storyHubPage?.properties as { theirstory_id?: string } | undefined)?.theirstory_id;

    const traditionalMatchSet = useMemo(
      () => new Set(traditionalSearchMatches.map((match) => getWordKey(match))),
      [traditionalSearchMatches],
    );
    const currentTraditionalMatch = traditionalSearchMatches[traditionalCurrentMatchIndex];
    const currentTraditionalMatchKey = currentTraditionalMatch ? getWordKey(currentTraditionalMatch) : null;

    const currentSemanticMatch =
      currentSemanticMatchIndex >= 0 ? semanticSearchMatches[currentSemanticMatchIndex] : null;
    const currentSemanticStart = currentSemanticMatch?.properties?.start_time;
    const currentSemanticEnd = currentSemanticMatch?.properties?.end_time;

    /**
     * effects
     */
    useEffect(() => {
      if (targetScrollTime === null) return;

      const isTargetParagraph = targetScrollTime >= paragraph.start && targetScrollTime < paragraph.end;

      if (!isTargetParagraph) return;

      const scrollContainer = document.getElementById('transcript-panel-content');
      if (!scrollContainer) return;

      const doScroll = () => {
        const element = paragraphRef.current;
        if (!element) return;
        isProgrammaticScrollRef.current = true;
        scrollElementIntoContainer(element, scrollContainer, transcriptTopOffset);
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 120);
        setTargetScrollTime(null);
      };

      const t = setTimeout(doScroll, 100);
      return () => clearTimeout(t);
    }, [
      targetScrollTime,
      paragraph.start,
      paragraph.end,
      setTargetScrollTime,
      transcriptTopOffset,
      isProgrammaticScrollRef,
    ]);

    useEffect(() => {
      const scrollContainer = document.getElementById('transcript-panel-content');
      if (!scrollContainer) return;

      if (currentSemanticMatchIndex >= 0 && semanticSearchMatches[currentSemanticMatchIndex]) {
        const currentMatch = semanticSearchMatches[currentSemanticMatchIndex];
        const matchStartTime = currentMatch.properties?.start_time;
        const matchEndTime = currentMatch.properties?.end_time;
        const isMatchOverlappingParagraph =
          matchStartTime !== undefined &&
          matchEndTime !== undefined &&
          matchEndTime >= paragraph.start - MATCH_EPSILON &&
          matchStartTime < paragraph.end + MATCH_EPSILON;
        const isMatchStartInParagraph =
          matchStartTime !== undefined && matchStartTime >= paragraph.start && matchStartTime < paragraph.end;

        const targetWordInParagraph = wordsInParagraph.find(
          (word) =>
            matchStartTime !== undefined &&
            matchEndTime !== undefined &&
            word.end >= matchStartTime - MATCH_EPSILON &&
            word.start <= matchEndTime + MATCH_EPSILON,
        );

        if (isMatchOverlappingParagraph) {
          const element = paragraphRef.current;
          const targetWordIndex = targetWordInParagraph ? getWordKey(targetWordInParagraph) : null;
          const targetWordElement = targetWordIndex
            ? (document.querySelector(`[data-word-index="${targetWordIndex}"]`) as HTMLElement | null)
            : null;
          if (!targetWordElement && !isMatchStartInParagraph) {
            return;
          }
          const elementToScroll = targetWordElement ?? element;

          if (elementToScroll) {
            setTimeout(() => {
              isProgrammaticScrollRef.current = true;
              scrollElementIntoContainer(elementToScroll, scrollContainer, transcriptTopOffset);
              setTimeout(() => {
                isProgrammaticScrollRef.current = false;
              }, 120);
            }, 100);
          }
        }
      }

      // Handle traditional search matches
      if (traditionalCurrentMatchIndex >= 0 && traditionalSearchMatches[traditionalCurrentMatchIndex]) {
        const targetWord = traditionalSearchMatches[traditionalCurrentMatchIndex];
        const targetWordIndex = getWordKey(targetWord);
        const targetWordElement = document.querySelector(
          `[data-word-index="${targetWordIndex}"]`,
        ) as HTMLElement | null;
        if (targetWordElement) {
          setTimeout(() => {
            isProgrammaticScrollRef.current = true;
            scrollElementIntoContainer(targetWordElement, scrollContainer, transcriptTopOffset);
            setTimeout(() => {
              isProgrammaticScrollRef.current = false;
            }, 120);
          }, 100);
        }
      }
    }, [
      allWords,
      currentSemanticMatchIndex,
      transcriptTopOffset,
      paragraph.end,
      paragraph.start,
      semanticSearchMatches,
      traditionalCurrentMatchIndex,
      traditionalSearchMatches,
      isProgrammaticScrollRef,
      wordsInParagraph,
    ]);

    // Auto-scroll only for the active paragraph
    useEffect(() => {
      if (!isPlaying) return;
      if (isCurrentTimeOutOfView) return;
      if (playbackTimeInParagraph === null) return;

      const isElementInView = (el: HTMLElement, container: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        return rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
      };

      const element = paragraphRef.current;
      const scrollContainer = document.getElementById('transcript-panel-content');

      if (!element || !scrollContainer) return;

      const currentWord = wordsInParagraph.find((word, index) => {
        const nextWord = wordsInParagraph[index + 1];
        return (
          playbackTimeInParagraph >= word.start &&
          (nextWord ? playbackTimeInParagraph < nextWord.start : playbackTimeInParagraph <= word.end)
        );
      });
      const currentWordElement = currentWord
        ? (document.querySelector(`[data-word-index="${getWordKey(currentWord)}"]`) as HTMLElement | null)
        : null;
      const elementToTrack = currentWordElement ?? element;

      if (!isElementInView(elementToTrack, scrollContainer)) {
        isProgrammaticScrollRef.current = true;

        scrollElementIntoContainer(elementToTrack, scrollContainer, transcriptTopOffset);

        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 100);
      }
    }, [
      wordsInParagraph,
      playbackTimeInParagraph,
      isPlaying,
      isCurrentTimeOutOfView,
      isProgrammaticScrollRef,
      transcriptTopOffset,
    ]);

    /**
     * render
     */
    return (
      <Box
        ref={paragraphRef}
        data-paragraph-start={paragraph.start}
        data-paragraph-end={paragraph.end}
        sx={{
          mb: 2,
          wordBreak: 'break-word',
          transition: 'all 0.3s ease',
        }}>
        <Typography
          color="primary"
          fontSize="13px"
          fontWeight="bold"
          gutterBottom
          sx={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {formatTime(paragraph.start)} · {paragraph.speaker}
        </Typography>

        <Box>
          {wordsInParagraph.map((word, wordIndex) => {
            if (renderedWordIndexes.has(wordIndex)) return null;

            const nextWord = wordsInParagraph[wordIndex + 1];
            const wordKey = getWordKey(word);
            const isTraditionalMatch = traditionalMatchSet.has(wordKey);
            const isCurrentTraditionalMatch = isTraditionalMatch && currentTraditionalMatchKey === wordKey;
            const isInCurrentSemanticMatch =
              currentSemanticStart !== undefined &&
              currentSemanticEnd !== undefined &&
              currentSemanticEnd >= paragraph.start &&
              currentSemanticStart <= paragraph.end &&
              word.start >= currentSemanticStart - MATCH_EPSILON &&
              word.end <= currentSemanticEnd + MATCH_EPSILON;

            const nerMatch = nerMatchByWordIndex.get(wordIndex);
            const isNerSelected = Boolean(nerMatch);

            // FILTERED MODE: when the user has toggled label filters on, render
            // the selected entities as the existing beige pills.
            if (isNerSelected && nerMatch) {
              const nerWords: Word[] = [];
              const nerEnd = nerMatch.end_time;

              for (let i = wordIndex; i < wordsInParagraph.length; i++) {
                const w = wordsInParagraph[i];
                if (w.start >= nerMatch.start_time && w.end <= nerEnd) {
                  nerWords.push(w);
                  renderedWordIndexes.add(i);
                } else {
                  break;
                }
              }

              const isNerCurrentlyActive =
                playbackTimeInParagraph !== null &&
                nerWords.some((w, idx) => {
                  const nextWordInNer = nerWords[idx + 1];
                  return (
                    playbackTimeInParagraph >= w.start &&
                    (nextWordInNer ? playbackTimeInParagraph < nextWordInNer.start : playbackTimeInParagraph <= w.end)
                  );
                });

              return (
                <StoryTranscriptNERGroupWords
                  key={`ner-${wordIndex}`}
                  nerWords={nerWords}
                  label={nerMatch.label}
                  isActive={isNerCurrentlyActive}
                  onClick={() => seekOnly(nerMatch.start_time)}
                  paragraph={paragraph}
                />
              );
            }

            // SUBTLE MODE (default): when no label filter is on, render the
            // entity span as a clickable inline group with a thin colored
            // bottom-border. Reads like prose; the underline is a quiet
            // affordance rather than a chip.
            const subtleEntity = !hasSelectedNerLabels ? allEntityMatchByWordIndex.get(wordIndex) : undefined;
            if (subtleEntity) {
              const groupWords: Word[] = [];
              for (let i = wordIndex; i < wordsInParagraph.length; i++) {
                const w = wordsInParagraph[i];
                if (w.start >= subtleEntity.start_time && w.end <= subtleEntity.end_time) {
                  groupWords.push(w);
                  renderedWordIndexes.add(i);
                } else {
                  break;
                }
              }
              const underlineColor = getNerColor(subtleEntity.label);
              const onClick = () =>
                setActiveEntity({
                  text: subtleEntity.canonical_form || subtleEntity.text || groupWords.map((w) => w.text).join(' '),
                  label: subtleEntity.label,
                  entity_uuid: subtleEntity.entity_uuid,
                });
              return (
                <Box
                  key={`entity-${wordIndex}`}
                  component="span"
                  onClick={onClick}
                  title={subtleEntity.canonical_form || subtleEntity.text}
                  sx={{
                    display: 'inline',
                    cursor: 'pointer',
                    borderBottom: `2px solid ${underlineColor}`,
                    paddingBottom: '1px',
                    transition: 'background-color 0.15s ease',
                    '&:hover': { backgroundColor: `${underlineColor}1F` },
                  }}>
                  {groupWords.map((w, i) => {
                    const nw = wordsInParagraph[wordsInParagraph.indexOf(w) + 1];
                    return (
                      <StoryTranscriptWord
                        key={`entity-word-${w.word_idx}-${i}`}
                        word={w}
                        nextWordStart={nw?.start}
                        hasTraditionalHighlight={hasTraditionalHighlight}
                        isTraditionalMatch={traditionalMatchSet.has(getWordKey(w))}
                        isCurrentTraditionalMatch={
                          traditionalMatchSet.has(getWordKey(w)) && currentTraditionalMatchKey === getWordKey(w)
                        }
                        isInCurrentSemanticMatch={
                          currentSemanticStart !== undefined &&
                          currentSemanticEnd !== undefined &&
                          w.start >= currentSemanticStart - MATCH_EPSILON &&
                          w.end <= currentSemanticEnd + MATCH_EPSILON
                        }
                        urlHighlightRange={urlHighlightRange}
                      />
                    );
                  })}
                </Box>
              );
            }

            const isCurrentMatchInParagraph =
              currentSemanticMatch &&
              currentSemanticMatch.properties?.start_time >= paragraph.start &&
              currentSemanticMatch.properties?.start_time < paragraph.end;

            const isFirstWordOfCurrentMatch =
              isCurrentMatchInParagraph && word.start === currentSemanticMatch?.properties?.start_time;

            return (
              <React.Fragment key={`word-${word.word_idx}`}>
                {isFirstWordOfCurrentMatch && (
                  <span
                    style={{
                      marginRight: '6px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      backgroundColor: colors.info.main,
                      color: 'white',
                      padding: '2px 6px',
                      borderRadius: '12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      verticalAlign: 'middle',
                      lineHeight: '1',
                    }}>
                    Score: {((currentSemanticMatch?.metadata?.score ?? 0) * 100).toFixed(1)}%
                  </span>
                )}
                <StoryTranscriptWord
                  word={word}
                  nextWordStart={nextWord?.start}
                  hasTraditionalHighlight={hasTraditionalHighlight}
                  isTraditionalMatch={isTraditionalMatch}
                  isCurrentTraditionalMatch={isCurrentTraditionalMatch}
                  isInCurrentSemanticMatch={isInCurrentSemanticMatch}
                  urlHighlightRange={urlHighlightRange}
                />
              </React.Fragment>
            );
          })}
        </Box>
        {activeEntity && (
          <NerEntityModal
            open
            onClose={() => setActiveEntity(null)}
            entityText={activeEntity.text}
            entityLabel={activeEntity.label}
            entityUuid={activeEntity.entity_uuid}
            currentStoryUuid={currentStoryUuid}
          />
        )}
      </Box>
    );
  },
);

StoryTranscriptParagraph.displayName = 'StoryTranscriptParagraph';
