"""Pass 0 question constellation generation.

For each NarrativeSegment, ask the configured LLM to reverse-engineer the
questions that segment would be the ideal answer to, structured at three
levels (facts / feelings / identity) per the Difficult Conversations and
Holocaust Museum frameworks.

The identity-level questions (concatenated) are what gets embedded as the
question_vector named vector on the Chunks Weaviate row, so dual-vector
search can match either what was said or what question is answered.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .llm_client import NarrativeConfig, NarrativeLLMClient
from .prompts import (
    QUESTION_CONSTELLATION_USER_TEMPLATE,
    build_question_constellation_system,
)
from .segmentation import (
    SPEAKER_ROLE_INTERVIEWER,
    NarrativeSegment,
)


PASS_NAME = "pass0_question_constellations"

logger = logging.getLogger("nlp-processor.narrative_pipeline.question_constellations")


@dataclass
class QuestionConstellation:
    """The Pass 0 question output for one segment."""

    segment_id: str
    facts: List[str] = field(default_factory=list)
    feelings: List[str] = field(default_factory=list)
    identity: List[str] = field(default_factory=list)
    source_level: Optional[str] = None
    skipped_reason: Optional[str] = None

    @property
    def is_empty(self) -> bool:
        return not (self.facts or self.feelings or self.identity)

    def identity_concat(self) -> str:
        """Return the identity questions joined for embedding as question_vector."""
        return " ".join(q.strip() for q in self.identity if q and q.strip())


def _format_seconds(seconds: Optional[float]) -> str:
    if seconds is None:
        return "?"
    seconds = float(seconds)
    minutes, secs = divmod(int(round(seconds)), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _coerce_str_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if isinstance(item, str) and item.strip()]


def _coerce_optional_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return None


def _should_skip_segment(
    segment: NarrativeSegment,
    cfg: NarrativeConfig,
) -> Optional[str]:
    """Return a non-None reason string when we should skip the LLM call.

    Order:
      1. Empty text → skip.
      2. Universal min_words_for_questions floor — applies to ALL roles. The
         segment still becomes a chunk and gets transcription_vector + ner_data;
         it just doesn't get question_vector / facts/feelings/identity. This
         catches short narrator interjections AND short interviewer follow-ups.
      3. Legacy interviewer_min_words check — kept for backward-compat with
         the older config. Same effect, only applies to interviewer turns.
    """
    if not segment.text or not segment.text.strip():
        return "empty_text"

    word_count = len(segment.text.split())

    min_words = getattr(cfg, "min_words_for_questions", 0) or 0
    if min_words > 0 and word_count < min_words:
        return "below_min_words"

    if cfg.skip_interviewer_segments and segment.speaker_role == SPEAKER_ROLE_INTERVIEWER:
        if word_count < cfg.interviewer_min_words:
            return "interviewer_short_turn"
    return None


def _resolve_pass_config(cfg: NarrativeConfig) -> NarrativeConfig:
    """Resolve the per-pass overrides for question constellations once."""
    return cfg.for_pass(PASS_NAME)


def _resolve_system_prompt(cfg: NarrativeConfig) -> str:
    """Build the system prompt with project-specific per-level guidance, if any."""
    tuning = cfg.question_prompt_tuning or {}
    return build_question_constellation_system(
        facts=tuning.get("facts"),
        feelings=tuning.get("feelings"),
        identity=tuning.get("identity"),
    )


def generate_constellation(
    segment: NarrativeSegment,
    *,
    client: NarrativeLLMClient,
    narrator: str,
    cfg: Optional[NarrativeConfig] = None,
    system_prompt: Optional[str] = None,
    pass_cfg: Optional[NarrativeConfig] = None,
) -> QuestionConstellation:
    """Generate one segment's question constellation. Never raises on LLM
    failure — returns an empty constellation with skipped_reason populated.

    `system_prompt` and `pass_cfg` can be precomputed by the caller and reused
    across many segments (they don't vary per segment). When omitted they are
    derived from `cfg`.
    """
    cfg = cfg or client.cfg
    pass_cfg = pass_cfg or _resolve_pass_config(cfg)
    if system_prompt is None:
        system_prompt = _resolve_system_prompt(cfg)

    skip_reason = _should_skip_segment(segment, cfg)
    if skip_reason:
        return QuestionConstellation(segment_id=segment.segment_id, skipped_reason=skip_reason)

    user = QUESTION_CONSTELLATION_USER_TEMPLATE.format(
        narrator=narrator or "Unknown",
        segment_id=segment.segment_id,
        speaker=segment.speaker or "Unknown",
        speaker_role=segment.speaker_role,
        start_time=_format_seconds(segment.start_time),
        end_time=_format_seconds(segment.end_time),
        segment_summary=(segment.text[:140] + "...") if len(segment.text) > 140 else segment.text,
        segment_text=segment.text,
        questions_per_level=cfg.questions_per_level,
    )

    try:
        # Per-pass model override is honored via pass_cfg.model (falls back to
        # client.cfg.model when no override exists in features.narrativePipeline.passes).
        raw = client.chat_json(system_prompt, user, model=pass_cfg.model)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "[question_constellations] LLM failed for %s: %s",
            segment.segment_id,
            exc,
        )
        return QuestionConstellation(
            segment_id=segment.segment_id,
            skipped_reason=f"llm_error:{type(exc).__name__}",
        )

    if not isinstance(raw, dict):
        return QuestionConstellation(
            segment_id=segment.segment_id,
            skipped_reason="non_dict_response",
        )

    return QuestionConstellation(
        segment_id=segment.segment_id,
        facts=_coerce_str_list(raw.get("facts")),
        feelings=_coerce_str_list(raw.get("feelings")),
        identity=_coerce_str_list(raw.get("identity")),
        source_level=_coerce_optional_str(raw.get("source_level")),
    )


def generate_constellations(
    segments: List[NarrativeSegment],
    *,
    client: NarrativeLLMClient,
    narrator: str,
    cfg: Optional[NarrativeConfig] = None,
) -> List[QuestionConstellation]:
    """Generate constellations for an entire source. One LLM call per segment.

    Returned in segment order. Failures yield empty constellations rather than
    aborting — the caller can still persist transcription_vector even when
    question_vector is missing.

    Resolves per-pass config and system prompt once, reuses across all segments.
    """
    cfg = cfg or client.cfg
    pass_cfg = _resolve_pass_config(cfg)
    system_prompt = _resolve_system_prompt(cfg)
    if pass_cfg is not cfg:
        logger.info(
            "[question_constellations] applying per-pass override: model=%s",
            pass_cfg.model,
        )
    out: List[QuestionConstellation] = []
    skipped = 0
    failed = 0
    for idx, segment in enumerate(segments):
        constellation = generate_constellation(
            segment,
            client=client,
            narrator=narrator,
            cfg=cfg,
            system_prompt=system_prompt,
            pass_cfg=pass_cfg,
        )
        out.append(constellation)
        if constellation.skipped_reason:
            if constellation.skipped_reason.startswith("llm_error"):
                failed += 1
            else:
                skipped += 1
        if (idx + 1) % 10 == 0:
            logger.info(
                "[question_constellations] %d/%d processed (skipped=%d, llm_errors=%d)",
                idx + 1,
                len(segments),
                skipped,
                failed,
            )

    logger.info(
        "[question_constellations] done: %d total, %d generated, %d skipped, %d llm_errors",
        len(segments),
        sum(1 for c in out if not c.is_empty),
        skipped,
        failed,
    )
    return out
