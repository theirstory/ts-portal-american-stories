"""Prompt templates for the narrative pipeline.

Templates draw from docs/story-discovery-pipeline/references/pass0-ingest.md
and are kept as plain strings so they can be tuned without code changes.

The three-level structure of question generation (facts / feelings / identity)
is universal per the SKILL.md "What is NOT configurable" list, but the
guidance text *within* each level can be tuned per project. Use
`build_question_constellation_system(facts=..., feelings=..., identity=...)`
to compose a system prompt with optional per-level overrides; pass None for
any level you want to keep at its default. The bare
`QUESTION_CONSTELLATION_SYSTEM` constant is the all-defaults composition
and remains exported for backward compatibility.
"""

from typing import Optional


DEFAULT_FACTS_GUIDANCE = (
    "What happened? Who was there? When and where? Specific enough to be "
    "useful as a search query a researcher would type."
)

DEFAULT_FEELINGS_GUIDANCE = (
    "What was the emotional experience inside the moment? Name the emotion "
    "or emotional dynamic, do not just ask \"how did you feel?\""
)

DEFAULT_IDENTITY_GUIDANCE = (
    "What meaning did the speaker make of this experience? How did it shape "
    "who they are, who others are, or how the world works? Abstract enough "
    "to connect this segment to other segments about completely different "
    "events but the same human experience. Pay special attention to Frankl "
    "moments — places where the narrator articulates the meaning that "
    "allowed them to endure, the irreducible thing that could not be taken. "
    "Not just \"what did this mean to you?\" but \"what did you hold onto "
    "that kept you going?\" These are the most powerful connective tissue "
    "across testimonies."
)


def build_question_constellation_system(
    facts: Optional[str] = None,
    feelings: Optional[str] = None,
    identity: Optional[str] = None,
) -> str:
    """Compose the question-constellation system prompt.

    Each argument is either None (use the built-in default for that level)
    or a string that replaces the default guidance for that level. The
    surrounding rules and JSON shape are not configurable.
    """
    facts_text = facts.strip() if isinstance(facts, str) and facts.strip() else DEFAULT_FACTS_GUIDANCE
    feelings_text = (
        feelings.strip() if isinstance(feelings, str) and feelings.strip() else DEFAULT_FEELINGS_GUIDANCE
    )
    identity_text = (
        identity.strip() if isinstance(identity, str) and identity.strip() else DEFAULT_IDENTITY_GUIDANCE
    )

    return f"""\
You generate "question constellations" for oral history segments.

For each segment you receive, produce the questions that segment would be the
ideal answer to, organized at three levels:

- Facts — {facts_text}

- Feelings — {feelings_text}

- Identity — {identity_text}

Rules:
- Generate exactly the number of questions per level given to you (default 3).
- Phrase questions as a searcher would, not as an interviewer would.
- Include at least one question at each level that someone from a different
  cultural or historical context might search for and find this segment
  relevant to.
- Identity questions should be the deepest — connect to universal human
  experience.
- If the segment is interviewer dialogue or scaffolding (introducing the
  conversation, asking the next question), and contains no narrator content
  to answer questions about, return empty arrays.
- Optionally, if this segment is structurally important to the source's
  overall narrative arc, generate one source_level question. Otherwise null.

Return strict JSON with the shape:
{{
  "facts": ["..."],
  "feelings": ["..."],
  "identity": ["..."],
  "source_level": "..." | null
}}
"""


# All-defaults composition. Kept for backward compatibility and as a sanity
# anchor in tests.
QUESTION_CONSTELLATION_SYSTEM = build_question_constellation_system()


QUESTION_CONSTELLATION_USER_TEMPLATE = """\
Source: {narrator}
Segment id: {segment_id}
Speaker: {speaker} ({speaker_role})
Approximate time: {start_time} - {end_time}
Segment summary: {segment_summary}

Generate {questions_per_level} questions per level.

Segment text:
\"\"\"
{segment_text}
\"\"\"
"""


SEGMENT_SUMMARY_SYSTEM = """\
You write neutral one-sentence summaries of oral history segments. The summary
should describe what the segment contains, without interpretation or judgment.
Aim for 15-30 words. Start with "Narrator describes..." or "Interviewer asks..."
when appropriate. Return strict JSON: {"summary": "..."}.
"""


SEGMENT_SUMMARY_USER_TEMPLATE = """\
Speaker: {speaker} ({speaker_role})
Segment text:
\"\"\"
{segment_text}
\"\"\"
"""


# ---------------------------------------------------------------------------
# Pass 0 NER extraction (Phase 1C) — runs once per narrator segment
# ---------------------------------------------------------------------------

NER_EXTRACTION_SYSTEM = """\
You extract named entities from oral history segments.

Goal: precision and completeness — capture every entity that a researcher,
family member, or student might want to search for. Skip pronouns
(I, me, you, he, she, it) and skip generic role mentions ("my mom", "my
neighbor") UNLESS they are clearly anchored to a specific named person
in this segment.

For each entity, return:
- entity_text: the exact text as it appears in the segment
- entity_type: one of the allowed types provided in the user message
- context_role: a brief phrase describing this entity's role in this segment
  (e.g. "narrator's grandfather", "camp where family was interned",
  "law that enabled citizenship stripping")
- confidence: HIGH | MEDIUM | LOW
- transcription_note: optional. If the entity_text looks like a transcription
  error (e.g. "Toovey Lake" likely means "Tule Lake"), provide
  {"likely_correct": "...", "reason": "..."}. Otherwise omit.

Important:
- Capture variant forms separately. If the speaker says "Tule Lake" and
  "Tooley Lake" in the same segment, return BOTH as distinct entries.
  Reconciliation happens later — your job is recall.
- For PERSON, note in context_role whether they are the narrator, the
  interviewer, or someone being described.
- For DATE, capture explicit dates AND implicit temporal anchors ("when I
  was five", "after the war"). Resolve to an approximate ISO date in
  context_role when context allows (e.g. "approx 1942 (narrator was 5)").
- Capture CULTURAL_ITEM only when the item carries cultural significance in
  context (a specific song, a tradition, a law, a court case, a film title).
  Don't capture generic nouns like "music" or "books".

Return strict JSON of the shape:
{
  "entities": [
    {"entity_text": "...", "entity_type": "PERSON", "context_role": "...", "confidence": "HIGH"}
  ]
}
"""


NER_EXTRACTION_USER_TEMPLATE = """\
Allowed entity_type values: {entity_types}

Segment id: {segment_id}
Speaker: {speaker} ({speaker_role})
Approximate time: {start_time} - {end_time}

Segment text:
\"\"\"
{segment_text}
\"\"\"
"""


# ---------------------------------------------------------------------------
# Pass 0 NER reconciliation (Phase 1C) — runs once per source after extraction
# ---------------------------------------------------------------------------

NER_RECONCILIATION_SYSTEM = """\
You deduplicate and reconcile named entity mentions extracted from one
oral history source, then extract the relationships between them.

You receive a list of entity mentions, each with: segment_id, entity_text,
entity_type, context_role, confidence. Some mentions refer to the same
real-world entity (spelling variants, transcription errors, partial names,
nicknames, "my mom" pointing to a previously-named person, etc.).

Your job:

1. Group mentions that refer to the SAME real-world entity into a single
   reconciled entity record. Pick the cleanest, most complete spelling as
   the canonical_form. Collect distinct surface forms in `variants`.

2. For each reconciled entity, attempt linked-data reconciliation against
   Wikidata when the entity is notable enough that a confident QID match is
   plausible:
   - Persons: provide wikidata_qid for the actual person if HIGHLY confident
     (e.g. famous public figures, well-known historical people).
   - Places: Wikidata QID for places notable enough to have one.
   - Events: Wikidata QID for named historical events (e.g. Pearl Harbor,
     Executive Order 9066).
   - Institutions: Wikidata QID for notable organizations / agencies.
   ONLY return a wikidata_qid when you are confident; an external verifier
   will compare Wikidata's actual description against your
   wikidata_description_hint and reject mismatches. False positives are
   worse than missing IDs.

3. For each reconciled entity, provide:
   - canonical_form: string
   - entity_type: one of the allowed types
   - variants: array of distinct surface forms found
   - wikidata_qid: string | null
   - wikidata_description_hint: string | null  (one-sentence description so
     verification can check Wikidata's response)
   - context_summary: one sentence describing this entity's role across
     the source (synthesize from all the per-mention context_roles)
   - mention_segment_ids: array of segment_ids where this entity appeared
   - transcription_notes: array of {variant, likely_correct, reason} for any
     spelling errors flagged in extraction

4. Extract relationships between reconciled entities. Use ONLY the allowed
   relationship_type values provided. For each relationship:
   - subject: canonical_form of the subject entity
   - relationship_type: one of the allowed values
   - object: canonical_form of the object entity
   - qualifier: brief context for the relationship
   - grounding_quote: a short EXACT verbatim quote from the source that
     establishes the relationship
   - source_segment_id: the segment_id where the grounding_quote appears
   - confidence: HIGH | MEDIUM | LOW
   Skip speculative relationships — only include relationships that are
   clearly evidenced in the source text.

Return strict JSON:
{
  "entities": [...],
  "relationships": [...]
}
"""


NER_RECONCILIATION_USER_TEMPLATE = """\
Allowed entity_type values: {entity_types}
Allowed relationship_type values: {relationship_types}

Source narrator: {narrator}
Total mentions to reconcile: {mention_count}

Mentions (JSON):
{mentions_json}
"""


# ---------------------------------------------------------------------------
# Pass 2 Stage 1 — cross-source thread synthesis. Runs once per cluster of
# semantically-similar Pass 0 questions drawn from ≥3 different sources.
# ---------------------------------------------------------------------------


def build_thread_synthesis_system() -> str:
    """System prompt for collapsing a cluster of similar source questions
    into one canonical thread.

    Kept as a function (rather than a constant) for symmetry with
    build_question_constellation_system — projects can later add per-project
    tuning the same way.
    """
    return THREAD_SYNTHESIS_SYSTEM


THREAD_SYNTHESIS_SYSTEM = """\
You synthesize a cross-source "question thread" from a cluster of similar
questions that multiple oral history sources independently answer.

You receive a list of questions that all sit at the same level (FACTS,
FEELINGS, or IDENTITY) and were judged semantically similar. Your job:

1. Write ONE canonical thread_question that captures what every source in the
   cluster is being asked. Phrase it the way a curious human would — natural,
   open, in second person where appropriate ("How did your family..." rather
   than "How did the narrator's family..."). Avoid jargon.

2. Write a short theme_label (1-3 words, title case) that fits on a word-cloud
   chip. Examples: "Becoming American", "Family Memory", "Belonging",
   "Loss & Adaptation". Don't repeat the question; distill the topic.

3. Judge convergence based on how the source answers are likely to relate.
   You don't see the answers themselves, only the questions — infer from the
   question wording and level:
   - AGREE: sources are likely to land in similar territory (most FACTS-level
     threads).
   - DIVERGE: sources answer the same question in genuinely different ways
     (typical of FEELINGS and IDENTITY-level threads).
   - CONTRADICT: the question implies opposing positions (rare; only when the
     wording explicitly invites disagreement).
   When unsure, pick AGREE for FACTS, DIVERGE for FEELINGS / IDENTITY.

Return strict JSON:
{
  "thread_question": "...",
  "theme_label": "...",
  "convergence": "AGREE | DIVERGE | CONTRADICT"
}
"""


THREAD_SYNTHESIS_USER_TEMPLATE = """\
Question level: {level}
Sources represented in this cluster: {source_count}
Total member questions: {member_count}

Member questions (one per source, up to 12 shown):
{questions_block}
"""

