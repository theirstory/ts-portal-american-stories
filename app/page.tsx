import { Box } from '@mui/material';
import { Banner } from '@/components/Home/Banner';
import { CelebVideo } from '@/components/Home/CelebVideo';
import { ExploreLinks } from '@/components/Home/ExploreLinks';
import { WordCloudAndSearch } from '@/components/Home/WordCloudAndSearch';
import { FeaturedStories } from '@/components/Home/FeaturedStories';

// AppTopBar on the homepage is a sticky 56-64px nav. Reserve viewport height accordingly so
// the five sections fit without scrolling on a typical desktop.
const HOME_TOPBAR_OFFSET = { xs: 56, md: 64 };

export default function Home() {
  return (
    <Box
      sx={{
        bgcolor: 'background.default',
        color: 'text.primary',
        minHeight: { xs: 'auto', md: `calc(100dvh - ${HOME_TOPBAR_OFFSET.md}px)` },
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
