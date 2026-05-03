# American Stories Redesign Plan

Working plan for redesigning the TheirStory portal as the public American Stories
site, anchored to https://tellyouramericanstory.org/ branding and the
`American Stories Deck` PDF (4 pages, May 2024).

## Source material

- **Deck**: `/Users/zackellis/Downloads/American Stories Deck (1).pdf` (4 pages)
  - Page 1 — Celeb teaser film (4–8 min, 3 celebs, July 4th drop) and curation flywheel
  - Page 2 — Web/mobile platform; crowdsource stories with images, AI, video clips; curated from Patreon/donor channels
  - Page 3 — "Digital archive for people & posterity"; story categories: Home, Freedom, Heroes, Immigration, Family
  - Page 4 — Homepage wireframe: hero film, "Shoot your American story" CTA, filterable categorized stories grid, footer sections (Get Started / Community Resources / Press / About / Contacts)
  - Tagline themes: "folksy", "as we like it", "in our own words", "to excite millions of hearts and minds"
- **Reference site**: tellyouramericanstory.org — black + cream + teal accent, serif display for big headings, clean sans for body, photography-driven documentary aesthetic
- **Reference screenshots** (TODO — files at `/Users/zackellis/Desktop/Screenshot 2026-05-02 at 6.41.12 PM.png` and `/Users/zackellis/Desktop/Screenshot 2026-05-03 at 3.00.37 PM.png` were referenced but no longer on disk; need user to re-attach)

## Codebase context

- Next.js + MUI + Emotion (no Tailwind)
- Theme: `lib/theme/theme.ts` and `lib/theme/colors.ts`, driven by `config/organizationConfig.ts`
- Fonts: Public Sans (body), Inter (MUI typography)
- Current home: `app/page.tsx` → `<RecordingsPage />` → `<CollectionLayout />` (search + grid/list view of stories)
- Layout: `app/layout.tsx` → `<MaterialUIThemeProvider>` → `<MainContainer>` → `<EmbedGuard>` → `<AppTopBar>` + children + `<FloatingChatDrawer>`
- Reusable for redesign: `<AppTopBar>`, `<CarouselTopBar>`, `<GridView>` cards, `<SearchBox>`
- Branding assets in `public/images/`: `american-stories-logo-black.jpg`, `american-stories-background.png`, carousel images

## Phased plan

### Phase 1 — Brand foundation ✅ DONE

- [x] `config.json` palette → primary black `#111111`, secondary teal `#239B8B` (kept), backgrounds cream `#FBF8F2` / `#F5EFE3` / white paper
- [x] `next/font/google`: Public Sans (body), Playfair Display (h1/h2/h3), Archivo Black (display wordmark) wired as CSS vars `--font-sans`, `--font-serif`, `--font-display`
- [x] MUI theme `h1`/`h2`/`h3` use Playfair with tight letter-spacing
- [x] `globals.css` updated: cream body bg, dark text, teal mobile focus outline, taupe scrollbar
- [x] Dev server boots, type-check clean, `/` and `/stories` both 200 OK

### Phase 2 — New homepage ✅ DONE (revised to 5-section spec from wireframe)

- [x] `<RecordingsPage />` moved to `/stories` (`app/stories/page.tsx`); old data-portal preserved
- [x] `<RecordingsPage />` extended to read `?q=<term>&searchType=hybrid` URL params and trigger `runHybridSearch` on Chunks instead of loading all stories
- [x] `AppTopBar` home mode: slim sticky nav, dark text on cream `rgba(251,248,242,0.92)` with backdrop blur (was transparent-over-image)
- [x] `AMERICAN STORIES` banner — Archivo Black wordmark + italic Playfair tagline ("How did your family become American?")
- [x] Celeb video section — TheirStory iframe (George Takei: `https://theirstory.io/AmericanStories/home-page/s/Neld7Yo8d7/solo`), pull-quote, "Shoot your American story" CTA
- [x] Explore strip — 5 cells (Getting Started / Community Resources / Press / About / Contact); links don't navigate yet (per spec)
- [x] Word cloud + hybrid search:
  - New server function `getTopNerEntities(limit)` in `lib/weaviate/search.ts` — aggregates `ner_text`/`ner_labels` parallel arrays across chunks (sample 4000), excludes pronouns/short tokens
  - Client component renders top 15 entities sized by frequency, colored underline by NER type
  - Click entity → `<NerEntityModal>` extended with `hideInterviewTab` prop so it opens directly to the cross-recording "In the project" tab
  - Search box → routes to `/stories?q=...&searchType=hybrid`
- [x] Featured American Stories — horizontally scrollable Mux player cards (12 stories), title + ner_label hashtags, click title routes to `/story/[uuid]`
- [x] HomeFooter — slim black bar with brand mark and TheirStory attribution

### Side-effect fix (env)

- [x] `.env.local`: switched `WEAVIATE_HOST_URL` from `weaviate` (Docker DNS) to `localhost` and `WEAVIATE_PORT` from `8080` to `8081` so host-side `yarn dev` reaches the dockerized Weaviate

### Phase 3 — Cross-page polish

Goal: extend brand to interior pages once the landing lands.

- [ ] Story detail page typography pass
- [ ] Collections page treatment to match
- [ ] Site-wide footer

## Open questions (parked until user answers)

1. Re-attach screenshots — especially the "imagined homepage" — to ground the visual direction.
2. Scope confirmation: Phase 1 + 2 first, then revisit?
3. Hero video: stub with carousel until celeb film ships, or wait?
4. Routing OK to move current homepage to `/stories`?

## Notes / non-obvious context

- Local Node 25 + Yarn 3.1.1 is broken (`isDate is not a function`); use Node 20 (`/opt/homebrew/opt/node@20/bin`) for `yarn install` and scripts.
- `package-lock.json` is untracked in repo root — looks like a stray `npm install` ran here. Should be deleted (this is a yarn project).
