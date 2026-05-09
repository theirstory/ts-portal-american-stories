'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip as LTooltip } from 'react-leaflet';
import { Box, Typography } from '@mui/material';
import { NerEntityModal } from '@/app/story/[storyUuid]/Components/NerEntityModal';
import { getNerColor } from '@/config/organizationConfig';
import { colors } from '@/lib/theme';
import type { PlaceMarker } from '@/lib/weaviate/places';

type Props = {
  markers: PlaceMarker[];
};

const computeRadius = (recordingCount: number, min: number, max: number): number => {
  // 6px (1 recording) → 22px (most-cited place). Subtle but legible.
  if (max === min) return 12;
  const t = (recordingCount - min) / (max - min);
  return 6 + t * 16;
};

export const MapView = ({ markers }: Props) => {
  const [active, setActive] = useState<PlaceMarker | null>(null);
  // Detect coarse-pointer (touch) devices. On touch, the Leaflet tooltip
  // intercepts the first tap to show, then the user has to tap exactly the
  // small marker again to fire `click`; tapping the tooltip text itself
  // does nothing. Skip the tooltip there and route tap directly to the
  // modal instead. matchMedia avoids running before window is available.
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(hover: none) and (pointer: coarse)');
    setIsTouch(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const placeColor = useMemo(() => getNerColor('PLACE'), []);

  const { minCount, maxCount } = useMemo(() => {
    if (markers.length === 0) return { minCount: 0, maxCount: 0 };
    const counts = markers.map((m) => m.recording_count);
    return { minCount: Math.min(...counts), maxCount: Math.max(...counts) };
  }, [markers]);

  // Center the map on the centroid of the markers, with a sensible default
  // (geographic center of the contiguous US) when we don't have any.
  const initialCenter = useMemo<[number, number]>(() => {
    if (markers.length === 0) return [39.5, -98.35];
    const lat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
    const lon = markers.reduce((s, m) => s + m.lon, 0) / markers.length;
    return [lat, lon];
  }, [markers]);

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}>
      {markers.length === 0 && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            pointerEvents: 'none',
          }}>
          <Typography
            sx={{
              fontFamily: 'var(--font-serif), Georgia, serif',
              fontSize: '1rem',
              color: colors.text.secondary,
              bgcolor: 'rgba(255,255,255,0.92)',
              border: '1px solid',
              borderColor: colors.grey[200],
              borderRadius: 2,
              px: 2,
              py: 1.25,
            }}>
            No mapped places yet — places need a Wikidata ID to appear here.
          </Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <MapContainer
          center={initialCenter}
          zoom={3}
          minZoom={2}
          maxZoom={12}
          worldCopyJump
          style={{ width: '100%', height: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {markers.map((m) => {
            const radius = computeRadius(m.recording_count, minCount, maxCount);
            // Make the touch hit-target a couple of pixels larger than the
            // visible circle so taps on small markers (recording_count = 1)
            // still register on touch devices. The visible circle keeps its
            // computed size; only the invisible interactive radius grows.
            const touchRadius = Math.max(radius, 14);
            return (
              <CircleMarker
                key={m.entity_uuid}
                center={[m.lat, m.lon]}
                radius={radius}
                pathOptions={{
                  color: placeColor,
                  fillColor: placeColor,
                  fillOpacity: 0.55,
                  weight: 2,
                }}
                bubblingMouseEvents={false}
                eventHandlers={{ click: () => setActive(m) }}>
                {/* Invisible larger circle behind the visible one to widen
                    the tap target on mobile (small markers like
                    recording_count = 1 are otherwise hard to hit). */}
                <CircleMarker
                  center={[m.lat, m.lon]}
                  radius={touchRadius}
                  pathOptions={{ opacity: 0, fillOpacity: 0, weight: 0 }}
                  bubblingMouseEvents={false}
                  eventHandlers={{ click: () => setActive(m) }}
                />
                {/* Tooltip is desktop-only. On touch devices it eats the
                    tap that should open the modal — see isTouch effect. */}
                {!isTouch && (
                  <LTooltip direction="top" offset={[0, -radius - 2]} opacity={1}>
                    <Box sx={{ p: 0.25 }}>
                      <Typography
                        sx={{
                          fontFamily: 'var(--font-serif), Georgia, serif',
                          fontWeight: 700,
                          fontSize: '0.92rem',
                          color: colors.text.primary,
                        }}>
                        {m.canonical_form}
                      </Typography>
                      <Typography sx={{ fontSize: '0.78rem', color: colors.text.secondary }}>
                        {m.recording_count} {m.recording_count === 1 ? 'recording' : 'recordings'} · {m.mention_count}{' '}
                        mention{m.mention_count !== 1 ? 's' : ''}
                      </Typography>
                    </Box>
                  </LTooltip>
                )}
              </CircleMarker>
            );
          })}
        </MapContainer>
      </Box>

      {active && (
        <NerEntityModal
          open
          onClose={() => setActive(null)}
          entityText={active.canonical_form}
          entityLabel="PLACE"
          entityUuid={active.entity_uuid}
        />
      )}
    </Box>
  );
};
