---
name: story-discovery-pipeline
description: >
  Analyze a collection of oral history transcripts, documents, and primary sources to discover
  compelling storylines, extract entities, generate searchable question layers, and surface
  narrative conflicts. Use this skill whenever the user wants to: find stories within a collection
  of recordings or transcripts, run narrative analysis on oral histories, extract themes and
  storylines from interviews, generate metadata for an oral history archive, identify connections
  between testimonies, build a knowledge graph from spoken-word content, or prepare primary
  sources for a public-facing digital archive. Also trigger when the user mentions "story
  discovery", "narrative pipeline", "cross-source analysis", "testimony analysis", or wants to
  process transcripts for TheirStory or any oral history project.
---

# Story Discovery Pipeline

A multi-pass analytical pipeline that takes a collection of oral history transcripts (and optionally
documents, images, spreadsheets) and produces: a segment index, named entities with relationships,
searchable question constellations at three cognitive levels, narrative conflict maps, cross-source
thematic threads, and ranked storyline candidates with supporting evidence and gap analysis.

## Theoretical Foundations

This pipeline draws on several frameworks, combined to serve the specific challenge of finding
stories _within existing primary sources_ rather than constructing them from scratch:

- **Robert McKee (Story)**: Value-charge analysis — every narrative segment turns a human value
  from positive to negative or vice versa. Segments where values turn are where story lives.
- **Lisa Cron (Story Genius)**: Transformation detection — the story is the change in belief or
  understanding. Look for the "misbelief" that shifts across the material.
- **Stone, Patton & Heen (Difficult Conversations)**: The three-conversation lens — every moment
  contains facts (who/what/where/when), feelings (emotional experience), and identity (meaning-making
  about self, others, and the world). This structures question generation.
- **George Lakoff (Metaphors We Live By)**: Conceptual metaphor extraction — people reveal their
  worldview through unconscious metaphorical framing. Track how metaphors shift to detect
  transformation.
- **Donella Meadows (Thinking in Systems)**: Systems dynamics — look for stocks depleting, feedback
  loops forming, and leverage points where small changes redirect the whole system.
- **Marvin Minsky (The Society of Mind)**: Multi-agent interpretation — run competing analytical
  frames in parallel rather than converging on one reading. Robust findings emerge from multiple
  frames independently.
- **Michael Rabiger (Directing the Documentary)**: The "found story" model — start from the
  premise that you are discovering a story that exists in the material, not imposing one.
  Identify the dramatic question first (the single question the audience needs answered), then
  treat every piece of source material as either advancing, complicating, or resolving that
  question. Rabiger's three-function test is the primary editorial filter for whether material
  belongs in a storyline. His framework was built for exactly the problem this pipeline solves:
  finding narrative structure in found material rather than constructing it from scratch.
- **Viktor Frankl (Man's Search for Meaning)**: The most narratively powerful moments in any
  testimony are where someone articulates the meaning they found that allowed them to endure.
  Not what happened to them, but what they held onto that made the suffering survivable. This
  sharpens the identity level of question generation: the deepest identity questions are not
  just "what meaning did you make?" but "what meaning kept you going?" Every narrator has a
  Frankl moment — the point where they name the irreducible thing that could not be taken.
- **US Holocaust Memorial Museum approach**: Reverse-engineer the ideal questions each segment
  answers, creating a semantic bridge between how people search (with questions) and how people
  speak (in stories).

## Pipeline Overview

```
Pass 0: Ingest & Normalize
  ├── Segment transcripts into citable units with stable IDs
  ├── Extract named entities (people, places, events, dates, institutions)
  │   ├── Variant resolution & deduplication
  │   ├── Linked data reconciliation (Wikidata/Wikipedia where possible)
  │   ├── Internal authority records for unlinked entities
  │   └── Relationship extraction (edges between entities with qualifiers)
  └── Generate question constellations (facts / feelings / identity) per segment

Pass 1: Segment-Level Narrative Extraction
  ├── Values at play (what human values are affirmed or threatened)
  ├── Emotional charge & trajectory (McKee value-turns)
  ├── Temporal markers (explicit and implicit)
  ├── Stance markers (reflective vs. present-tense)
  ├── Tension indicators (opposition, contradiction, unresolved friction)
  └── Conceptual metaphor extraction (Lakoff)

Pass 1.5: Conflict Detection
  ├── Factual divergence (same event, different details or decisions)
  ├── Emotional opposition (same experience type, different affective charge)
  ├── Identity contradiction (same meaning question, opposite conclusions)
  └── Narrative fracture (self-contradiction within a single source or family)

Pass 2: Cross-Source Pattern Detection
  ├── Stage 1: Question Clustering (PRIMARY)
  │   ├── Cluster all Pass 0 question constellations by semantic similarity
  │   ├── Find questions that 3+ sources independently answer
  │   └── Produce Question Threads: question as key, excerpts as values
  ├── Stage 2: Multi-Frame Analysis (Minsky)
  │   ├── Power dynamics frame
  │   ├── Identity formation frame
  │   ├── Loss and adaptation frame
  │   ├── Institutional/systemic frame (Meadows)
  │   └── Joy and resilience frame
  ├── Stage 3: Transformation & Meta-Thread Detection
  │   ├── Transformation threads (shared before→after across sources)
  │   └── Meta-threads (questions ALL sources answer differently)
  └── Merge, deduplicate, and rank all threads from all three stages

Pass 3: Storyline Candidate Generation
  ├── Dramatic question (what the audience needs answered)
  ├── Transformation hypothesis (what belief or understanding shifts)
  ├── Question sequence (the story expressed as a series of questions)
  ├── Supporting evidence (segment IDs from across the corpus)
  ├── Conflict spine (the unresolved tensions that give it narrative energy)
  └── Gap analysis (what's missing, who to interview next, what to ask)

Pass 4: Source-to-Role Mapping (runs after user selects a storyline)
  ├── Sets the world (establishes the before-state)
  ├── Introduces the tension
  ├── Escalates (raises stakes)
  ├── Complicates (adds unexpected dimension)
  ├── Turns (pivotal moment)
  ├── Resolves or reframes
  ├── Provides evidence (data, documents proving stakes were real)
  ├── Reveals the system (helps audience understand WHY)
  ├── Adds texture (images, ambient details)
  └── Is tangential (related but not part of this story)
```

## How to Run This Pipeline

### Prerequisites

The user provides one or more of:

- Timestamped oral history transcripts (text files, one per recording)
- Documents (letters, reports, articles)
- Optionally: the interview question set used to elicit the recordings
- Optionally: a brief description of what they think the collection is about

### Execution Strategy

**Pass 0 runs at ingest time** — it's expensive but stable. Results don't change based on what
story the user is looking for. Cache everything.

**Passes 1 and 1.5 also run at ingest time** — segment-level extraction is independent of
editorial intent.

**Passes 2 and 3 are where the user's intent enters** — these should be more dynamic, optionally
seeded by the user's sense of what the collection is about.

**Pass 4 runs on demand** after the user selects a storyline candidate.

### For Small Collections (< 15 sources)

Run all passes sequentially in a single session. The full corpus likely fits within context for
cross-source analysis.

### For Large Collections (15+ sources)

Run Pass 0, 1, and 1.5 per-source (parallelizable). For Pass 2, cluster segments by their Pass 0
question constellations using embedding similarity, then run synthesis within clusters. Pass 3
operates on the thread-level summaries from Pass 2, not raw segments.

### Project Configuration

The pipeline ships with defaults tuned for oral history collections about identity and
belonging (the American Stories use case). The following settings are configurable per project:

**Interpretive frames** (Pass 2 Stage 2): The analytical lenses run in parallel. Default
frames: power dynamics, identity formation, loss and adaptation, systemic dynamics (Meadows),
joy and resilience. These are not canonical — they emerged from testing against identity-focused
oral histories. A veterans project might use: duty/sacrifice, moral injury, homecoming,
institutional trust, camaraderie. A corporate knowledge base might use: decision-making
patterns, institutional memory, leadership transitions, innovation culture, crisis response.
Define each frame as a name + a prompt describing what to look for.

**Entity types** (Pass 0): Default: PERSON, PLACE, EVENT, DATE, INSTITUTION, CULTURAL_ITEM.
Projects can add types (e.g., POLICY, PRODUCT, METHODOLOGY) or remove irrelevant ones.

**Relationship types** (Pass 0): Default: FAMILY_OF, REPRESENTED, INTERNED_AT, LIVED_IN,
WORKED_AT, FOUGHT_FOR, CREATED, LED, TAUGHT, SAVED, OPPOSED, COLLABORATED_WITH, INFLUENCED,
PRECEDED, FOLLOWED. Projects can extend with domain-specific relationships (SERVED_WITH,
COMMANDED_BY, REPORTED_TO, etc.).

**Question constellation prompts** (Pass 0): The three levels (facts/feelings/identity) are
universal. The specific prompt guidance for what each level looks for can be tuned per project.
A healthcare project might emphasize patient experience under "feelings." A legal archive
might emphasize evidentiary detail under "facts."

**Theme label vocabulary** (Pass 2): Two modes: open vocabulary (pipeline generates labels,
humans curate) or constrained vocabulary (pipeline maps to a provided list of allowed labels,
e.g., subject headings or a project-specific taxonomy).

**Spark prompts** (collection loops): The between-chapter prompts that invite visitors to
record ("Does your family share culture over food?"). Can be auto-generated from question
threads or hand-written by the editorial team. Project-specific.

**Conflict detection sensitivity**: aggressive (compare all plausible segment pairs, surface
everything), moderate (default — compare pairs sharing entities/events/questions, require
clear evidence), conservative (high threshold, for projects with living narrators where
surfacing disagreement requires care).

**Published-by-default**: Whether new QuestionThreads and Entities require editorial review
before appearing on the public site. Default: draft (requires review). Small projects may
set to auto-publish.

**LLM provider per pass**: Not one global setting. Configure separately for each pass.
Example: Gemini Flash for NER (cheap, fast), Claude for narrative extraction and conflict
detection (needs interpretive sophistication), open source for question generation and
embeddings (runs locally, no API cost).

**What is NOT configurable** (universal to the methodology):

- The three-stage Pass 2 architecture (question clustering → multi-frame → transformation/meta-thread)
- The Rabiger three-function filter in Pass 4
- The dual-vector approach (transcript + question embeddings)
- The conflict type taxonomy (FACTUAL, EMOTIONAL, IDENTITY, FRACTURE)
- The principle that narrators' words face the public and analytical vocabulary stays behind the scenes

### Model Configuration

This pipeline is model-agnostic. It works with frontier API models (Claude, Gemini, GPT) and
open source models (Llama, Mistral, Qwen, Gemma). However, model capability affects how the
pipeline should be configured:

**Frontier models (Claude Sonnet/Opus, Gemini Pro, GPT-4o):**
Run as described above. Full prompt complexity, large context windows for cross-source passes.

**Open source models (70B+ parameter):**

- Use structured output enforcement (Outlines, vLLM, llama.cpp grammars) rather than relying
  on the model to self-format JSON. The output schemas in `references/output-schema.md` are
  designed to be enforceable at the decoding level.
- Lower the "large collection" threshold from 15 to 5 sources for cross-source passes. Window
  Pass 2 synthesis across clusters of 3-5 sources, then synthesize the syntheses.
- For NER (Pass 0), use William Mattingly's stochastic confidence approach: run extraction
  multiple times and use inconsistency as the real confidence metric. This is cheap with
  local inference.
- The five-frame parallel analysis in Pass 2 maps naturally to parallel GPU inference — run
  five model instances simultaneously rather than sequentially.

**Open source models (7B-30B parameter):**

- All of the above, plus:
- Simplify Pass 1 prompts: make conceptual metaphor extraction optional, reduce emotional
  trajectory to a single charge (positive/negative/mixed) rather than a trajectory with turns,
  and drop the alternative-reading requirement for value analysis.
- Split complex prompts into sequential simpler prompts. For example, run values extraction
  and tension detection as separate calls rather than one combined prompt.
- Expect lower quality on Pass 1.5 (conflict detection) — smaller models struggle with the
  interpretive sophistication required to distinguish emotional opposition from factual
  divergence. Consider running conflict detection only with a frontier model even if the
  rest of the pipeline uses open source.

**Cost and speed reference (approximate, as of mid-2025):**

- Frontier API: ~$0.50-2.00 per source for full pipeline (varies by transcript length)
- Open source 70B (cloud GPU): ~$0.10-0.30 per source
- Open source 70B (local): compute cost only, ~2-5 minutes per source per pass
- NER with Gemini Flash (per William Mattingly): ~$0.04 per 50-page document

## Detailed Pass Instructions

Read `references/pass0-ingest.md` for Pass 0 (segmentation, NER, question generation).
Read `references/pass1-extraction.md` for Pass 1 (narrative extraction) and Pass 1.5 (conflict detection).
Read `references/pass2-patterns.md` for Pass 2 (cross-source patterns) and Pass 3 (storyline candidates).
Read `references/pass4-composition.md` for Pass 4 (source-to-role mapping).

Each reference file contains the specific prompt templates and output schemas for that pass.

## Output Schema

The pipeline produces a JSON structure. Read `references/output-schema.md` for the complete
specification. The key objects are:

- **SegmentIndex**: Every citable unit across all sources, with stable IDs and timestamps
- **EntityGraph**: All extracted entities with variants, linked data URIs, internal authority
  records, and relationship edges with qualifiers grounded in source quotes
- **QuestionConstellations**: For each segment, the facts/feelings/identity questions it answers,
  at segment, passage, and source granularity
- **ConflictMap**: All detected conflicts (factual, emotional, identity, narrative) with the
  segment pairs involved and conflict type
- **NarrativeThreads**: Cross-source patterns with supporting segment IDs, temporal arcs,
  key voices, and system dynamics
- **StorylineCandidates**: Ranked storyline proposals with dramatic questions, transformation
  hypotheses, question sequences, evidence, conflict spines, and gap analysis

## Important Principles

**You are discovering, not imposing (Rabiger).** The foundational premise of this entire pipeline
is that the story already exists in the material — your job is to find it, not construct it.
Every analytical pass should surface what's there rather than project a narrative onto it. When
a reading feels forced — when you have to stretch to make material fit a thread — that's a
signal the thread isn't real, not a signal to stretch harder. The Rabiger test: can you point
to specific moments in the source material that _independently_ carry this narrative thread,
or are you connecting dots that only connect because you've decided they should?

**Preserve ambiguity.** When assigning a value-charge or narrative role, state confidence and
note alternative readings. A segment might be "resilience" or "denial" — the difference depends
on the storyline. Surface that to the user rather than collapsing it.

**Generate questions at three granularities.** Segment-level questions power search.
Passage-level questions (clusters of related segments) power thematic exploration. Source-level
questions power the storyline layer.

**Prioritize identity-level questions.** Oral histories are rich in identity-layer material
because interviewers tend to ask meaning-making questions. But facts and feelings are buried
inside the answers and must be excavated.

**Watch for the bookend delta.** When an interview asks the same question at the beginning and
end, the difference between the two answers is a transformation in miniature. Flag these.

**The collection tells a story no individual source can.** The most valuable output of this
pipeline is not the analysis of any single transcript — it's the discovery of arguments,
tensions, and threads that only become visible when sources are put in dialogue with each other.

**What's missing is as valuable as what's present.** Gap analysis should produce specific,
actionable recording briefs: who to interview next, and what questions to ask them.
