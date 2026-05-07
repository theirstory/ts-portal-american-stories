"""LLM client wrapper for the narrative pipeline.

Reads configuration from /config.json (features.narrativePipeline) and the
shared API key from the AI_API_KEY env var. Calls the chosen provider via
the OpenAI-compatible REST endpoint so the same SDK works for Gemini,
OpenAI, and other compatible providers.

Phase 1 default: Gemini Flash Lite via Google's OpenAI-compatible endpoint
at https://generativelanguage.googleapis.com/v1beta/openai/.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Dict, List, Optional


logger = logging.getLogger("nlp-processor.narrative_pipeline.llm_client")


DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
DEFAULT_MODEL = "gemini-3.1-flash-lite"
DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash-lite"
DEFAULT_API_KEY_ENV = "AI_API_KEY"
ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY"
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"


# Default Pass 0 NER taxonomy. Overridable via config.json
# `features.narrativePipeline.entity_types` / `relationship_types`.
DEFAULT_ENTITY_TYPES: List[str] = [
    "PERSON",
    "PLACE",
    "EVENT",
    "DATE",
    "INSTITUTION",
    "CULTURAL_ITEM",
]
DEFAULT_RELATIONSHIP_TYPES: List[str] = [
    "FAMILY_OF",
    "REPRESENTED",
    "INTERNED_AT",
    "LIVED_IN",
    "WORKED_AT",
    "FOUGHT_FOR",
    "CREATED",
    "LED",
    "TAUGHT",
    "SAVED",
    "OPPOSED",
    "COLLABORATED_WITH",
    "INFLUENCED",
    "PRECEDED",
    "FOLLOWED",
]


# Names of the LLM-fields a per-pass override is allowed to replace. Restricting
# the list here means a typo'd field name in config.json fails loud rather than
# silently mutating something unexpected.
_OVERRIDABLE_LLM_FIELDS = frozenset({
    "provider",
    "model",
    "fallback_model",
    "base_url",
    "api_key_env",
    "request_timeout_seconds",
    "max_retries",
})


@dataclass
class NarrativeConfig:
    """Configuration for the narrative pipeline LLM client.

    Loaded from config.json under features.narrativePipeline. Top-level fields
    are the DEFAULTS used by every pass. Per-pass overrides go in
    `passes.{pass_name}` — call `cfg.for_pass(name)` to get a config with
    that pass's overrides applied.

    All fields have sensible defaults so the pipeline can run with no explicit
    configuration when the env var is set.
    """

    enabled: bool = True
    provider: str = "openai-compatible"  # openai-compatible | openai | anthropic
    model: str = DEFAULT_MODEL
    fallback_model: Optional[str] = DEFAULT_FALLBACK_MODEL
    base_url: str = DEFAULT_BASE_URL
    api_key_env: str = DEFAULT_API_KEY_ENV
    request_timeout_seconds: float = 60.0
    max_retries: int = 2

    # Per-pass overrides. Keys are pass names (e.g. "pass0_question_constellations").
    # Values are dicts whose keys are any of the LLM fields above.
    passes: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    # Pass 0 segmentation tunables
    min_segment_paragraphs: int = 1
    max_segment_paragraphs: int = 8
    min_segment_words: int = 25
    # Hard floor: segments below this many words are dropped during
    # segmentation (no chunk created at all). Catches isolated 1-2 word
    # interjections that the merge logic can't absorb because the adjacent
    # speaker differs.
    drop_segments_below_words: int = 5

    # Pass 0 question generation tunables
    question_runs_per_segment: int = 1
    questions_per_level: int = 3
    # Universal min words for question_vector population (applies to every
    # role). Segments under this threshold still get a chunk row and a
    # transcription_vector; they just skip the identity-question LLM call.
    # 0 disables.
    min_words_for_questions: int = 15
    # Legacy: also skip interviewer segments below this. Kept so existing
    # configs continue to work; min_words_for_questions catches everything
    # this catches plus short narrator turns.
    skip_interviewer_segments: bool = True
    interviewer_min_words: int = 20
    # Optional per-level prompt guidance overrides. Each value is either None
    # (use built-in default from prompts.py) or a free-form string that
    # replaces the default guidance for that level.
    question_prompt_tuning: Dict[str, Optional[str]] = field(
        default_factory=lambda: {"facts": None, "feelings": None, "identity": None}
    )

    # Pass 0 NER (used by Phase 1C). Free-form strings — the prompt template
    # uses them verbatim. Add or remove types per project.
    entity_types: List[str] = field(default_factory=lambda: list(DEFAULT_ENTITY_TYPES))
    relationship_types: List[str] = field(
        default_factory=lambda: list(DEFAULT_RELATIONSHIP_TYPES)
    )
    # Stochastic confidence: how many times to run extraction per segment;
    # disagreement between runs is the real confidence signal.
    ner_runs_per_segment: int = 2

    # Pass 1.5 conflict detection — aggressive | moderate | conservative.
    conflict_detection_sensitivity: str = "moderate"

    # Pass 2 theme labels — open = pipeline generates labels (default).
    # constrained = pipeline maps to allowed_labels (subject headings, taxonomy).
    theme_label_vocabulary: Dict[str, Any] = field(
        default_factory=lambda: {"mode": "open", "allowed_labels": []}
    )

    # Editorial publish gates. true = auto-publish new records.
    # false = draft until reviewed (default).
    published_by_default: Dict[str, bool] = field(
        default_factory=lambda: {
            "entities": False,
            "question_threads": False,
            "storylines": False,
        }
    )

    @property
    def api_key(self) -> str:
        key = os.getenv(self.api_key_env, "").strip()
        if not key:
            raise RuntimeError(
                f"[narrative_pipeline] Missing API key. Set the {self.api_key_env} "
                f"environment variable to a valid key for provider={self.provider}."
            )
        return key

    def for_pass(self, pass_name: str) -> "NarrativeConfig":
        """Return a copy with `passes[pass_name]` overrides applied to LLM fields.

        Only the LLM-related fields (provider, model, base_url, api_key_env,
        request_timeout_seconds, max_retries, fallback_model) can be overridden
        per pass. Other config (segmentation tunables, NER taxonomy, editorial
        gates, etc.) stays project-wide. Unknown keys in the overrides dict
        are ignored with a warning.

        Returns self when there are no overrides for this pass — cheap and
        safe to call from hot paths.
        """
        overrides = (self.passes or {}).get(pass_name)
        if not isinstance(overrides, dict) or not overrides:
            return self
        applied: Dict[str, Any] = {}
        for key, value in overrides.items():
            if key not in _OVERRIDABLE_LLM_FIELDS:
                logger.warning(
                    "[narrative_pipeline] Ignoring unknown override key %r for pass %s. "
                    "Allowed: %s",
                    key,
                    pass_name,
                    sorted(_OVERRIDABLE_LLM_FIELDS),
                )
                continue
            applied[key] = value
        if not applied:
            return self
        return replace(self, **applied)

    def is_published_by_default(self, resource: str) -> bool:
        """Convenience accessor for the published_by_default map."""
        return bool((self.published_by_default or {}).get(resource, False))


def load_narrative_config(config_path: Optional[str] = None) -> NarrativeConfig:
    """Load NarrativeConfig from /config.json features.narrativePipeline.

    Falls back to defaults if the file or section is missing. Uses the same
    config.json the rest of the application reads (mounted into the Docker
    image at /app/config.json or referenced via CONFIG_PATH).
    """
    if config_path is None:
        candidates = [
            os.getenv("CONFIG_PATH"),
            "/config.json",
            "../config.json",
            "config.json",
        ]
        for candidate in candidates:
            if candidate and Path(candidate).exists():
                config_path = candidate
                break

    if not config_path or not Path(config_path).exists():
        logger.warning(
            "[narrative_pipeline] config.json not found; using NarrativeConfig defaults"
        )
        return NarrativeConfig()

    try:
        data = json.loads(Path(config_path).read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning(
            "[narrative_pipeline] Failed to read %s: %s; using defaults",
            config_path,
            exc,
        )
        return NarrativeConfig()

    section = data.get("features", {}).get("narrativePipeline", {}) or {}
    cfg = NarrativeConfig()
    if isinstance(section, dict):
        for field_name, field_def in NarrativeConfig.__dataclass_fields__.items():
            if field_name in section and section[field_name] is not None:
                setattr(cfg, field_name, section[field_name])
    return cfg


_JSON_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.MULTILINE)


def _extract_json(text: str) -> Any:
    """Best-effort JSON extraction.

    Many providers respect response_format=json_object and return clean JSON,
    but some still wrap in markdown fences or include leading prose. Strip
    fences first, then try to parse; if that fails, locate the first { or [
    and parse from there.
    """
    if not isinstance(text, str):
        raise ValueError("LLM response was not a string")

    candidate = text.strip()

    fence_match = _JSON_FENCE.search(candidate)
    if fence_match:
        candidate = fence_match.group(1).strip()

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    for opener, closer in (("{", "}"), ("[", "]")):
        start = candidate.find(opener)
        end = candidate.rfind(closer)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(candidate[start : end + 1])
            except json.JSONDecodeError:
                continue

    raise ValueError(f"Could not parse JSON from LLM response. First 200 chars: {text[:200]}")


class NarrativeLLMClient:
    """Synchronous OpenAI-compatible client for narrative pipeline calls.

    Uses the official `openai` SDK so the same code path serves Gemini's
    OpenAI-compatible endpoint, OpenAI itself, and any other compatible
    provider via base_url override.

    Designed for ingest-time pipeline work, not interactive chat — calls are
    blocking and per-segment. The pipeline runs ~30-100 LLM calls per source.
    """

    def __init__(self, cfg: Optional[NarrativeConfig] = None) -> None:
        self.cfg = cfg or load_narrative_config()
        self._client = self._build_client()

    def _build_client(self):
        try:
            from openai import OpenAI  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "[narrative_pipeline] The `openai` package is required. "
                "Add `openai` to nlp-processor/requirements.txt and rebuild."
            ) from exc

        base_url = self.cfg.base_url
        api_key = self.cfg.api_key  # raises if missing

        if self.cfg.provider == "openai":
            # Default OpenAI endpoint
            return OpenAI(api_key=api_key, timeout=self.cfg.request_timeout_seconds)
        # Default treats everything else as OpenAI-compatible (Gemini, vLLM, Ollama, ...).
        return OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=self.cfg.request_timeout_seconds,
        )

    def chat_json(
        self,
        system: str,
        user: str,
        *,
        model: Optional[str] = None,
        temperature: float = 0.2,
    ) -> Any:
        """Send a chat completion expecting a JSON-shaped response.

        Tries the configured model first, falls back to fallback_model on
        404/model-not-found errors. Strips markdown fences before parsing.
        """
        primary = model or self.cfg.model
        candidates = [primary]
        if self.cfg.fallback_model and self.cfg.fallback_model != primary:
            candidates.append(self.cfg.fallback_model)

        last_error: Optional[Exception] = None
        for attempt_model in candidates:
            try:
                return self._chat_json_with_model(
                    attempt_model, system, user, temperature=temperature
                )
            except Exception as exc:  # noqa: BLE001 — provider exceptions vary
                msg = str(exc).lower()
                # Only fall back on model-not-available errors. Other failures bubble.
                if any(k in msg for k in ("not found", "model_not_found", "404", "unsupported model")):
                    logger.warning(
                        "[narrative_pipeline] Model %s rejected (%s); trying next candidate",
                        attempt_model,
                        exc,
                    )
                    last_error = exc
                    continue
                raise

        raise RuntimeError(
            f"[narrative_pipeline] All model candidates failed: {candidates}"
        ) from last_error

    def _chat_json_with_model(
        self,
        model: str,
        system: str,
        user: str,
        *,
        temperature: float,
    ) -> Any:
        last_error: Optional[Exception] = None
        for attempt in range(self.cfg.max_retries + 1):
            try:
                response = self._client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    temperature=temperature,
                    response_format={"type": "json_object"},
                )
                content = response.choices[0].message.content or ""
                return _extract_json(content)
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt >= self.cfg.max_retries:
                    raise
                logger.warning(
                    "[narrative_pipeline] %s retry %d/%d after error: %s",
                    model,
                    attempt + 1,
                    self.cfg.max_retries,
                    exc,
                )
        # Unreachable but keeps mypy happy
        raise RuntimeError("Unreachable") from last_error
