'use client';
import React, { useEffect, useState } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Link from 'next/link';
import { Box, IconButton, Menu, MenuItem, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import MenuIcon from '@mui/icons-material/Menu';
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
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

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
  const closeMenu = () => setMenuAnchor(null);

  const navItems: Array<{ label: string; href: string; isDiscover?: boolean }> = [
    { label: 'Stories', href: '/stories' },
    { label: 'Indexes', href: '/indexes' },
    { label: 'Map', href: '/map' },
    ...(shouldShowCollectionsLink ? [{ label: 'Collections', href: '/collections' }] : []),
    ...(isChatEnabled ? [{ label: 'Discover', href: '/discover', isDiscover: true }] : []),
  ];

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

        {/* Desktop nav: inline links */}
        <Box
          sx={{
            display: { xs: 'none', md: 'flex' },
            gap: 4,
            alignItems: 'center',
            '& a': {
              color: 'common.black',
              textDecoration: 'none',
              fontSize: '0.8125rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              opacity: 0.85,
              transition: 'opacity 0.15s, color 0.15s',
              '&:hover': { opacity: 1, color: 'secondary.main' },
            },
          }}>
          <Link href="/stories">STORIES</Link>
          <Link href="/indexes">INDEXES</Link>
          <Link href="/map">MAP</Link>
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

        {/* Mobile nav: hamburger → menu */}
        <Box sx={{ display: { xs: 'inline-flex', md: 'none' }, alignItems: 'center' }}>
          <IconButton
            aria-label="open navigation"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            sx={{
              border: '1px solid',
              borderColor: 'rgba(0, 0, 0, 0.18)',
              borderRadius: '8px',
              p: 0.75,
              color: 'common.black',
            }}>
            <MenuIcon fontSize="small" />
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={closeMenu}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ list: { dense: true } }}
            sx={{
              mt: 0.5,
              '& .MuiPaper-root': {
                minWidth: 200,
                borderRadius: 2,
                bgcolor: 'background.paper',
              },
              '& a': {
                color: 'common.black',
                textDecoration: 'none',
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                fontWeight: 600,
                letterSpacing: '0.06em',
                fontSize: '0.85rem',
              },
            }}>
            {navItems.map((item) => (
              <MenuItem key={item.href} onClick={closeMenu} sx={{ py: 1.25, px: 2 }}>
                <Link href={item.href}>
                  {item.isDiscover && <AutoAwesomeIcon sx={{ fontSize: 16 }} />}
                  {item.label.toUpperCase()}
                </Link>
              </MenuItem>
            ))}
          </Menu>
        </Box>
      </Toolbar>
    </AppBar>
  );
};
