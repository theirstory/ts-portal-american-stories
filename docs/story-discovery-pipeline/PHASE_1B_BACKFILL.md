# Phase 1B Backfill — Operator Guide

After Phase 1B ships, the existing 12 testimonies need to be re-imported so their
chunks land at narrative-segment granularity with the new `question_vector`
populated. This is a one-time migration.

## Prerequisites

1. **Add `AI_API_KEY` to `nlp-processor/.env`** (the same Google AI Studio key
   that's already in `.env.local`). The Next.js side uses it for chat;
   the nlp-processor service uses it for the narrative pipeline.

   ```bash
   echo 'AI_API_KEY=<your-key>' >> nlp-processor/.env
   ```

2. **Rebuild the nlp-processor Docker image** so `openai>=1.40.0` and the new
   `narrative_pipeline/` module are available:

   ```bash
   docker compose build nlp-processor
   ```

3. **Confirm `config.json` has `features.narrativePipeline.enabled: true`**
   (default after Phase 1A). Disable it any time by flipping the flag —
   the legacy sentence-window chunker will run instead.

## Backfill Steps

```bash
# 1. Capture the current testimony IDs before resetting.
yarn theirstory:list-ids > backfill_ids.txt
wc -l backfill_ids.txt   # sanity check — should be ~12

# 2. Reset and recreate Weaviate schemas. RESET_SCHEMA=true wipes all classes
#    in the schema files, then re-applies them with the new vectorConfig
#    (question_vector on Chunks, description_vector on Entities, etc.).
WEAVIATE_RESET_SCHEMA=true yarn weaviate:generate-schemas

# 3. Restart docker compose so the new image with openai + narrative_pipeline
#    is running.
docker compose up -d --force-recreate nlp-processor

# 4. Re-import each testimony. Each call sends the transcript through the new
#    /process-story flow which runs Pass 0 (segmentation + question
#    constellations + question_vector embedding).
while IFS= read -r id; do
  [ -z "$id" ] && continue
  echo "=== Re-importing $id ==="
  yarn theirstory:import-stories --ids "$id"
done < backfill_ids.txt
```

## What you should see in the logs

For each testimony:

```
🧬 STARTING NARRATIVE PIPELINE PASS 0 (model=gemini-3.1-flash-lite)...
   👤 Narrator: George Takei | interviewers: ['Elizabeth Hira']
   🔗 Source slug: george_takei
   📑 Pass 0 segmentation produced 34 narrative segments
   🧠 Generating question constellations for 34 segments...
   ✅ Question constellations done in 18.7s

📦 Pass 0 produced 34 narrative segments (replaces legacy sentence-window chunks)

🧮 Generating 34 transcription embeddings in batch...
🧠 Generating 27 question_vector embeddings (of 34 segments)...
```

The "27 of 34" number is normal — interviewer segments get skipped per
`features.narrativePipeline.skip_interviewer_segments`, and any LLM error
yields an empty constellation (the segment still gets `transcription_vector`,
just no `question_vector`).

## Sanity checks after backfill

```bash
# 1. Verify Chunks collection has question_vector named vector.
curl -s "http://localhost:8081/v1/schema/Chunks" \
  | jq '.vectorConfig | keys'
# Expect: ["question_vector", "transcription_vector"]

# 2. Sample a chunk and check the new properties.
curl -s "http://localhost:8081/v1/objects?class=Chunks&limit=1&include=vector" \
  | jq '.objects[0].properties
        | {narrative_segment_id, segment_summary, speaker_role,
           question_facts, question_feelings, question_identity}'

# 3. Confirm the new collections exist.
curl -s "http://localhost:8081/v1/schema" \
  | jq '[.classes[].class]'
# Expect to include: Entities, Conflicts, QuestionThreads, Storylines
```

## Rollback

If anything goes wrong, set
`features.narrativePipeline.enabled: false` in `config.json`, reset the schema,
and re-import — the legacy sentence-window chunker takes over and produces
the same chunk shape as before Phase 1B.

## Phase 1C addendum (when code is merged)

Phase 1C drops GLiNER and replaces it with LLM NER + reconciliation +
Wikidata-verified entities. Activating it requires another rebuild + re-import:

```bash
# 1. Rebuild — Dockerfile pulls the new narrative_pipeline.entity_extraction
#    module and the updated requirements (gliner-spacy gone, openai stays).
docker compose build nlp-processor
docker compose up -d --force-recreate nlp-processor

# 2. Reset schema (Entities collection now gets populated by ingest, so the
#    existing Entities rows from Phase 1A — empty — should be wiped along
#    with everything else).
WEAVIATE_RESET_SCHEMA=true yarn weaviate:generate-schemas

# 3. Re-import each testimony exactly like Phase 1B.
while IFS= read -r id; do
  [ -z "$id" ] && continue
  yarn theirstory:import-stories --ids "$id"
done < backfill_ids.txt
```

Per-source cost goes up (NER adds 1 LLM call per narrator segment, plus 1
reconciliation call per source). With Gemini Flash Lite and stochastic
runs=1 (default), expect ~$0.05–0.10 per source. Stochastic confidence
runs=2 doubles cost; toggle via `features.narrativePipeline.ner_runs_per_segment`.

## Sanity checks specific to 1C

```bash
# Entities collection populated
curl -s 'http://localhost:8081/v1/graphql' -H 'Content-Type: application/json' \
  -d '{"query":"{ Aggregate { Entities { meta { count } } } }"}' | jq

# Sample entity with relationships + Wikidata data
curl -s 'http://localhost:8081/v1/objects?class=Entities&limit=1' \
  | jq '.objects[0].properties | {canonical_form, entity_type, wikidata_qid, linked_data_url, internal_id, variants, relationships, published}'

# Chunk → entity cross-ref
curl -s 'http://localhost:8081/v1/objects?class=Chunks&limit=1' \
  | jq '.objects[0].properties.mentionsEntities'
```

## Cost

Per-source LLM cost (Gemini 2.5/3.1 Flash Lite, ~30 segments × 1 call ea):

- Input tokens: ~30 × 600 ≈ 18,000 tok per source
- Output tokens: ~30 × 250 ≈ 7,500 tok per source
- 12 sources ≈ 0.3M tokens total — well inside Google AI Studio's free tier.

For a 200-source corpus (Phase 2+ ingest at scale): ~5M tokens ≈ $1–2.
