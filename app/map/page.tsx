import { Box, Typography } from '@mui/material';
import { getPlaceEntitiesForMap } from '@/lib/weaviate/places';
import { MapClient } from './MapClient';

export const metadata = {
  title: 'Map · American Stories',
  description: 'Places mentioned across the American Stories archive.',
};

// Page depends on Weaviate at request time. Skip static prerender during `next build`,
// which has no Weaviate available and would fail the Docker image build.
export const dynamic = 'force-dynamic';

export default async function MapPage() {
  const markers = await getPlaceEntitiesForMap();

  return (
    <Box
      sx={{
        bgcolor: 'background.default',
        height: 'calc(100dvh - 56px)',
        display: 'flex',
        flexDirection: 'column',
      }}>
      <Box
        sx={{
          px: { xs: 2, md: 4 },
          py: { xs: 1.5, md: 2 },
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 1.5,
          flexWrap: 'wrap',
        }}>
        <Box>
          <Typography
            variant="overline"
            sx={{
              letterSpacing: '0.2em',
              color: 'secondary.main',
              fontWeight: 700,
              fontSize: { xs: '0.7rem', md: '0.75rem' },
            }}>
            Map
          </Typography>
          <Typography
            sx={{
              fontFamily: 'var(--font-display), Helvetica, sans-serif',
              fontSize: { xs: '1.5rem', md: '1.85rem' },
              color: 'common.black',
              letterSpacing: '0.01em',
              lineHeight: 1.1,
              mt: 0.25,
            }}>
            Places across the archive
          </Typography>
        </Box>
        <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem', maxWidth: 460 }}>
          Click any pin to see excerpts from the recordings that reference it. Pin size scales by how many distinct
          recordings mention the place.
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <MapClient markers={markers} />
      </Box>
    </Box>
  );
}
