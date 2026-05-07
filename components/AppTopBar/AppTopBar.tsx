'use client';
import React, { useEffect } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Link from 'next/link';
import { Box, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { usePathname, useSearchParams } from 'next/navigation';
import { isChatEnabled } from '@/config/organizationConfig';
import { useSemanticSearchStore } from '@/app/stores/useSemanticSearchStore';

export interface NavLink {
  name: string;
  href: string;
  icon?: React.ReactElement;
}

export const AppTopBar = () => {
  const { collections, loadCollections } = useSemanticSearchStore();

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get('embed') === 'true';

  useEffect(() => {
    if (collections.length === 0) {
      loadCollections();
    }
  }, [collections.length, loadCollections]);

  if (isEmbed) return null;
  // Home page is fully self-contained — Stories / Indexes / Discover entry
  // points live inside the page sections, not in a global navbar.
  if (pathname === '/') return null;

  const shouldShowCollectionsLink = collections.length > 1;

  return (
    <AppBar
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        boxShadow: 'none',
        backgroundColor: 'rgba(251, 248, 242, 0.92)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
      elevation={0}>
      <Toolbar
        disableGutters
        sx={{
          justifyContent: 'space-between',
          px: { xs: 2, md: 4 },
          py: { xs: 1, md: 1.5 },
          minHeight: { xs: 56, md: 64 },
        }}>
        <Link href="/" style={{ textDecoration: 'none' }}>
          <Typography
            sx={{
              fontFamily: 'var(--font-display), Helvetica, sans-serif',
              fontSize: { xs: '0.875rem', md: '1rem' },
              color: 'common.black',
              letterSpacing: '0.04em',
            }}>
            AMERICAN STORIES
          </Typography>
        </Link>
        <Box
          sx={{
            display: 'flex',
            gap: { xs: 2, md: 4 },
            alignItems: 'center',
            '& a': {
              color: 'common.black',
              textDecoration: 'none',
              fontSize: { xs: '0.7rem', md: '0.8125rem' },
              fontWeight: 700,
              letterSpacing: '0.08em',
              opacity: 0.85,
              transition: 'opacity 0.15s, color 0.15s',
              '&:hover': { opacity: 1, color: 'secondary.main' },
            },
          }}>
          <Link href="/stories">STORIES</Link>
          <Link href="/indexes">INDEXES</Link>
          {shouldShowCollectionsLink && <Link href="/collections">COLLECTIONS</Link>}
          {isChatEnabled && (
            <Box
              component={Link}
              href="/discover"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                border: '1.5px solid',
                borderColor: 'common.black',
                borderRadius: '6px',
                padding: '4px 12px',
                '&:hover': {
                  borderColor: 'secondary.main',
                  color: 'secondary.main',
                },
              }}>
              <AutoAwesomeIcon sx={{ fontSize: 16 }} />
              DISCOVER
            </Box>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
};
