# Phase 1 Plan — Narrative Intelligence Layer

Working plan for Phase 1 of the narrative intelligence layer. Source spec lives in
`SKILL.md` and the `references/` files alongside this doc.

## Decisions (locked)

1. **One Chunks collection at narrative-segment granularity.** Replace the
   per-paragraph chunker with the Pass 0 segmenter (1–8 paragraphs per chunk).
   Re-import the 12 existing testimonies once. Both `transcription_vector` and
   `question_vector` live on the same row. No parallel `NarrativeSegment`
   collection.
2. **LLM NER replaces GLiNER.** Drop the GLiNER + spaCy NER stack. Pass 0 NER is
   one LLM-driven extraction pass that does entity extraction, variant
   resolution, Wikidata reconciliation, and relationship extraction together.
3. **LLM provider for the narrative pipeline: Gemini 3.1 Flash Lite** via
   Google's OpenAI-compatible endpoint
   (`https://generativelanguage.googleapis.com/v1beta/openai/`). Key in
   `AI_API_KEY`. Falls back to `gemini-2.5-flash-lite` if 3.1 isn't available.
   Model ID configurable in `config.json`. Anthropic stays for the chat/RAG
   layer; Gemini Flash is for ingest-time pipeline work.
4. **Wikidata reconciliation:** best-effort. Only accept a QID when the LLM
   returns it with HIGH confidence AND its description matches the entity's
   in-text variants. Otherwise assign `internal_id`. Cache lookups by canonical
   form to avoid duplicate calls within a source.
5. **`question_vector` embedding model:** same model as the existing `/embed`
   endpoint (so vectors live in the same space and dimensions match
   `transcription_vector`). The vector embeds the concatenated identity-level
   questions per segment.
6. **`QuestionThreads.published` default:** `false` (editorial gate, per spec).
   Editorial review surfaces threads to the public word cloud.

## Sub-phasing

### 1A — Schema + types (this PR)

- Update `json/weaviate-schemas/Chunks.schema.json`:
  - Add `question_vector` named vector (HNSW, cosine, no vectorizer — matches
    `transcription_vector` config).
  - Add properties: `narrative_segment_id`, `segment_summary`, `speaker_role`,
    `question_facts: text[]`, `question_feelings: text[]`,
    `question_identity: text[]`, `question_source_level: text`.
  - Add cross-ref `mentionsEntities -> Entities[]`.
- Add new schema files:
  - `Entities.schema.json` — `description_vector`, properties
    (canonical_form, entity_type, variants, linked_data_qid,
    linked_data_url, linked_data_description, internal_id, context_summary,
    transcription_notes, relationships, entity_slug, collection_id),
    cross-ref `mentionedInChunks -> Chunks[]`.
  - `Conflicts.schema.json` — properties (conflict_id, conflict_type, scope,
    description, shared_question, significance, unresolved, collection_id),
    cross-refs `involvesChunks -> Chunks[]`,
    `involvesTestimonies -> Testimonies[]`.
  - `QuestionThreads.schema.json` — `question_vector`, properties (thread_id,
    thread_question, theme_label, question_level, source_count, convergence,
    published, conflict_ids, collection_id), cross-ref
    `answeredByChunks -> Chunks[]`.
  - `Storylines.schema.json` — properties (storyline_id, title, slug,
    dramatic_question, transformation, editorial_attribution, published,
    composition, collection_id), cross-refs `includesChunks`,
    `includesThreads`, `includesConflicts`.
- Update `types/weaviate.ts` to mirror.
- Verify with `yarn type-check` and a manual `yarn weaviate:generate-schemas`
  apply against an empty Weaviate.
- Reversible: schema-only, no behavior change.

### 1B — Question constellations + dual-vector search

- New `nlp-processor/narrative_pipeline/` module with:
  - `llm_client.py` — Gemini via OpenAI-compatible endpoint, reads
    `config.json` `features.narrativePipeline` settings.
  - `segmentation.py` — Pass 0 segmenter that consumes TheirStory's
    `paragraphs` + `indexes` and produces narrative segments (1–8 paragraphs).
    Replaces `sentence_chunker.py` for new ingest.
  - `question_constellations.py` — per-segment LLM call producing
    facts/feelings/identity questions.
- Wire into `/process-story` under `features.narrativePipeline.enabled` flag
  (default true). When off, falls back to the existing chunker.
- Backfill script `nlp-processor/scripts/backfill_phase1.py` that re-runs
  segmentation + question generation + question_vector embedding for the 12
  already-imported testimonies. Re-import (not in-place edit) to keep chunk
  IDs stable per source.
- End state: dual-vector search works (`transcription_vector` for what was
  said, `question_vector` for what question is answered).

### 1C — LLM NER reconciliation + Entities collection ✅ CODE COMPLETE (awaiting docker rebuild + re-import)

- [x] Deleted `nlp-processor/ner_processor.py`; removed `gliner-spacy` from
      `requirements.txt` (kept `spacy>=3.8.0` for transcript parsing).
- [x] Removed GLiNER config (`Config.GLINER_*`) and `gliner_model` from /health.
- [x] New `narrative_pipeline/entity_extraction.py`:
  - Per-segment LLM extraction (`extract_mentions`) with stochastic confidence:
    each segment runs `ner_runs_per_segment` times (default 1, configurable),
    agreement is recorded per `(text, type)`.
  - Source-level reconciliation (`reconcile`) — one LLM call dedupes variants,
    picks canonical forms, attempts Wikidata QID lookup, extracts relationships
    with grounding quotes.
  - Failure tolerance: extraction errors per segment yield empty mentions for
    that segment; reconciliation crashes leave entity graph empty (logged).
- [x] New `narrative_pipeline/wikidata.py` — best-effort QID verifier with
      3s timeout, lenient token-overlap description gate, gracefully returns None
      on any failure → caller assigns `internal_id`.
- [x] Persists to `Entities` collection with deterministic UUIDs derived from
      `(collection_id, entity_id)`. Same Wikidata QID → same UUID across sources
      (basic cross-source reconciliation for linked entities). Internal-id entities
      remain per-source.
- [x] Each chunk gets `mentionsEntities` cross-refs to its entities (forward
      direction). Reverse `Entities.mentionedInChunks` cross-refs deferred —
      reverse query can use a `where` filter on chunks for now.
- [x] Updated `_run_pass0_pipeline` to integrate NER (extraction +
      reconciliation) before question constellations, all using one
      `NarrativeLLMClient` per source.
- [x] Per-pass overrides honored: `pass0_ner_extraction` and
      `pass0_ner_reconciliation` can each override `model` / `provider` / etc.
- [x] `published` defaults from `features.narrativePipeline.published_by_default.entities`
      (false by default → editorial gate).
- **Activation**: `docker compose build nlp-processor` → recreate container →
  `WEAVIATE_RESET_SCHEMA=true yarn weaviate:generate-schemas` → re-import all
  sources. See `PHASE_1B_BACKFILL.md` § "Phase 1C addendum".

### Known limitations after 1C

- Same canonical-form entities WITHOUT Wikidata QID across sources are still
  separate Entity rows (one per source, internal_id-keyed). Cross-source
  reconciliation of unlinked entities is a Phase 2 concern.
- Reverse `Entities.mentionedInChunks` cross-ref isn't populated (forward
  direction only). Frontend entity pages can use `where: chunks.mentionsEntities ...`
  filter for now.
- Disabled-pipeline path (`features.narrativePipeline.enabled = false`) no
  longer runs NER — chunks land with empty `ner_data`. Acceptable; the
  disabled path is a fallback, not production.

## What Phase 1 does NOT include

- Pass 1 narrative extraction (values, emotional trajectory, metaphors)
- Pass 1.5 conflict detection
- Pass 2 cross-source patterns (QuestionThreads population)
- Pass 3 storyline candidates
- Pass 4 source-to-role mapping
- Editorial CMS for publishing threads/storylines
- Frontend changes (homepage word cloud, testimony page redesign, entity pages)
- Collection loops (invitation system, recording sparked tracking)

These come in subsequent phases. Schema is forward-compatible — Phase 2+ work
adds rows to existing collections rather than re-shaping them.

## Operational notes

- Existing 12 testimonies must be re-imported once Phase 1B ships (chunk IDs
  will change since chunks are now narrative-segment-sized, not paragraph-sized).
- Any external URLs that point at specific chunk UUIDs break after re-import.
  Mitigation: testimonies still resolve by `theirstory_id`; chapter timestamps
  in URLs still work.
- Cost ceiling at 200 sources: ~$10–$20 NER + ~$5 question generation in
  Gemini Flash Lite. Trivial vs developer time.
- LLM non-determinism: stochastic confidence (2 runs) for entity extraction;
  question constellations are run once (the value is the dimension count more
  than absolute precision).

## Spec follow-ups (from SKILL.md / pass0-ingest.md updates)

- **Frankl-moment identity guidance.** The updated identity-level prompt asks
  the model to surface "what did you hold onto that kept you going" rather
  than just "what did this mean." Implemented in
  `nlp-processor/narrative_pipeline/prompts.py`.
- **Published gate on Entities.** SKILL.md's "Published-by-default" project
  setting applies to _both_ QuestionThreads and Entities. `Entities.schema.json`
  and the `Entities` TS type now carry `published: boolean`. Phase 1C must
  default new entities to `published: false` unless `config.json` overrides
  `features.narrativePipeline.entitiesPublishedByDefault: true`.
- **LLM provider per pass (forward-compat).** The new SKILL.md says to
  configure provider/model separately per pass. Phase 1 only runs Pass 0, so
  the current single `features.narrativePipeline` block functions as the
  Pass 0 config. When Pass 1 / 1.5 / 2 ship, restructure to
  `features.narrativePipeline.passes.{pass0,pass1,...}` with optional
  per-pass `provider` / `model` overrides; defaults inherit from the top-level
  block. No code change needed today.
- **Configurable entity types and relationship types.** Spec says these are
  per-project. Schema fields are already free-form `text`; in Phase 1C the
  NER prompts should read the allowed list from
  `config.json` `features.narrativePipeline.entityTypes` /
  `relationshipTypes` rather than hard-coding the defaults inside the prompt
  template. Defaults match the SKILL.md list.
- **Configurable question constellation prompts.** Three-level structure is
  universal but per-level guidance is tunable. Currently hard-coded in
  `prompts.py`. Optional follow-up: pull per-level guidance strings from
  `features.narrativePipeline.questionPromptTuning.{facts,feelings,identity}`
  with the current text as defaults.
