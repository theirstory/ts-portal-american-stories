'use client';

import { Box, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

const EXPLORE_LINKS = [
  { label: 'Getting Started' },
  { label: 'Community Resources' },
  { label: 'Press' },
  { label: 'About' },
  { label: 'Contact' },
];

export const ExploreLinks = () => {
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        px: { xs: 2, md: 4 },
        py: { xs: 2, md: 0 },
      }}>
      <Typography
        variant="overline"
        sx={{
          letterSpacing: '0.2em',
          color: 'secondary.main',
          fontWeight: 700,
          mb: 1.5,
          display: 'block',
          fontSize: { xs: '0.7rem', md: '0.75rem' },
        }}>
        Explore
      </Typography>
      <Box
        component="nav"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          borderTop: '1px solid',
          borderColor: 'divider',
        }}>
        {EXPLORE_LINKS.map((link) => (
          <Box
            key={link.label}
            component="a"
            href="#"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              py: { xs: 1.25, md: 1.5 },
              borderBottom: '1px solid',
              borderColor: 'divider',
              textDecoration: 'none',
              color: 'common.black',
              transition: 'color 0.15s ease, padding-left 0.15s ease',
              cursor: 'pointer',
              '&:hover': {
                color: 'secondary.main',
                pl: 1,
              },
              '&:hover .explore-arrow': { transform: 'translateX(4px)', opacity: 1 },
            }}>
            <Typography
              sx={{
                fontFamily: 'var(--font-serif), Georgia, serif',
                fontSize: { xs: '1.125rem', md: '1.375rem' },
                fontWeight: 600,
                lineHeight: 1.2,
              }}>
              {link.label}
            </Typography>
            <ArrowForwardIcon
              className="explore-arrow"
              sx={{
                fontSize: 18,
                color: 'secondary.main',
                opacity: 0.6,
                transition: 'transform 0.2s ease, opacity 0.2s ease',
              }}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
};
