'use client';

import { Box, Collapse, IconButton, List, ListItem, Typography } from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import { getMuxPlaybackId, getThumbnailTimeForTitle } from '@/app/utils/converters';
import { ExpandableExcerpt } from '@/components/ExpandableExcerpt';
import { colors } from '@/lib/theme';
import { formatTime } from '@/app/utils/util';
import type { ThreadModalRecording } from '@/lib/weaviate/threads';

type Props = {
  recordings: ThreadModalRecording[];
  viewMode: 'stack' | 'compare';
  expandedRecordings: Set<string>;
  onToggleRecording: (theirstoryId: string) => void;
  onExcerptClick: (theirstoryId: string, startTime: number) => void;
};

/** Shared Stack/Compare renderer for recording groups. Used by both the
 * Themes and Entities branches of /throughlines so the visual treatment of
 * "narrators answering this thing" stays identical regardless of source. */
export const RecordingsRenderer = ({
  recordings,
  viewMode,
  expandedRecordings,
  onToggleRecording,
  onExcerptClick,
}: Props) => {
  if (recordings.length === 0) {
    return (
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
        No recordings linked yet.
      </Typography>
    );
  }

  if (viewMode === 'compare') {
    return (
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          overflowX: 'auto',
          pb: 2,
          WebkitOverflowScrolling: 'touch',
          '&::-webkit-scrollbar': { height: 8 },
          '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 4 },
        }}>
        {recordings.map((rec) => {
          const playbackId = rec.video_url ? getMuxPlaybackId(rec.video_url) : null;
          const thumbTime = getThumbnailTimeForTitle(rec.interview_title);
          return (
            <Box
              key={rec.theirstory_id}
              sx={{
                flex: '0 0 auto',
                width: { xs: 280, md: 320 },
                bgcolor: colors.common.white,
                border: '1px solid',
                borderColor: colors.grey[200],
                borderRadius: 2,
                boxShadow: '0 4px 14px rgba(15, 23, 42, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}>
              <Box
                sx={{
                  p: 1.5,
                  display: 'flex',
                  gap: 1.25,
                  alignItems: 'center',
                  borderBottom: '1px solid',
                  borderColor: colors.grey[200],
                }}>
                {rec.isAudioFile || !playbackId ? (
                  <Box
                    sx={{
                      width: 64,
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
                      width: 64,
                      aspectRatio: '16 / 9',
                      objectFit: 'cover',
                      borderRadius: 4,
                      flexShrink: 0,
                      display: 'block',
                      background: colors.grey[200],
                    }}
                  />
                )}
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    sx={{
                      fontSize: '0.92rem',
                      fontWeight: 700,
                      color: colors.primary.main,
                      lineHeight: 1.25,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                    {rec.interview_title}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: '0.7rem',
                      color: colors.text.secondary,
                      fontWeight: 500,
                      mt: 0.25,
                    }}>
                    {rec.excerpts.length} {rec.excerpts.length === 1 ? 'excerpt' : 'excerpts'}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ p: 1.25, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                {rec.excerpts.map((excerpt) => (
                  <Box
                    key={excerpt.chunk_uuid}
                    onClick={() => onExcerptClick(excerpt.theirstory_id, excerpt.start_time)}
                    sx={{
                      cursor: 'pointer',
                      p: 1.25,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: colors.grey[200],
                      bgcolor: '#F8FAFC',
                      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                      '&:hover': {
                        borderColor: colors.primary.main,
                        boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)',
                      },
                    }}>
                    <Typography
                      sx={{
                        fontSize: '0.7rem',
                        color: colors.text.secondary,
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                        mb: 0.5,
                      }}>
                      {formatTime(excerpt.start_time)}
                    </Typography>
                    <ExpandableExcerpt text={excerpt.transcription} collapsedLines={6} />
                  </Box>
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  }

  // Stack view (default)
  return (
    <List sx={{ p: 0 }}>
      {recordings.map((rec) => {
        const isOpen = expandedRecordings.has(rec.theirstory_id);
        const playbackId = rec.video_url ? getMuxPlaybackId(rec.video_url) : null;
        const thumbTime = getThumbnailTimeForTitle(rec.interview_title);
        return (
          <Box key={rec.theirstory_id} sx={{ mb: 2 }}>
            <Box
              component="button"
              onClick={() => onToggleRecording(rec.theirstory_id)}
              sx={{
                width: '100%',
                py: 1.25,
                px: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                bgcolor: colors.common.white,
                border: '1px solid',
                borderColor: colors.grey[200],
                borderRadius: isOpen ? '14px 14px 0 0' : '14px',
                cursor: 'pointer',
                textAlign: 'left',
                boxShadow: '0 4px 14px rgba(15, 23, 42, 0.05)',
                '&:hover': { borderColor: colors.grey[300] },
              }}>
              <IconButton
                component="span"
                aria-label={isOpen ? 'collapse' : 'expand'}
                size="small"
                sx={{ color: colors.text.primary, flexShrink: 0, p: 0 }}>
                {isOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
              {rec.isAudioFile || !playbackId ? (
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
              <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <Typography
                  variant="subtitle1"
                  fontWeight={700}
                  color="primary"
                  noWrap
                  sx={{ fontSize: { xs: '1rem', md: '0.95rem' } }}>
                  {rec.interview_title}
                </Typography>
                <Typography sx={{ fontSize: '0.78rem', color: colors.text.secondary, fontWeight: 500 }}>
                  {rec.excerpts.length} {rec.excerpts.length === 1 ? 'excerpt' : 'excerpts'}
                </Typography>
              </Box>
            </Box>
            <Collapse in={isOpen} timeout="auto">
              <Box
                sx={{
                  mt: 0.25,
                  p: 1,
                  border: '1px solid',
                  borderTop: 'none',
                  borderColor: colors.grey[200],
                  borderRadius: '0 0 14px 14px',
                  bgcolor: '#F8FAFC',
                }}>
                {rec.excerpts.map((excerpt) => (
                  <ListItem
                    key={excerpt.chunk_uuid}
                    onClick={() => onExcerptClick(excerpt.theirstory_id, excerpt.start_time)}
                    sx={{
                      cursor: 'pointer',
                      alignItems: 'stretch',
                      borderRadius: 3,
                      mb: 1,
                      px: 1.25,
                      py: 1.1,
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
                            sx={{
                              fontWeight: 600,
                              fontSize: '0.85rem',
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
                          sx={{
                            color: colors.text.secondary,
                            fontSize: '0.78rem',
                            fontWeight: 500,
                            flexShrink: 0,
                          }}>
                          {formatTime(excerpt.start_time)}
                        </Typography>
                      </Box>
                      <ExpandableExcerpt text={excerpt.transcription} />
                    </Box>
                  </ListItem>
                ))}
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </List>
  );
};
