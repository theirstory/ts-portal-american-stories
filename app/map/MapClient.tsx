'use client';

import dynamic from 'next/dynamic';
import { Box, Typography } from '@mui/material';
import type { PlaceMarker } from '@/lib/weaviate/places';

// Leaflet touches `window` on import — never let it run on the server.
// `ssr: false` is only valid inside a client component, so this thin wrapper
// exists for that reason alone.
const MapView = dynamic(() => import('./MapView').then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <Box sx={{ display: 'grid', placeItems: 'center', height: '100%', color: 'text.secondary' }}>
      <Typography sx={{ fontSize: '0.95rem' }}>Loading map…</Typography>
    </Box>
  ),
});

export const MapClient = ({ markers }: { markers: PlaceMarker[] }) => <MapView markers={markers} />;
