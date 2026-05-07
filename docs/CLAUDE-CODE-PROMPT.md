# Narrative Intelligence Layer for ts-portal-american-stories

## Context

You are working on https://github.com/theirstory/ts-portal-american-stories — an open source Next.js + Weaviate portal for oral history collections. The repo currently supports video playback with synchronized transcripts, NER entity extraction (GLiNER + spaCy), semantic search (Weaviate vector search), and RAG-based conversational discovery (Claude/OpenAI).

We are transforming this from a research portal into a beautiful public-facing archive for American Stories (https://tellyouramericanstory.org/) — a national oral history project asking "How did your family become American?"

The core addition is a **narrative intelligence layer** — a pipeline that extracts narrative entities (question threads, transformation arcs, conflicts, theme labels) alongside traditional named entities, stores them in Weaviate, and powers a public site where visitors can explore stories through themes, storylines, entity connections, and viral collection loops.

## Reference Materials

Before writing any code, read these files which contain the full pipeline specification, output schemas, Weaviate storage architecture, and test results from running the pipeline against 10 American Stories transcripts:

1. **Pipeline specification**: `docs/story-discovery-pipeline/SKILL.md` — the full multi-pass pipeline architecture
2. **Pass 0 (Ingest)**: `docs/story-discovery-pipeline/references/pass0-ingest.md` — segmentation, NER, question constellation generation
3. **Pass 1 (Extraction)**: `docs/story-discovery-pipeline/references/pass1-extraction.md` — narrative extraction and conflict detection
4. **Pass 2 (Patterns)**: `docs/story-discovery-pipeline/references/pass2-patterns.md` — cross-source pattern detection with three-stage discovery (question clustering, multi-frame analysis, transformation/meta-thread detection)
5. **Pass 4 (Composition)**: `docs/story-discovery-pipeline/references/pass4-composition.md` — source-to-role mapping with Rabiger three-function filter
6. **Output schemas + Weaviate architecture**: `docs/story-discovery-pipeline/references/output-schema.md` — complete JSON schemas for all pipeline outputs AND the Weaviate storage architecture showing what goes in Weaviate, what's editorially managed, and what's ephemeral. Includes the specific Weaviate collection definitions (Entities, Conflicts, QuestionThreads) and query patterns for every page type.
7. **Test results**: `docs/test-results/` — actual pipeline output from 10 American Stories transcripts (segment index, entity graph, question constellations, narrative extractions, conflict map, threads, storyline candidates)

Copy these files from the outputs directory into a `docs/` folder in the repo before starting.

## What to Build

### 1. Weaviate Schema Extensions

Extend the existing Weaviate schema (currently `Testimonies` and `Chunks`) with:

**New named vector on Chunks: `question_vector`**

- Each chunk gets a second named vector embedding the identity-level questions it answers (from question constellations)
- This enables dual-vector search: queries match against both what was said (transcription_vector) AND what question the segment answers (question_vector)
- The question_vector is the key technical innovation — it's what makes the three-lens search (facts/feelings/identity) work

**New collection: `Entities`**

- Properties: canonical_form, entity_type (PERSON/PLACE/EVENT/DATE/INSTITUTION/CULTURAL_ITEM), variants (text array), linked_data_qid, linked_data_url, internal_id, context_summary, transcription_notes
- Cross-references: mentionedInChunks (many-to-many), relatedEntities (self-referential with relationship_type qualifier)
- Named vector: description_vector for semantic entity search

**New collection: `Conflicts`**

- Properties: conflict_type (FACTUAL/EMOTIONAL/IDENTITY/FRACTURE), scope (CROSS_SOURCE/INTRA_SOURCE), description, shared_question, significance, unresolved (boolean)
- Cross-references: involvesChunks, involvesTestimonies

**New collection: `QuestionThreads`**

- Properties: theme_label (1-3 words for word cloud), thread_question (the full question), question_level (FACTS/FEELINGS/IDENTITY), source_count, convergence (AGREE/DIVERGE/CONTRADICT), published (boolean — editorial gate)
- Cross-references: answeredByChunks
- Named vector: question_vector for semantic thread search

**New collection: `Storylines`**

- Properties: title, dramatic_question, transformation, published (boolean), editorial_attribution
- Cross-references: includesChunks, includesThreads, includesConflicts
- This is the editorial composition layer — storylines reference threads and chunks but have their own narrative structure

See `docs/story-discovery-pipeline/references/output-schema.md` Section "Storage Architecture" for the complete schema specification including query patterns for every page type.

### 2. Narrative Intelligence Pipeline (NLP Processor Extension)

Extend `nlp-processor/` to run the story discovery pipeline on ingested transcripts. The pipeline has passes that run at different times:

**At ingest time (per source, automated):**

- Pass 0: Segment transcript into citable units with stable IDs. Extract named entities with variant resolution, linked data reconciliation (Wikidata), internal authority records, and relationship extraction. Generate question constellations at three levels (facts/feelings/identity) per segment. Embed the identity-level questions as the `question_vector`. **Important:** The TheirStory JSON already provides word-level timestamps (`words` array), speaker-diarized paragraphs (`paragraphs` array with speaker, start, end), and auto-generated chapters (`indexes` array with title, synopsis, keywords, timecode). Use these as inputs to segmentation rather than re-deriving them. The `paragraphs` array gives you speaker turns. The `indexes` array gives you chapter boundaries. Refine these into narrative segments using the pipeline's topic/temporal/emotional shift criteria.
- Pass 1: For each segment, extract values at play (with charges), emotional trajectory, temporal markers, stance markers, tension indicators, and conceptual metaphors. Store as properties on Chunks.
- Pass 1.5: After all segments are processed, detect conflicts between segment pairs that share entities, events, temporal periods, or similar question constellations. Store as Conflict objects.

**After ingest (corpus-level, triggered when new sources are added):**

- Pass 2 Stage 1: Cluster all question constellations by semantic similarity across sources. Find questions that 3+ sources answer. Create QuestionThread objects with theme labels.
- Pass 2 Stage 2: Run five interpretive frames in parallel (power dynamics, identity formation, loss/adaptation, systemic dynamics, joy/resilience). Surface frame-based threads.
- Pass 2 Stage 3: Detect transformation threads (shared before→after arcs) and meta-threads (questions all sources answer).
- Pass 3: Generate storyline candidates from the strongest threads. Store as draft Storyline objects.

**On demand (editorial):**

- Pass 4: When an editor publishes a storyline, run source-to-role mapping using Rabiger's three-function filter, then assign granular narrative roles to each segment.

The pipeline should support multiple LLM backends (Anthropic Claude, OpenAI, Gemini, open source via OpenAI-compatible API) matching the existing provider configuration in `config.json`. For NER specifically, consider Gemini Flash for cost efficiency at scale (per William Mattingly's findings at Yale).

See the prompt templates in each pass reference file — they are production-ready and should be used as-is or with minimal modification.

### 3. Public-Facing Frontend

Transform the existing Next.js frontend from a research portal into a beautiful public archive. The design should feel editorial and warm — not academic or tool-like. Open `docs/american-stories-prototype.html` in a browser to see the target experience.

**New pages:**

**Homepage** (`/`)

- Hero with "How did your family become American?" tagline and search bar
- Theme cloud: clickable pills of varying sizes, powered by published QuestionThreads aggregated by theme_label, sized by source_count. Clicking a theme shows the question(s) underneath and the testimonies that answer them.
- Featured storylines: 2-3 cards with dramatic questions, pulled from published Storylines
- Story grid: cards for all narrators with initials avatar, name, origin, topic tags

**Testimony page** (`/story/[slug]` — use human-readable slugs, not UUIDs)

- Video player with caption overlay (existing Mux integration)
- Bio section with name, origin, duration, and editorial summary
- "Start here" section: 3 pull-quote entry points with timestamps that scroll to chapters
- View toggle: Chapters | Full transcript | People & places
- Chapters view: warm human titles (not academic), timestamps, one-line summaries. Clicking a chapter shows that chapter's transcript.
- Inline entity annotations: entity names with dotted underline in transcript text. Clicking shows a popup card with entity info, mention count across collection, and link to entity page.
- Spark dividers between chapters: themed prompts ("Does your family share culture over food?") with Record/Send/Copy actions. The "Send to someone" action opens an inline invite form (name, email/phone, personal note textarea). The invitation carries the specific quote that sparked it.
- "Connected stories" section: cards linking to related testimonies (via shared entities or shared QuestionThreads) and storyline links
- Editorial attribution at bottom

**Storyline page** (`/storylines/[slug]`)

- Header with title, one-line description, narrator voice dots
- Editorial attribution box: "This storyline was composed by the American Stories editorial team. The words belong to the narrators."
- Sections organized by question sequence. Each section has:
  - Section epigraph using a narrator's own words as the header (NOT analytical labels like "Sets the world" or "Escalates")
  - Colored left border rail (different color per section)
  - Quote cards: serif italic quote, attribution (name + place + timestamp + "Watch this moment" link)
- Spark dividers between sections with themed prompts and invite forms
- Two closing quotes in a highlighted block
- Growth footer: stats (families in storyline, recordings sparked, invitations sent), CTA ("What did your family hold onto?"), invite form
- "This storyline is still growing" message

**Entity page** (`/entities/[slug]`)

- Entity type badge + canonical name
- Description paragraph
- "Mentioned in" section: cards per testimony with mention count, key quote, and role description
- Narrative tension callout (amber box) if any Conflicts involve this entity — shows the conflict description and links to related storyline
- Related entities: pill links

**Search page** (`/search`)

- Search bar with dual-vector search: queries match against both transcription_vector and question_vector
- Results tagged with match type (Facts match / Feelings match / Identity match) based on which vector space matched
- Result cards: narrator avatar, name, match type badge, excerpt quote, matched question, entity pills
- Storyline connection callout when results cluster around a QuestionThread

**Important design principles:**

- The narrators' words are the content. The pipeline's analytical vocabulary (value-charges, emotional trajectories, conflict types) is editorial infrastructure — it powers discovery but never appears on public pages.
- Section headers on storyline pages use narrator quotes, not analytical labels. "She was raped in the house." not "Escalates."
- Every quote has a "This sparks something" toggle → Send to someone / Record my response / Copy quote. The invitation carries the specific quote and a link to record.
- Connected stories describe the connection in human terms: "Karen Matsuoka — also interned at Tule Lake, her grandfather made a different choice" not "related by entity overlap."
- Mobile-responsive. The primary audience is general public and families of narrators.

### 4. Collection Loop Infrastructure

Build the backend to support the viral recording/sharing loops:

- **Invitation system**: When a visitor clicks "Send to someone," store the invitation (source quote, sender info, recipient info, personal note) and send via email/SMS. The recipient lands on a page showing the quote that sparked the invitation and a prompt to record their own story.
- **Recording integration**: "Record my response" links to the TheirStory recording flow, pre-seeded with the quote that sparked it and the question the storyline section asks.
- **Growth tracking**: Track invitations sent, recordings sparked by each storyline/quote. Display as stats on storyline pages.
- **Pipeline trigger**: When a new recording comes in through a collection loop, automatically run the ingest-time pipeline passes (0, 1, 1.5), then trigger corpus-level re-analysis (Pass 2) to update question threads and surface new connections.

### 5. Editorial Tools

Add a simple editorial interface (can be behind authentication) for:

- Reviewing and publishing QuestionThreads (draft → published controls the word cloud)
- Editing theme labels on QuestionThreads
- Composing Storylines: select threads and chunks, arrange into sections, write epigraphs, preview the storyline page
- Managing the "published" flag on Storylines
- Viewing gap analysis: what voices are missing, suggested interview questions
- Reviewing narrative conflicts and deciding which to surface on entity pages

## Architecture Notes

- The existing `config.json` pattern for theming and feature flags should be extended for narrative intelligence settings. See the "Project Configuration" section in SKILL.md for the full list of configurable settings: interpretive frames, entity types, relationship types, question constellation prompts, theme label vocabulary mode, spark prompts, conflict detection sensitivity, published-by-default behavior, and LLM provider per pass. These should all be configurable in `config.json` with sensible defaults for American Stories.
- The NLP processor currently uses GLiNER + spaCy for NER. The narrative pipeline should run as an additional processing step, not a replacement. Standard NER still runs. The narrative pipeline adds question constellations, narrative extraction, and conflict detection on top.
- Pass 2 (corpus-level analysis) should be idempotent — running it after adding a new source should update existing threads and surface new ones without duplicating.
- The question_vector on Chunks is the most important technical addition. It's what makes the search experience fundamentally different from keyword or transcript-only semantic search.
- Use the existing Docker Compose setup. The narrative pipeline can run as part of the NLP processor service or as a separate service.

## Phasing

If this is too much to build at once, prioritize in this order:

1. **Weaviate schema extensions + Pass 0 pipeline** (entities, question constellations, dual vectors) — this is the foundation everything else builds on
2. **Testimony page redesign** with chapters, inline entities, and start-here quotes — highest-impact visual change
3. **Homepage with theme cloud and story grid** — the entry point
4. **Pass 2 pipeline + QuestionThreads** — cross-source intelligence
5. **Entity pages and search** — the discovery layer
6. **Storyline pages** — editorial composition
7. **Collection loops** — viral growth mechanics
8. **Editorial tools** — composition and publishing interface
