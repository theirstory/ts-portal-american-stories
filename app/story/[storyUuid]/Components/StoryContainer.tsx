'use client';

import { useSemanticSearchStore } from '@/app/stores/useSemanticSearchStore';
import { Box, CircularProgress, Typography, Tabs, Tab, useMediaQuery, useTheme } from '@mui/material';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { StoryVideo } from './StoryVideo';
import { StoryTranscriptPanel } from './StoryTranscriptPanel';
import { StoryMetadata } from './StoryMetadata';
import { StoryMetadataEntity } from './StoryMetadataEntity';
import { StoryProgressBar } from './StoryProgressBar';
import { StoryChapterList } from './StoryChapterList';
import { colors } from '@/lib/theme';
import { SearchType } from '@/types/searchType';
import { useTranscriptNavigation } from '@/app/hooks/useTranscriptNavigation';

export const StoryContainer = ({ storyUuid }: { storyUuid: string }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'));
  const [mobileTabValue, setMobileTabValue] = useState(0);
  const [hasCompletedInitialFetch, setHasCompletedInitialFetch] = useState(false);

  const {
    loading: loadingTranscript,
    getStoryTranscriptByUuid,
    transcript: transcriptData,
    setSearchType,
    setUpdateSelectedNerLabel,
    setSelectedNerLabels,
    clearStore,
  } = useSemanticSearchStore();
  const { seekAndScroll } = useTranscriptNavigation();
  const searchParams = useSearchParams();

  useEffect(() => {
    setSearchType(SearchType.traditional);

    let isMounted = true;
    setHasCompletedInitialFetch(false);

    const loadTranscript = async () => {
      try {
        await getStoryTranscriptByUuid(storyUuid);
      } catch (error) {
        console.error('Error fetching story transcript:', error);
      } finally {
        if (isMounted) {
          setHasCompletedInitialFetch(true);
        }
      }
    };

    loadTranscript();

    return () => {
      isMounted = false;
      clearStore();
    };
  }, [clearStore, getStoryTranscriptByUuid, setSearchType, storyUuid]);

  // Handle URL parameters for navigation and NER filter auto-toggle
  useEffect(() => {
    if (!transcriptData) return;

    const startTime = searchParams.get('start');
    const nerLabel = searchParams.get('nerLabel');
    const nerFilters = searchParams.get('nerFilters');

    if (startTime) {
      const time = parseFloat(startTime);
      if (!isNaN(time)) {
        seekAndScroll(time);
      }
    }

    // Handle single NER label (backward compatibility)
    if (nerLabel) {
      const { selected_ner_labels } = useSemanticSearchStore.getState();
      if (!selected_ner_labels.includes(nerLabel as any)) {
        setUpdateSelectedNerLabel(nerLabel as any);
      }
    }

    // Handle multiple NER filters from main page
    if (nerFilters) {
      const filterArray = nerFilters.split(',').map((filter) => filter.trim());
      const { selected_ner_labels } = useSemanticSearchStore.getState();

      // Merge existing labels with new filters, removing duplicates
      const mergedLabels = Array.from(new Set([...selected_ner_labels, ...filterArray]));
      setSelectedNerLabels(mergedLabels as any);
    }
  }, [transcriptData, searchParams, seekAndScroll, setUpdateSelectedNerLabel, setSelectedNerLabels]);

  const handleMobileTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setMobileTabValue(newValue);
  };

  if (loadingTranscript || !hasCompletedInitialFetch) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          flexDirection: 'column',
          gap: '16px',
        }}>
        <CircularProgress size={40} sx={{ color: colors.primary.main }} />
      </Box>
    );
  }

  if (!transcriptData && hasCompletedInitialFetch && !loadingTranscript) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        height="100%"
        sx={{ padding: 2, backgroundColor: colors.grey[100], borderRadius: 1 }}>
        <Typography color="primary">No transcript available for this story.</Typography>
      </Box>
    );
  }

  return (
    <>
      {/* Mobile Layout */}
      {isMobile ? (
        <Box
          id="mobile-container"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100dvh - 56px)',
            overflow: 'hidden',
          }}>
          {/* Video - Fixed at top */}
          <Box
            id="mobile-video-container"
            sx={{
              flexShrink: 0,
              height: '180px',
              width: '100%',
              px: 1,
              pt: 1,
            }}>
            <StoryVideo />
          </Box>

          {/* Tabs Navigation */}
          <Box sx={{ flexShrink: 0, borderBottom: 1, borderColor: 'divider', bgcolor: colors.background.default }}>
            <Tabs
              value={mobileTabValue}
              onChange={handleMobileTabChange}
              variant="fullWidth"
              aria-label="mobile story tabs"
              sx={{
                minHeight: 40,
                '& .MuiTab-root': {
                  minHeight: 40,
                  py: 1,
                  fontSize: '0.8rem',
                  textTransform: 'none',
                },
                '& .MuiTabs-indicator': {
                  backgroundColor: 'primary.main',
                },
              }}>
              <Tab label="Transcript" />
              <Tab label="Chapters" />
              <Tab label="Metadata" />
              <Tab label="Entities" />
            </Tabs>
          </Box>

          {/* Scrollable Content Area */}
          <Box
            id="mobile-content-area"
            sx={{
              flex: 1,
              overflow: 'auto',
              pb: '68px', // Space for progress bar
            }}>
            {/* Transcription Tab */}
            {mobileTabValue === 0 && (
              <Box sx={{ height: '100%' }}>
                <StoryTranscriptPanel isMobile />
              </Box>
            )}

            {/* Chapters Tab */}
            {mobileTabValue === 1 && (
              <Box sx={{ p: 1.5, height: '100%' }}>
                <StoryChapterList />
              </Box>
            )}

            {/* Metadata Tab */}
            {mobileTabValue === 2 && (
              <Box sx={{ p: 2 }}>
                <StoryMetadata isMobile />
              </Box>
            )}

            {/* Entities Tab */}
            {mobileTabValue === 3 && (
              <Box sx={{ p: 2 }}>
                <StoryMetadataEntity />
              </Box>
            )}
          </Box>
        </Box>
      ) : (
        /* Desktop Layout — two visual columns. The chapter rail + transcript
            sit inside a single shared container so they read as one component
            divided by a hairline, not two floating cards. */
        <Box
          id="container"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(360px, 480px) minmax(0, 1fr)',
            gap: 2,
            height: `calc(100dvh - 100px - 54px)`,
            paddingTop: '6px',
            paddingBottom: '12px',
            paddingX: 2,
            position: 'relative',
            overflow: 'hidden',
            maxWidth: 1600,
            mx: 'auto',
            width: '100%',
          }}>
          <Box
            id="left-side-container"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              height: '100%',
              minHeight: 0,
              minWidth: 0,
            }}>
            <Box
              id="video-container"
              sx={{
                height: '242px',
                width: '100%',
              }}>
              <StoryVideo />
            </Box>
            <Box
              id="video-metadata"
              sx={{
                flex: '1',
                overflow: 'auto',
                minHeight: 0,
              }}>
              <StoryMetadata />
            </Box>
          </Box>

          {/* Chapters + transcript share a single bordered container so the
              two surfaces read as one, separated only by an internal rule. */}
          <Box
            id="reading-pane"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)',
              height: '100%',
              minHeight: 0,
              minWidth: 0,
              bgcolor: 'background.default',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
            }}>
            <Box
              id="chapters-rail"
              sx={{
                height: '100%',
                minHeight: 0,
                minWidth: 0,
                display: 'flex',
                borderRight: '1px solid',
                borderColor: 'divider',
              }}>
              <StoryChapterList />
            </Box>

            <Box
              id="right-side-container"
              sx={{
                height: '100%',
                minHeight: 0,
                minWidth: 0,
                display: 'flex',
              }}>
              <StoryTranscriptPanel />
            </Box>
          </Box>
        </Box>
      )}
      <StoryProgressBar />
    </>
  );
};
