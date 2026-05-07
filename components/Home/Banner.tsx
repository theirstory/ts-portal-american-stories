'use client';

import { Box, Container, Typography } from '@mui/material';

export const Banner = () => {
  return (
    <Box
      sx={{
        width: '100%',
        textAlign: 'center',
        py: { xs: 2.5, md: 2.5 },
        px: 2,
      }}>
      <Container maxWidth="lg" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
        <Typography
          component="h1"
          sx={{
            fontFamily: 'var(--font-display), Helvetica, sans-serif',
            fontSize: { xs: '2rem', sm: '2.75rem', md: '3.5rem', lg: '4.25rem' },
            lineHeight: 1,
            letterSpacing: '0.01em',
            color: 'common.black',
            m: 0,
          }}>
          AMERICAN STORIES
        </Typography>
        <Typography
          component="p"
          sx={{
            fontFamily: 'var(--font-serif), Georgia, serif',
            fontStyle: 'italic',
            fontWeight: 500,
            fontSize: { xs: '1.25rem', md: '1.75rem', lg: '2rem' },
            color: '#F96044',
            m: 0,
            lineHeight: 1.2,
          }}>
          &ldquo;How did your family become American?&rdquo;
        </Typography>
      </Container>
    </Box>
  );
};
