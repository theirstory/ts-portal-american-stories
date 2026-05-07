"""Best-effort Wikidata reconciliation for Pass 0 NER.

Verifies a Wikidata QID returned by the LLM by fetching the canonical label
and description from Wikidata and comparing the description to the LLM's
hint. The goal is to catch hallucinated QIDs (LLM returned a real-looking
QID that points to the wrong entity) without blocking ingest when Wikidata
is slow or unreachable.

Policy (per PHASE_1_PLAN.md):
- 3-second timeout per lookup.
- HIGH confidence required from the LLM (caller's responsibility).
- Description match: simple token-overlap ratio between the LLM hint and
  Wikidata's actual description. Threshold is intentionally lenient — we
  catch obvious mismatches ("politician" vs "ice cream brand"), not subtle
  shading.
- On any failure (timeout, 404, parse error, mismatch) → return None.
  Caller falls back to internal_id.

This module performs a single REST call per QID. Cache is the caller's
responsibility (NarrativeLLMClient cache by canonical form within a source).
"""

from __future__ import annotations

import json
import logging
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("nlp-processor.narrative_pipeline.wikidata")


WIKIDATA_API = "https://www.wikidata.org/w/api.php"
WIKIPEDIA_BASE = "https://en.wikipedia.org/wiki/"
DEFAULT_TIMEOUT_SECONDS = 3.0
# Description match threshold: at least this fraction of meaningful tokens in
# the hint must overlap with Wikidata's description. 0.25 catches "totally
# wrong" while permitting paraphrased / abbreviated hints.
DESCRIPTION_MATCH_MIN_OVERLAP = 0.25


@dataclass
class WikidataResult:
    qid: str
    label: str
    description: str
    url: str  # Wikipedia URL when sitelink available, else Wikidata page


_QID_PATTERN = re.compile(r"^Q\d+$")
_TOKENIZE = re.compile(r"[a-zA-Z0-9]+")
_STOPWORDS = frozenset(
    {
        "a", "an", "the", "of", "in", "on", "for", "to", "and", "or", "by",
        "with", "from", "is", "was", "were", "be", "been", "are", "as", "at",
        "this", "that", "his", "her", "their", "its", "he", "she", "they",
        "person", "people", "place", "event",
    }
)


def _is_qid(value: Optional[str]) -> bool:
    return bool(value) and bool(_QID_PATTERN.match(value or ""))


def _tokens(text: Optional[str]) -> set:
    if not text:
        return set()
    return {tok.lower() for tok in _TOKENIZE.findall(text) if tok.lower() not in _STOPWORDS and len(tok) > 2}


def _description_consistent(hint: Optional[str], wikidata_description: Optional[str]) -> bool:
    """Lenient overlap check. Returns True when the LLM hint plausibly
    describes the same entity Wikidata's description does."""
    hint_tokens = _tokens(hint)
    wd_tokens = _tokens(wikidata_description)
    if not hint_tokens or not wd_tokens:
        # Without a hint we can't verify — accept; without a Wikidata
        # description we have no signal to reject — accept.
        return True
    overlap = len(hint_tokens & wd_tokens)
    ratio = overlap / max(1, min(len(hint_tokens), len(wd_tokens)))
    return ratio >= DESCRIPTION_MATCH_MIN_OVERLAP


def _label_consistent(canonical_form: Optional[str], wikidata_label: Optional[str]) -> bool:
    """Strong overlap check. The entity's canonical_form should share at
    least one substantive token with Wikidata's label. "New Orleans" must
    overlap with "New Orleans" (or "New Orleans, Louisiana") — and must NOT
    pass when paired with "University of Cambridge".

    Single-token canonical forms ("Mississippi") accept any tokenized
    sub/super-string of the Wikidata label (so "Mississippi River" still
    passes). Multi-token canonical forms require ≥1 token overlap.
    """
    canonical_tokens = _tokens(canonical_form)
    label_tokens = _tokens(wikidata_label)
    if not canonical_tokens or not label_tokens:
        # Without one or both sides, fall back to the description signal —
        # the caller still runs that check.
        return True
    return len(canonical_tokens & label_tokens) >= 1


def fetch(qid: str, *, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> Optional[WikidataResult]:
    """GET wbgetentities for one QID; return label + description + en.wiki URL.

    Returns None on any failure (network, timeout, parse error, missing data).
    Never raises.
    """
    if not _is_qid(qid):
        return None
    params = {
        "action": "wbgetentities",
        "ids": qid,
        "props": "labels|descriptions|sitelinks/urls",
        "languages": "en",
        "sitefilter": "enwiki",
        "format": "json",
        "origin": "*",
    }
    url = f"{WIKIDATA_API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ts-portal-american-stories narrative-pipeline (https://theirstory.io)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read())
    except Exception as exc:  # noqa: BLE001 — Wikidata can fail in many ways
        logger.debug("[wikidata] fetch %s failed: %s", qid, exc)
        return None

    entity = (payload.get("entities") or {}).get(qid)
    if not entity:
        return None
    label = (entity.get("labels", {}).get("en") or {}).get("value") or qid
    description = (entity.get("descriptions", {}).get("en") or {}).get("value") or ""
    enwiki = ((entity.get("sitelinks") or {}).get("enwiki") or {}).get("url")
    url = enwiki or f"https://www.wikidata.org/wiki/{qid}"
    return WikidataResult(qid=qid, label=label, description=description, url=url)


def verify(
    qid: Optional[str],
    description_hint: Optional[str],
    *,
    canonical_form: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> Optional[WikidataResult]:
    """Verify a QID. Returns the WikidataResult only if both checks pass:
    1. canonical_form tokens overlap with Wikidata's label (the entity is
       actually called this), AND
    2. the LLM hint is plausibly describing the same Wikidata entity.

    The label check is the load-bearing signal — without it, descriptions
    can incidentally share generic tokens ("united", "city") and let
    obviously-wrong QIDs through (e.g., the LLM saying New Orleans is
    Q35794 = University of Cambridge).
    """
    result = fetch(qid or "", timeout=timeout)
    if result is None:
        return None
    if not _label_consistent(canonical_form, result.label):
        logger.info(
            "[wikidata] rejecting QID %s — canonical_form %r does not overlap Wikidata label %r",
            qid,
            canonical_form,
            result.label,
        )
        return None
    if not _description_consistent(description_hint, result.description):
        logger.info(
            "[wikidata] rejecting QID %s — hint %r does not align with Wikidata description %r",
            qid,
            description_hint,
            result.description,
        )
        return None
    return result
