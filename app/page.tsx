import { Box } from '@mui/material';
import { Banner } from '@/components/Home/Banner';
import { CelebVideo } from '@/components/Home/CelebVideo';
import { ExploreLinks } from '@/components/Home/ExploreLinks';
import { WordCloudAndSearch } from '@/components/Home/WordCloudAndSearch';
import { FeaturedStories } from '@/components/Home/FeaturedStories';

// AppTopBar is hidden on the home page (Stories / Indexes / Discover live
// inside the page sections), so the grid takes the full viewport.

export default function Home() {
  return (
    <Box
      sx={{
        bgcolor: 'background.default',
        color: 'text.primary',
        minHeight: { xs: 'auto', md: '100dvh' },
        display: 'grid',
        gridTemplateRows: { xs: 'auto auto auto auto auto', md: 'auto 1fr 1fr' },
        gridTemplateColumns: '1fr',
      }}>
      {/* Row 1 — banner */}
      <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Banner />
      </Box>

      {/* Row 2 — celeb video (left) + explore (right) */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) minmax(0, 1fr)' },
          minHeight: 0,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.subtle',
          py: { xs: 0, md: 2 },
        }}>
        <Box
          sx={{
            minHeight: 0,
            borderRight: { xs: 'none', md: '1px solid' },
            borderBottom: { xs: '1px solid', md: 'none' },
            borderColor: 'divider !important',
            py: { xs: 3, md: 0 },
          }}>
          <CelebVideo />
        </Box>
        <Box sx={{ minHeight: 0 }}>
          <ExploreLinks />
        </Box>
      </Box>

      {/* Row 3 — featured stories (left) + word cloud + search (right) */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) minmax(0, 1fr)' },
          minHeight: 0,
          py: { xs: 0, md: 2 },
        }}>
        <Box
          sx={{
            minHeight: 0,
            borderRight: { xs: 'none', md: '1px solid' },
            borderBottom: { xs: '1px solid', md: 'none' },
            borderColor: 'divider !important',
            py: { xs: 3, md: 0 },
          }}>
          <FeaturedStories />
        </Box>
        <Box sx={{ minHeight: 0, py: { xs: 3, md: 0 } }}>
          <WordCloudAndSearch />
        </Box>
      </Box>
    </Box>
  );
}
