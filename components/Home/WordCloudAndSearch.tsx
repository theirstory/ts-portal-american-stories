'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Box, InputBase, IconButton, Typography, CircularProgress } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { getNerColor, getNerDisplayName } from '@/config/organizationConfig';
import { getTopNerEntities, type TopNerEntity } from '@/lib/weaviate/search';
import { NerEntityModal } from '@/app/story/[storyUuid]/Components/NerEntityModal';

const TOP_ENTITY_LIMIT = 15;

const computeFontSize = (count: number, min: number, max: number) => {
  if (max === min) return 1.2;
  const t = (count - min) / (max - min);
  return 0.9 + t * 1.1;
};

export const WordCloudAndSearch = () => {
  const router = useRouter();
  const [entities, setEntities] = useState<TopNerEntity[] | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeEntity, setActiveEntity] = useState<{ text: string; label: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTopNerEntities(TOP_ENTITY_LIMIT)
      .then((result) => {
        if (!cancelled) setEntities(result);
      })
      .catch((err) => {
        console.error('Failed to load top NER entities:', err);
        if (!cancelled) setEntities([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { minCount, maxCount } = useMemo(() => {
    if (!entities || entities.length === 0) return { minCount: 0, maxCount: 0 };
    const counts = entities.map((e) => e.count);
    return { minCount: Math.min(...counts), maxCount: Math.max(...counts) };
  }, [entities]);

  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = searchTerm.trim();
    if (!trimmed) return;
    router.push(`/stories?q=${encodeURIComponent(trimmed)}&searchType=hybrid`);
  };

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        px: { xs: 2, md: 4 },
        py: { xs: 2, md: 0 },
        minHeight: 0,
        gap: 1.5,
      }}>
      <Typography
        variant="overline"
        sx={{
          letterSpacing: '0.2em',
          color: 'secondary.main',
          fontWeight: 700,
          fontSize: { xs: '0.7rem', md: '0.75rem' },
        }}>
        Threads
      </Typography>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          pr: 1,
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 4 },
        }}>
        {entities === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={22} sx={{ color: 'secondary.main' }} />
          </Box>
        ) : entities.length === 0 ? (
          <Typography sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>No entities found yet.</Typography>
        ) : (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: { xs: 0.75, md: 1 },
              alignItems: 'baseline',
              lineHeight: 1.4,
            }}>
            {entities.map((entity) => {
              const fontSize = computeFontSize(entity.count, minCount, maxCount);
              const labelColor = getNerColor(entity.label);
              return (
                <Box
                  key={`${entity.text}|${entity.label}`}
                  component="button"
                  onClick={() => setActiveEntity({ text: entity.text, label: entity.label })}
                  title={`${getNerDisplayName(entity.label)} — ${entity.count} mention${entity.count !== 1 ? 's' : ''}`}
                  sx={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    fontFamily: 'var(--font-serif), Georgia, serif',
                    fontSize: `${fontSize}rem`,
                    fontWeight: 600,
                    lineHeight: 1.1,
                    color: 'common.black',
                    transition: 'color 0.15s ease, transform 0.15s ease',
                    '&::after': {
                      content: '""',
                      display: 'block',
                      height: '2px',
                      backgroundColor: labelColor,
                      opacity: 0.55,
                      marginTop: '1px',
                      borderRadius: '2px',
                      transition: 'opacity 0.15s ease',
                    },
                    '&:hover': { color: 'secondary.main', transform: 'translateY(-1px)' },
                    '&:hover::after': { opacity: 1 },
                  }}>
                  {entity.text}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      <Box
        component="form"
        onSubmit={handleSearchSubmit}
        sx={{
          display: 'flex',
          alignItems: 'center',
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 999,
          px: 2,
          py: 0.5,
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
          '&:focus-within': {
            borderColor: 'secondary.main',
            boxShadow: '0 0 0 3px rgba(35,155,139,0.15)',
          },
        }}>
        <SearchIcon sx={{ color: 'text.secondary', mr: 1, fontSize: 20 }} />
        <InputBase
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search all stories…"
          sx={{ flex: 1, fontSize: '0.9375rem' }}
          inputProps={{ 'aria-label': 'Search stories' }}
        />
        <IconButton type="submit" aria-label="Search" size="small" sx={{ color: 'secondary.main' }}>
          <SearchIcon fontSize="small" />
        </IconButton>
      </Box>

      {activeEntity && (
        <NerEntityModal
          open
          onClose={() => setActiveEntity(null)}
          entityText={activeEntity.text}
          entityLabel={activeEntity.label}
          hideInterviewTab
        />
      )}
    </Box>
  );
};
