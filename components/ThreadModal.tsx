'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  CircularProgress,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  getQuestionLevelColor,
  getQuestionLevelDescription,
  getQuestionLevelDisplayName,
} from '@/config/organizationConfig';
import { getThreadModalData, type ThreadModalData } from '@/lib/weaviate/threads';
import { colors } from '@/lib/theme';
import { formatTime } from '@/app/utils/util';
import { getMuxPlaybackId, getThumbnailTimeForTitle } from '@/app/utils/converters';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import { useTranscriptNavigation } from '@/app/hooks/useTranscriptNavigation';

type Props = {
  open: boolean;
  onClose: () => void;
  threadUuid: string;
  /** Optional — the recording the user is currently inside. When set, that
   * recording is pinned to the top of the list and clicking an excerpt seeks
   * the local player instead of opening a new tab. */
  currentStoryUuid?: string;
};

const buildExcerptSnippet = (text: string, maxChars = 320): string => {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}…`;
};

export const ThreadModal = ({ open, onClose, threadUuid, currentStoryUuid }: Props) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ThreadModalData | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !threadUuid) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    getThreadModalData(threadUuid, currentStoryUuid)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setExpanded(new Set(result?.recordings.map((r) => r.theirstory_id) ?? []));
      })
      .catch((err) => {
        console.error('Failed to load thread modal data:', err);
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, threadUuid, currentStoryUuid]);

  const props = data?.thread.properties;
  const themeLabel = (props?.theme_label as string) || '';
  const threadQuestion = (props?.thread_question as string) || '';
  const level = (props?.question_level as string) || '';
  const sourceCount = (props?.source_count as number) ?? data?.recordings.length ?? 0;

  const levelColor = useMemo(() => getQuestionLevelColor(level), [level]);
  const levelName = useMemo(() => getQuestionLevelDisplayName(level), [level]);
  const levelDescription = useMemo(() => getQuestionLevelDescription(level), [level]);

  const toggleRecording = (theirstoryId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(theirstoryId)) next.delete(theirstoryId);
      else next.add(theirstoryId);
      return next;
    });
  };

  const { seekAndScroll } = useTranscriptNavigation();

  const handleExcerptClick = (theirstoryId: string, startTime: number) => {
    if (currentStoryUuid && theirstoryId === currentStoryUuid) {
      // Same recording — seek the local player and close the modal instead
      // of opening a new tab (the testimony page is already mounted).
      seekAndScroll(startTime);
      onClose();
      return;
    }
    const url = `/story/${theirstoryId}?start=${startTime}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

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
        }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, pr: 1 }}>
          <Box
            component="span"
            sx={{
              backgroundColor: levelColor,
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: { xs: '0.78rem', md: '0.72rem' },
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              lineHeight: 1,
              px: 1,
              py: 0.65,
              borderRadius: '6px',
              flexShrink: 0,
            }}>
            {levelName}
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
              fontSize: { xs: '1.05rem', md: '1rem' },
            }}>
            {themeLabel}
          </Typography>
        </Box>

        <IconButton aria-label="close" onClick={onClose} sx={{ color: colors.grey[500], ml: 1, flexShrink: 0 }}>
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
        {/* Canonical thread question + meta */}
        <Box
          sx={{
            px: { xs: 2, md: 3 },
            py: { xs: 2, md: 2.5 },
            bgcolor: colors.common.white,
            borderBottom: '1px solid',
            borderColor: colors.grey[200],
          }}>
          <Typography
            sx={{
              fontFamily: 'var(--font-serif), Georgia, serif',
              fontSize: { xs: '1.15rem', md: '1.35rem' },
              fontWeight: 600,
              lineHeight: 1.35,
              color: colors.text.primary,
              mb: 1,
            }}>
            “{threadQuestion}”
          </Typography>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.85rem', mb: 1.25 }}>
            {levelDescription}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            <Box
              component="span"
              sx={{
                fontSize: '0.78rem',
                fontWeight: 700,
                color: levelColor,
                border: '1px solid',
                borderColor: levelColor,
                borderRadius: 999,
                px: 1.25,
                py: 0.35,
              }}>
              {sourceCount} {sourceCount === 1 ? 'recording' : 'recordings'}
            </Box>
          </Box>
        </Box>

        {/* Recordings list */}
        <Box sx={{ p: { xs: 1.25, md: 1.5 }, overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : !data || data.recordings.length === 0 ? (
            <Typography
              sx={{
                textAlign: 'center',
                py: 6,
                px: 2,
                border: '1px dashed',
                borderColor: colors.grey[300],
                borderRadius: 3,
                bgcolor: colors.common.white,
                color: colors.text.secondary,
              }}>
              No recordings linked to this throughline yet.
            </Typography>
          ) : (
            <List sx={{ p: 0 }}>
              {data.recordings.map((rec) => {
                const isOpen = expanded.has(rec.theirstory_id);
                const isCurrent = currentStoryUuid && rec.theirstory_id === currentStoryUuid;
                return (
                  <Box key={rec.theirstory_id} sx={{ mb: 2 }}>
                    <Box
                      component="button"
                      onClick={() => toggleRecording(rec.theirstory_id)}
                      sx={{
                        width: '100%',
                        py: { xs: 1.25, md: 1 },
                        px: { xs: 1.25, md: 1.25 },
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1,
                        backgroundColor: colors.common.white,
                        border: '1px solid',
                        borderColor: isCurrent ? colors.primary.main : colors.grey[200],
                        borderRadius: isOpen ? '14px 14px 0 0' : '14px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        boxShadow: '0 4px 14px rgba(15, 23, 42, 0.05)',
                        '&:hover': { borderColor: isCurrent ? colors.primary.main : colors.grey[300] },
                      }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
                        <Box
                          component="span"
                          sx={{ display: 'inline-flex', color: colors.text.primary, flexShrink: 0 }}
                          aria-hidden="true">
                          {isOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </Box>
                        {(() => {
                          const playbackId = rec.video_url ? getMuxPlaybackId(rec.video_url) : null;
                          if (rec.isAudioFile || !playbackId) {
                            return (
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
                            );
                          }
                          const t = getThumbnailTimeForTitle(rec.interview_title);
                          return (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`https://image.mux.com/${playbackId}/thumbnail.jpg?time=${t}&width=180&height=101&fit_mode=crop`}
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
                          );
                        })()}
                        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <Typography
                            variant="subtitle1"
                            fontWeight={700}
                            color="primary"
                            noWrap
                            sx={{ fontSize: { xs: '1rem', md: '0.92rem' } }}>
                            {rec.interview_title}
                          </Typography>
                          {isCurrent && (
                            <Typography
                              sx={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                letterSpacing: '0.06em',
                                color: 'primary.main',
                                textTransform: 'uppercase',
                              }}>
                              You are here
                            </Typography>
                          )}
                        </Box>
                      </Box>
                      <Typography
                        variant="body2"
                        sx={{ color: colors.text.secondary, fontSize: { xs: '0.85rem', md: '0.78rem' } }}>
                        {rec.excerpts.length} {rec.excerpts.length === 1 ? 'excerpt' : 'excerpts'}
                      </Typography>
                    </Box>
                    <Collapse in={isOpen} timeout="auto">
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
                        {rec.excerpts.map((excerpt) => (
                          <ListItem
                            key={excerpt.chunk_uuid}
                            onClick={() => handleExcerptClick(excerpt.theirstory_id, excerpt.start_time)}
                            sx={{
                              cursor: 'pointer',
                              alignItems: 'stretch',
                              borderRadius: 3,
                              mb: 1,
                              px: { xs: 1.25, md: 1.25 },
                              py: { xs: 1.25, md: 1.1 },
                              bgcolor: colors.common.white,
                              border: '1px solid',
                              borderColor: colors.grey[200],
                              boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
                              '&:hover': {
                                borderColor: colors.primary.main,
                                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
                              },
                              '&:last-of-type': { mb: 0 },
                            }}>
                            <Box sx={{ width: '100%' }}>
                              <Box
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  mb: 0.75,
                                  gap: 1,
                                }}>
                                {excerpt.segment_summary ? (
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      fontWeight: 600,
                                      fontSize: { xs: '0.9rem', md: '0.84rem' },
                                      color: colors.text.primary,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      display: '-webkit-box',
                                      WebkitLineClamp: 1,
                                      WebkitBoxOrient: 'vertical',
                                    }}>
                                    {excerpt.segment_summary}
                                  </Typography>
                                ) : (
                                  <Box />
                                )}
                                <Typography
                                  variant="body2"
                                  sx={{
                                    color: colors.text.secondary,
                                    fontSize: { xs: '0.85rem', md: '0.78rem' },
                                    fontWeight: 500,
                                    flexShrink: 0,
                                  }}>
                                  {formatTime(excerpt.start_time)}
                                </Typography>
                              </Box>
                              <Typography
                                variant="body2"
                                sx={{
                                  color: colors.text.primary,
                                  fontSize: { xs: '0.95rem', md: '0.86rem' },
                                  lineHeight: 1.55,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 4,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}>
                                {buildExcerptSnippet(excerpt.transcription)}
                              </Typography>
                            </Box>
                          </ListItem>
                        ))}
                      </Box>
                    </Collapse>
                  </Box>
                );
              })}
            </List>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
};
