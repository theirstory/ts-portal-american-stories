'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Box, InputBase, IconButton, Typography, CircularProgress } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import Link from 'next/link';
import MapIcon from '@mui/icons-material/Map';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import {
  getNerColor,
  getNerDisplayName,
  getQuestionLevelColor,
  getQuestionLevelDisplayName,
} from '@/config/organizationConfig';
import { getTopThreads, type ThreadRecord } from '@/lib/weaviate/threads';
import { getTopCrossSourceEntities, type TopEntity } from '@/lib/weaviate/entities';
import { ThreadModal } from '@/components/ThreadModal';
import { NerEntityModal } from '@/app/story/[storyUuid]/Components/NerEntityModal';

const TOP_THREAD_LIMIT = 30;
const TOP_ENTITY_LIMIT = 14;

type ThreadCloudItem = {
  kind: 'thread';
  id: string;
  label: string;
  question: string;
  level: string;
  weight: number;
};

type EntityCloudItem = {
  kind: 'entity';
  id: string;
  label: string;
  entity_text: string;
  entity_label: string;
  weight: number;
};

type CloudItem = ThreadCloudItem | EntityCloudItem;

// Pseudo-random but deterministic per item — keeps the cloud stable between
// renders while breaking the strict baseline alignment that makes a tag list
// look like a tag list.
const hashString = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
};

const computeFontRem = (weight: number, minW: number, maxW: number, kind: 'thread' | 'entity') => {
  // Threads scale 1.05rem → 2.4rem; entities sit subtler 0.85rem → 1.5rem.
  const tMin = kind === 'thread' ? 1.05 : 0.85;
  const tMax = kind === 'thread' ? 2.4 : 1.5;
  if (maxW === minW) return (tMin + tMax) / 2;
  const t = (weight - minW) / (maxW - minW);
  return tMin + t * (tMax - tMin);
};

const verticalNudgeFor = (id: string) => {
  // ±3px wobble around the baseline.
  const h = hashString(id);
  return (h % 7) - 3 + 'px';
};

// Convert a #rrggbb (or shorthand) into rgba(...) with the given alpha.
// Falls back to the input string if it's not parseable as hex.
const tintColor = (hex: string, alpha: number): string => {
  const m = hex.replace('#', '').match(/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const WordCloudAndSearch = () => {
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadRecord[] | null>(null);
  const [entities, setEntities] = useState<TopEntity[] | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeThreadUuid, setActiveThreadUuid] = useState<string | null>(null);
  const [activeEntity, setActiveEntity] = useState<{
    text: string;
    label: string;
    entity_uuid: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getTopThreads(TOP_THREAD_LIMIT).catch((err) => {
        console.error('Failed to load threads:', err);
        return [] as ThreadRecord[];
      }),
      getTopCrossSourceEntities(TOP_ENTITY_LIMIT, 2).catch((err) => {
        console.error('Failed to load cross-source entities:', err);
        return [] as TopEntity[];
      }),
    ]).then(([t, e]) => {
      if (cancelled) return;
      setThreads(t);
      setEntities(e);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo<CloudItem[]>(() => {
    const rawThreads = (threads ?? []).filter((t) => ((t.properties.source_count as number) ?? 0) >= 3);

    // Disambiguate same theme_label across levels — the loudest source wins
    // the bare label; smaller siblings get a level qualifier appended.
    const labelCounts = new Map<string, number>();
    for (const t of rawThreads) {
      const label = ((t.properties.theme_label as string) || '').trim().toLowerCase();
      if (!label) continue;
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
    const sortedThreads = [...rawThreads].sort(
      (a, b) => ((b.properties.source_count as number) ?? 0) - ((a.properties.source_count as number) ?? 0),
    );
    const labelClaimed = new Set<string>();
    const labelByUuid = new Map<string, string>();
    for (const t of sortedThreads) {
      const baseLabel = (t.properties.theme_label as string) || (t.properties.thread_question as string) || 'Thread';
      const lc = baseLabel.trim().toLowerCase();
      const collides = (labelCounts.get(lc) ?? 0) > 1;
      if (!collides || !labelClaimed.has(lc)) {
        labelByUuid.set(t.uuid, baseLabel);
        labelClaimed.add(lc);
      } else {
        const levelName = getQuestionLevelDisplayName((t.properties.question_level as string) ?? '');
        labelByUuid.set(t.uuid, `${baseLabel} · ${levelName}`);
      }
    }

    const out: CloudItem[] = [];
    for (const t of rawThreads) {
      const props = t.properties;
      const sourceCount = (props.source_count as number) ?? 0;
      out.push({
        kind: 'thread',
        id: `t:${t.uuid}`,
        label: labelByUuid.get(t.uuid) ?? (props.theme_label as string) ?? 'Thread',
        question: (props.thread_question as string) ?? '',
        level: (props.question_level as string) ?? '',
        weight: sourceCount,
      });
    }
    for (const e of entities ?? []) {
      out.push({
        kind: 'entity',
        id: `e:${e.entity_uuid}`,
        label: e.canonical_form,
        entity_text: e.canonical_form,
        entity_label: e.label,
        weight: e.recording_count, // size by cross-source spread, not raw mentions
      });
    }
    // Shuffle deterministically so threads/entities interleave visually.
    out.sort((a, b) => hashString(a.id) - hashString(b.id));
    return out;
  }, [threads, entities]);

  const { minWeight, maxWeight } = useMemo(() => {
    if (items.length === 0) return { minWeight: 0, maxWeight: 0 };
    const weights = items.map((i) => i.weight);
    return { minWeight: Math.min(...weights), maxWeight: Math.max(...weights) };
  }, [items]);

  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = searchTerm.trim();
    if (!trimmed) return;
    router.push(`/stories?q=${encodeURIComponent(trimmed)}&searchType=hybrid`);
  };

  const isLoading = threads === null || entities === null;
  const isEmpty = !isLoading && items.length === 0;

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
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
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
        <Box
          component={Link}
          href="/map"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            color: 'common.black',
            textDecoration: 'none',
            fontSize: { xs: '0.72rem', md: '0.75rem' },
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            opacity: 0.8,
            transition: 'opacity 0.15s, color 0.15s',
            '&:hover': {
              opacity: 1,
              color: 'secondary.main',
              '& .arrow': { transform: 'translateX(3px)' },
            },
          }}>
          <MapIcon sx={{ fontSize: 16 }} />
          View in Map
          <ArrowForwardIcon className="arrow" sx={{ fontSize: 14, transition: 'transform 0.15s ease' }} />
        </Box>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          pr: 1,
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 4 },
        }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={22} sx={{ color: 'secondary.main' }} />
          </Box>
        ) : isEmpty ? (
          <Typography sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
            Throughlines appear once at least three recordings answer the same question.
          </Typography>
        ) : (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: { xs: '6px 14px', md: '10px 18px' },
              alignItems: 'center',
              lineHeight: 1.05,
              py: 1,
            }}>
            {items.map((item) => {
              const fontRem = computeFontRem(item.weight, minWeight, maxWeight, item.kind);
              const nudge = verticalNudgeFor(item.id);
              if (item.kind === 'thread') {
                const color = getQuestionLevelColor(item.level);
                const bg = tintColor(color, 0.1);
                const bgHover = tintColor(color, 0.18);
                const borderColor = tintColor(color, 0.22);
                return (
                  <Box
                    key={item.id}
                    component="button"
                    onClick={() => setActiveThreadUuid(item.id.slice(2))}
                    title={`${getQuestionLevelDisplayName(item.level)} throughline · answered in ${item.weight} recordings — ${item.question}`}
                    sx={{
                      cursor: 'pointer',
                      padding: '4px 12px',
                      borderRadius: '999px',
                      backgroundColor: bg,
                      border: '1px solid',
                      borderColor,
                      fontFamily: 'var(--font-serif), Georgia, serif',
                      fontSize: `${fontRem}rem`,
                      fontWeight: 600,
                      lineHeight: 1.15,
                      color: 'common.black',
                      transform: `translateY(${nudge})`,
                      transition:
                        'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        color,
                        backgroundColor: bgHover,
                        borderColor: color,
                        transform: `translateY(${nudge}) scale(1.04)`,
                        boxShadow: `0 6px 18px ${tintColor(color, 0.22)}`,
                      },
                    }}>
                    {item.label}
                  </Box>
                );
              }

              const color = getNerColor(item.entity_label);
              const bg = tintColor(color, 0.12);
              const bgHover = tintColor(color, 0.22);
              const borderColor = tintColor(color, 0.28);
              return (
                <Box
                  key={item.id}
                  component="button"
                  onClick={() =>
                    setActiveEntity({
                      text: item.entity_text,
                      label: item.entity_label,
                      entity_uuid: item.id.slice(2),
                    })
                  }
                  title={`${getNerDisplayName(item.entity_label)} · in ${item.weight} recordings`}
                  sx={{
                    cursor: 'pointer',
                    padding: '3px 10px',
                    borderRadius: '999px',
                    backgroundColor: bg,
                    border: '1px solid',
                    borderColor,
                    fontFamily: 'var(--font-sans), system-ui, sans-serif',
                    fontSize: `${fontRem}rem`,
                    fontWeight: 500,
                    lineHeight: 1.15,
                    color: 'rgba(0,0,0,0.78)',
                    transform: `translateY(${nudge})`,
                    transition:
                      'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease',
                    whiteSpace: 'nowrap',
                    '&:hover': {
                      color,
                      backgroundColor: bgHover,
                      borderColor: color,
                      transform: `translateY(${nudge}) scale(1.04)`,
                      boxShadow: `0 6px 18px ${tintColor(color, 0.22)}`,
                    },
                  }}>
                  {item.label}
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
            boxShadow: '0 0 0 3px rgba(249,96,68,0.18)',
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

      {activeThreadUuid && <ThreadModal open onClose={() => setActiveThreadUuid(null)} threadUuid={activeThreadUuid} />}
      {activeEntity && (
        <NerEntityModal
          open
          onClose={() => setActiveEntity(null)}
          entityText={activeEntity.text}
          entityLabel={activeEntity.label}
          entityUuid={activeEntity.entity_uuid}
        />
      )}
    </Box>
  );
};
