"""Pass 0 NER extraction + reconciliation (Phase 1C).

Two LLM passes per source:

  Pass 0 NER extraction (per narrator segment) — capture every plausible
    entity mention. Recall over precision; reconciliation cleans up.
    Stochastic confidence: configurable runs per segment, agreement is the
    real confidence metric (William Mattingly, Yale).

  Pass 0 NER reconciliation (one call per source) — group variant forms,
    pick canonical names, attempt Wikidata QID lookup with description-hint
    verification, and extract relationships between reconciled entities.

Outputs are returned as plain dataclasses; persistence to the Weaviate
`Entities` collection is handled in `main.py` (it owns the testimony UUID
and Weaviate client) so this module stays storage-agnostic.

GLiNER is no longer used. Per the SKILL.md update, projects can configure
their own `entity_types` and `relationship_types` in
`config.json` `features.narrativePipeline`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter, OrderedDict
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .llm_client import NarrativeConfig, NarrativeLLMClient
from .prompts import (
    NER_EXTRACTION_SYSTEM,
    NER_EXTRACTION_USER_TEMPLATE,
    NER_RECONCILIATION_SYSTEM,
    NER_RECONCILIATION_USER_TEMPLATE,
)
from .segmentation import SPEAKER_ROLE_INTERVIEWER, NarrativeSegment
from .wikidata import verify as wikidata_verify

logger = logging.getLogger("nlp-processor.narrative_pipeline.entity_extraction")


PASS_NAME_EXTRACTION = "pass0_ner_extraction"
PASS_NAME_RECONCILIATION = "pass0_ner_reconciliation"

# Batch size for reconciliation. Above this many mentions per call the LLM's
# output token budget tends to truncate mid-JSON, returning either malformed
# JSON or an empty entities array. Tested OK at ~80 mentions per call against
# Gemini 2.5 Flash Lite. Cross-batch merges happen via _merge_reconciliation_batches.
RECONCILE_MAX_MENTIONS_PER_BATCH = 80


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class EntityMention:
    """One LLM-extracted mention from a single segment."""

    segment_id: str
    entity_text: str
    entity_type: str
    context_role: str
    confidence: str
    transcription_note: Optional[Dict[str, str]] = None
    # Number of stochastic runs (out of cfg.ner_runs_per_segment) that surfaced
    # this exact text+type pair within the segment. 1 means single-run.
    agreement: int = 1
    runs: int = 1

    def to_dict_for_reconciler(self) -> Dict[str, Any]:
        d = {
            "segment_id": self.segment_id,
            "entity_text": self.entity_text,
            "entity_type": self.entity_type,
            "context_role": self.context_role,
            "confidence": self.confidence,
        }
        if self.runs > 1:
            d["agreement"] = f"{self.agreement}/{self.runs}"
        if self.transcription_note:
            d["transcription_note"] = self.transcription_note
        return d


@dataclass
class ReconciledEntity:
    """One canonical entity record after reconciliation, ready for Weaviate."""

    canonical_form: str
    entity_type: str
    variants: List[str] = field(default_factory=list)
    wikidata_qid: Optional[str] = None
    wikidata_url: Optional[str] = None
    wikidata_description: Optional[str] = None
    internal_id: Optional[str] = None
    context_summary: str = ""
    transcription_notes: List[Dict[str, str]] = field(default_factory=list)
    mention_segment_ids: List[str] = field(default_factory=list)


@dataclass
class EntityRelationship:
    """One subject→object relationship grounded in a transcript quote."""

    subject_canonical: str
    relationship_type: str
    object_canonical: str
    qualifier: str = ""
    grounding_quote: str = ""
    source_segment_id: str = ""
    confidence: str = "MEDIUM"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_NORMALIZE_PATTERN = re.compile(r"[^a-z0-9]+")


def _normalize_text(value: str) -> str:
    return _NORMALIZE_PATTERN.sub("_", (value or "").strip().lower()).strip("_")


def _coerce_str(value: Any, default: str = "") -> str:
    if isinstance(value, str):
        return value.strip()
    if value is None:
        return default
    return str(value).strip() or default


def _coerce_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def make_internal_id(source_slug: str, entity_type: str, ordinal: int) -> str:
    """Stable internal authority id when no Wikidata QID is assigned."""
    safe_slug = _normalize_text(source_slug) or "source"
    safe_type = _normalize_text(entity_type) or "entity"
    return f"internal_{safe_slug}_{safe_type}_{ordinal:03d}"


def _entity_id(entity: ReconciledEntity) -> str:
    """Public entity_id property — Wikidata QID when verified, else internal id."""
    return entity.wikidata_qid or entity.internal_id or _normalize_text(entity.canonical_form)


def _entity_slug(canonical_form: str) -> str:
    """URL-friendly slug used in /entities/[slug] pages."""
    base = _normalize_text(canonical_form).replace("_", "-")
    return base or "entity"


def _entity_uuid(collection_id: str, entity_id: str) -> str:
    """Deterministic UUID5 for the Entities Weaviate row.

    Hashes (collection_id || '|' || entity_id) so re-imports are idempotent.
    Caller imports `convert_to_uuid` from `utils` separately if it prefers
    that helper; this internal version stays self-contained.
    """
    namespace = "8f8a8a40-narrative-pipeline-entities"
    raw = f"{namespace}|{collection_id}|{entity_id}".encode("utf-8")
    digest = hashlib.sha1(raw).hexdigest()
    # Build a UUID-like string (8-4-4-4-12 hex)
    return f"{digest[0:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:32]}"


# ---------------------------------------------------------------------------
# Per-segment extraction
# ---------------------------------------------------------------------------


def _format_seconds(seconds: Optional[float]) -> str:
    if seconds is None:
        return "?"
    seconds = float(seconds)
    minutes, secs = divmod(int(round(seconds)), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _parse_extraction_response(
    raw: Any,
    segment_id: str,
    runs: int,
) -> List[EntityMention]:
    if not isinstance(raw, dict):
        return []
    entities = _coerce_list(raw.get("entities"))
    out: List[EntityMention] = []
    for ent in entities:
        if not isinstance(ent, dict):
            continue
        text = _coerce_str(ent.get("entity_text"))
        etype = _coerce_str(ent.get("entity_type"))
        if not text or not etype:
            continue
        note = ent.get("transcription_note")
        if isinstance(note, dict) and note.get("likely_correct"):
            note = {
                "variant": text,
                "likely_correct": _coerce_str(note.get("likely_correct")),
                "reason": _coerce_str(note.get("reason")),
            }
        else:
            note = None
        out.append(
            EntityMention(
                segment_id=segment_id,
                entity_text=text,
                entity_type=etype.upper(),
                context_role=_coerce_str(ent.get("context_role")),
                confidence=(_coerce_str(ent.get("confidence"), "MEDIUM").upper() or "MEDIUM"),
                transcription_note=note,
                agreement=1,
                runs=runs,
            )
        )
    return out


def _merge_runs(segment_id: str, runs_outputs: List[List[EntityMention]]) -> List[EntityMention]:
    """Combine multiple runs of the same segment by (entity_text_lower, entity_type)
    key. agreement counts how many runs surfaced each pair; runs is total.
    """
    runs_total = max(1, len(runs_outputs))
    by_key: "OrderedDict[Tuple[str, str], EntityMention]" = OrderedDict()
    for run in runs_outputs:
        seen_in_this_run = set()
        for mention in run:
            key = (mention.entity_text.lower(), mention.entity_type)
            if key in seen_in_this_run:
                continue
            seen_in_this_run.add(key)
            existing = by_key.get(key)
            if existing is None:
                mention.runs = runs_total
                by_key[key] = mention
            else:
                existing.agreement += 1
                # Prefer the LONGER context_role and higher confidence
                if len(mention.context_role) > len(existing.context_role):
                    existing.context_role = mention.context_role
                conf_rank = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}
                if conf_rank.get(mention.confidence, 0) > conf_rank.get(existing.confidence, 0):
                    existing.confidence = mention.confidence
    return list(by_key.values())


def extract_mentions(
    segments: List[NarrativeSegment],
    *,
    client: NarrativeLLMClient,
    cfg: Optional[NarrativeConfig] = None,
) -> List[EntityMention]:
    """Run NER per narrator segment. Returns the flat list of mentions.

    Skips interviewer segments when configured. Stochastic confidence runs
    each segment N times and merges by (text, type) — agreement is recorded
    so the reconciler can weight noisy mentions lower.

    LLM failures yield empty mention lists for that segment (logged, not
    raised). Pipeline keeps running with a best-effort entity graph.
    """
    cfg = cfg or client.cfg
    pass_cfg = cfg.for_pass(PASS_NAME_EXTRACTION)
    entity_types_str = ", ".join(cfg.entity_types or [])
    runs_per_segment = max(1, int(cfg.ner_runs_per_segment or 1))

    if pass_cfg is not cfg:
        logger.info(
            "[entity_extraction] applying per-pass override: model=%s",
            pass_cfg.model,
        )

    all_mentions: List[EntityMention] = []
    skipped = 0
    failed = 0
    for idx, segment in enumerate(segments):
        if cfg.skip_interviewer_segments and segment.speaker_role == SPEAKER_ROLE_INTERVIEWER:
            word_count = len(segment.text.split()) if segment.text else 0
            if word_count < cfg.interviewer_min_words:
                skipped += 1
                continue

        user = NER_EXTRACTION_USER_TEMPLATE.format(
            entity_types=entity_types_str,
            segment_id=segment.segment_id,
            speaker=segment.speaker or "Unknown",
            speaker_role=segment.speaker_role,
            start_time=_format_seconds(segment.start_time),
            end_time=_format_seconds(segment.end_time),
            segment_text=segment.text,
        )

        runs_outputs: List[List[EntityMention]] = []
        for _ in range(runs_per_segment):
            try:
                raw = client.chat_json(NER_EXTRACTION_SYSTEM, user, model=pass_cfg.model)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[entity_extraction] LLM extraction failed for %s: %s",
                    segment.segment_id,
                    exc,
                )
                failed += 1
                continue
            runs_outputs.append(_parse_extraction_response(raw, segment.segment_id, runs_per_segment))

        merged = _merge_runs(segment.segment_id, runs_outputs)
        all_mentions.extend(merged)

        if (idx + 1) % 10 == 0:
            logger.info(
                "[entity_extraction] %d/%d segments processed (skipped=%d, llm_errors=%d, mentions=%d)",
                idx + 1,
                len(segments),
                skipped,
                failed,
                len(all_mentions),
            )

    logger.info(
        "[entity_extraction] extraction done: %d segments → %d raw mentions (skipped=%d, errors=%d, runs/segment=%d)",
        len(segments),
        len(all_mentions),
        skipped,
        failed,
        runs_per_segment,
    )
    return all_mentions


# ---------------------------------------------------------------------------
# Source-level reconciliation
# ---------------------------------------------------------------------------


def _parse_reconciliation_response(
    raw: Any,
    *,
    source_slug: str,
) -> Tuple[List[ReconciledEntity], List[EntityRelationship]]:
    if not isinstance(raw, dict):
        return [], []

    raw_entities = _coerce_list(raw.get("entities"))
    raw_relationships = _coerce_list(raw.get("relationships"))

    entities: List[ReconciledEntity] = []
    type_ordinals: Counter = Counter()
    canonical_lookup: Dict[str, ReconciledEntity] = {}

    for ent in raw_entities:
        if not isinstance(ent, dict):
            continue
        canonical = _coerce_str(ent.get("canonical_form"))
        etype = _coerce_str(ent.get("entity_type")).upper()
        if not canonical or not etype:
            continue
        variants = [_coerce_str(v) for v in _coerce_list(ent.get("variants")) if isinstance(v, str)]
        if canonical not in variants:
            variants = [canonical] + [v for v in variants if v and v != canonical]
        # Dedupe variants while preserving order
        seen = set()
        deduped_variants: List[str] = []
        for v in variants:
            if v and v not in seen:
                seen.add(v)
                deduped_variants.append(v)

        notes_raw = _coerce_list(ent.get("transcription_notes"))
        notes: List[Dict[str, str]] = []
        for note in notes_raw:
            if not isinstance(note, dict):
                continue
            notes.append(
                {
                    "variant": _coerce_str(note.get("variant")),
                    "likely_correct": _coerce_str(note.get("likely_correct")),
                    "reason": _coerce_str(note.get("reason")),
                }
            )

        mention_segment_ids = [
            _coerce_str(s) for s in _coerce_list(ent.get("mention_segment_ids")) if isinstance(s, str)
        ]
        # Dedupe while preserving order
        mention_segment_ids = list(OrderedDict.fromkeys(filter(None, mention_segment_ids)))

        type_ordinals[etype] += 1
        ordinal = type_ordinals[etype]

        wikidata_qid_raw = ent.get("wikidata_qid")
        wikidata_qid = _coerce_str(wikidata_qid_raw) if isinstance(wikidata_qid_raw, str) else None
        wikidata_hint = _coerce_str(ent.get("wikidata_description_hint")) or None

        wikidata_url: Optional[str] = None
        wikidata_description: Optional[str] = None
        verified_qid: Optional[str] = None
        if wikidata_qid:
            verification = wikidata_verify(wikidata_qid, wikidata_hint or ent.get("context_summary"))
            if verification is not None:
                verified_qid = verification.qid
                wikidata_url = verification.url
                wikidata_description = verification.description
            else:
                logger.info(
                    "[entity_extraction] dropped unverified QID %s for canonical_form=%r",
                    wikidata_qid,
                    canonical,
                )

        internal_id = (
            None
            if verified_qid
            else make_internal_id(source_slug, etype, ordinal)
        )

        rec = ReconciledEntity(
            canonical_form=canonical,
            entity_type=etype,
            variants=deduped_variants,
            wikidata_qid=verified_qid,
            wikidata_url=wikidata_url,
            wikidata_description=wikidata_description,
            internal_id=internal_id,
            context_summary=_coerce_str(ent.get("context_summary")),
            transcription_notes=notes,
            mention_segment_ids=mention_segment_ids,
        )
        entities.append(rec)
        canonical_lookup[canonical] = rec
        # Also key by lowercased canonical for relationship matching
        canonical_lookup.setdefault(canonical.lower(), rec)

    relationships: List[EntityRelationship] = []
    for rel in raw_relationships:
        if not isinstance(rel, dict):
            continue
        subject = _coerce_str(rel.get("subject"))
        obj = _coerce_str(rel.get("object"))
        rtype = _coerce_str(rel.get("relationship_type")).upper()
        if not subject or not obj or not rtype:
            continue
        # Only keep relationships whose endpoints we successfully reconciled
        if subject not in canonical_lookup and subject.lower() not in canonical_lookup:
            continue
        if obj not in canonical_lookup and obj.lower() not in canonical_lookup:
            continue
        relationships.append(
            EntityRelationship(
                subject_canonical=subject,
                relationship_type=rtype,
                object_canonical=obj,
                qualifier=_coerce_str(rel.get("qualifier")),
                grounding_quote=_coerce_str(rel.get("grounding_quote")),
                source_segment_id=_coerce_str(rel.get("source_segment_id")),
                confidence=(_coerce_str(rel.get("confidence"), "MEDIUM").upper() or "MEDIUM"),
            )
        )
    return entities, relationships


def _reconcile_one_batch(
    mentions: List[EntityMention],
    *,
    narrator: str,
    source_slug: str,
    client: NarrativeLLMClient,
    cfg: NarrativeConfig,
    pass_cfg: NarrativeConfig,
) -> Tuple[List[ReconciledEntity], List[EntityRelationship]]:
    """Run reconciliation on a single mention batch. Internal helper for `reconcile`."""
    payload_mentions = [m.to_dict_for_reconciler() for m in mentions]
    user = NER_RECONCILIATION_USER_TEMPLATE.format(
        entity_types=", ".join(cfg.entity_types or []),
        relationship_types=", ".join(cfg.relationship_types or []),
        narrator=narrator or "Unknown",
        mention_count=len(payload_mentions),
        mentions_json=json.dumps(payload_mentions, ensure_ascii=False, indent=2),
    )

    try:
        raw = client.chat_json(NER_RECONCILIATION_SYSTEM, user, model=pass_cfg.model)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[entity_extraction] reconciliation LLM call failed: %s", exc)
        return [], []

    entities, relationships = _parse_reconciliation_response(raw, source_slug=source_slug)

    # Warn loudly if we got mentions in but zero entities out — that's the
    # truncated-output failure mode that prompted batching in the first place.
    if mentions and not entities:
        logger.warning(
            "[entity_extraction] reconciliation returned 0 entities from %d mentions — "
            "likely output truncation. Consider lowering RECONCILE_MAX_MENTIONS_PER_BATCH.",
            len(mentions),
        )
    return entities, relationships


def _merge_reconciliation_batches(
    batches: List[Tuple[List[ReconciledEntity], List[EntityRelationship]]],
    *,
    source_slug: str,
) -> Tuple[List[ReconciledEntity], List[EntityRelationship]]:
    """Combine entities + relationships from multiple reconciliation batches.

    Two batches may produce records for the same real-world entity (e.g. one
    batch sees "Wayne Collins", another sees "W. Collins"). Merge them by
    lowercased canonical_form. Variants, mention_segment_ids, and
    transcription_notes union. wikidata_qid takes the first verified value.
    Internal IDs get reissued contiguously across the merged set so the
    output looks like a single reconciliation pass.
    """
    by_key: "OrderedDict[str, ReconciledEntity]" = OrderedDict()
    type_ordinals: Counter = Counter()

    for entities, _rels in batches:
        for ent in entities:
            key = (ent.canonical_form or "").strip().lower()
            if not key:
                continue
            existing = by_key.get(key)
            if existing is None:
                by_key[key] = ent
                continue
            # Merge into existing
            for variant in ent.variants:
                if variant and variant not in existing.variants:
                    existing.variants.append(variant)
            for sid in ent.mention_segment_ids:
                if sid and sid not in existing.mention_segment_ids:
                    existing.mention_segment_ids.append(sid)
            for note in ent.transcription_notes:
                if note not in existing.transcription_notes:
                    existing.transcription_notes.append(note)
            if not existing.wikidata_qid and ent.wikidata_qid:
                existing.wikidata_qid = ent.wikidata_qid
                existing.wikidata_url = ent.wikidata_url
                existing.wikidata_description = ent.wikidata_description
            if not existing.context_summary and ent.context_summary:
                existing.context_summary = ent.context_summary

    # Reissue internal_id contiguously across the merged set so we don't end
    # up with internal_<slug>_person_001 from two different batches.
    merged_entities: List[ReconciledEntity] = []
    for ent in by_key.values():
        if ent.wikidata_qid:
            ent.internal_id = None
        else:
            type_ordinals[ent.entity_type] += 1
            ent.internal_id = make_internal_id(source_slug, ent.entity_type, type_ordinals[ent.entity_type])
        merged_entities.append(ent)

    # Relationships: dedupe by (subject, type, object). Drop relationships that
    # reference an entity that didn't survive merging (rare but possible).
    canonical_lookup = {ent.canonical_form.lower(): ent for ent in merged_entities}
    seen_rel_keys: set = set()
    merged_relationships: List[EntityRelationship] = []
    for _ents, rels in batches:
        for rel in rels:
            subj_key = rel.subject_canonical.lower()
            obj_key = rel.object_canonical.lower()
            if subj_key not in canonical_lookup or obj_key not in canonical_lookup:
                continue
            dedup_key = (subj_key, rel.relationship_type, obj_key)
            if dedup_key in seen_rel_keys:
                continue
            seen_rel_keys.add(dedup_key)
            merged_relationships.append(rel)

    return merged_entities, merged_relationships


def reconcile(
    mentions: List[EntityMention],
    *,
    narrator: str,
    source_slug: str,
    client: NarrativeLLMClient,
    cfg: Optional[NarrativeConfig] = None,
) -> Tuple[List[ReconciledEntity], List[EntityRelationship]]:
    """Run the source-level reconciliation LLM call(s). Returns (entities, relationships).

    For sources with many mentions (>RECONCILE_MAX_MENTIONS_PER_BATCH), the
    mention list is split into batches and each batch is reconciled
    independently, then results are merged by canonical_form. This avoids
    LLM output-token truncation that silently returns 0 entities for big
    sources.

    Empty input mentions → empty outputs (no LLM call).
    LLM failure on a single batch → that batch's entities are empty; other
    batches still contribute. Ingest never raises from here.
    """
    cfg = cfg or client.cfg
    if not mentions:
        return [], []

    pass_cfg = cfg.for_pass(PASS_NAME_RECONCILIATION)

    if len(mentions) <= RECONCILE_MAX_MENTIONS_PER_BATCH:
        entities, relationships = _reconcile_one_batch(
            mentions,
            narrator=narrator,
            source_slug=source_slug,
            client=client,
            cfg=cfg,
            pass_cfg=pass_cfg,
        )
    else:
        n_batches = (len(mentions) + RECONCILE_MAX_MENTIONS_PER_BATCH - 1) // RECONCILE_MAX_MENTIONS_PER_BATCH
        logger.info(
            "[entity_extraction] %d mentions exceeds %d-batch threshold — running %d reconciliation batches",
            len(mentions),
            RECONCILE_MAX_MENTIONS_PER_BATCH,
            n_batches,
        )
        batches: List[Tuple[List[ReconciledEntity], List[EntityRelationship]]] = []
        for i in range(0, len(mentions), RECONCILE_MAX_MENTIONS_PER_BATCH):
            chunk = mentions[i : i + RECONCILE_MAX_MENTIONS_PER_BATCH]
            ents, rels = _reconcile_one_batch(
                chunk,
                narrator=narrator,
                source_slug=source_slug,
                client=client,
                cfg=cfg,
                pass_cfg=pass_cfg,
            )
            logger.info(
                "[entity_extraction]   batch %d/%d: %d mentions → %d entities, %d relationships",
                len(batches) + 1,
                n_batches,
                len(chunk),
                len(ents),
                len(rels),
            )
            batches.append((ents, rels))
        entities, relationships = _merge_reconciliation_batches(batches, source_slug=source_slug)

    # Backfill mention_segment_ids from mentions when the model didn't supply
    # them (some models omit per-entity provenance).
    if entities and any(not e.mention_segment_ids for e in entities):
        variant_to_entity: Dict[str, ReconciledEntity] = {}
        for entity in entities:
            for variant in entity.variants:
                variant_to_entity.setdefault(variant.lower(), entity)
        for mention in mentions:
            target = variant_to_entity.get(mention.entity_text.lower())
            if not target:
                continue
            if mention.segment_id and mention.segment_id not in target.mention_segment_ids:
                target.mention_segment_ids.append(mention.segment_id)

    logger.info(
        "[entity_extraction] reconciled %d mentions → %d entities (%d wikidata QIDs verified) and %d relationships",
        len(mentions),
        len(entities),
        sum(1 for e in entities if e.wikidata_qid),
        len(relationships),
    )
    return entities, relationships


# ---------------------------------------------------------------------------
# Convenience: per-segment legacy ner_data builder
# ---------------------------------------------------------------------------


def build_legacy_ner_data_per_segment(
    mentions: List[EntityMention],
    segments_by_id: Dict[str, NarrativeSegment],
) -> Dict[str, List[Dict[str, Any]]]:
    """Build the legacy `ner_data` array (text/label/start_time/end_time)
    per segment. Maintains backward compatibility with frontend NER chips
    that read from chunks.ner_data while the Entities collection is the
    canonical source going forward.
    """
    out: Dict[str, List[Dict[str, Any]]] = {}
    for mention in mentions:
        seg = segments_by_id.get(mention.segment_id)
        if seg is None:
            continue
        out.setdefault(mention.segment_id, []).append(
            {
                "text": mention.entity_text,
                "label": mention.entity_type,
                "start_time": float(seg.start_time),
                "end_time": float(seg.end_time),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Precise per-mention timestamps (entity_mentions builder)
# ---------------------------------------------------------------------------


_WORD_NORM = re.compile(r"[^a-z0-9]+")


def _normalize_word(value: str) -> str:
    return _WORD_NORM.sub("", (value or "").lower())


def _tokenize_variant(value: str) -> List[str]:
    """Split a variant into normalized tokens used for word-level matching."""
    if not value:
        return []
    return [tok for tok in (_normalize_word(part) for part in value.split()) if tok]


def build_entity_mentions_per_chunk(
    *,
    chunk_data_items: List[Dict[str, Any]],
    entities: List[ReconciledEntity],
    collection_id: str,
) -> Dict[int, List[Dict[str, Any]]]:
    """Locate every occurrence of every entity variant inside each chunk's
    word_timestamps and emit precise per-mention spans for the new
    Chunks.entity_mentions property.

    Walks variants longest-first so multi-word forms ("San Francisco") consume
    their words before single-word forms ("San") would re-match a substring.
    """
    out: Dict[int, List[Dict[str, Any]]] = {}
    if not entities or not chunk_data_items:
        return out

    # Pre-tokenize each entity's variants once.
    entity_variant_tokens: List[Tuple[ReconciledEntity, str, List[str]]] = []
    for entity in entities:
        variant_set: List[str] = []
        seen: set[str] = set()
        for variant in [entity.canonical_form, *entity.variants]:
            v = (variant or "").strip()
            if not v or v.lower() in seen:
                continue
            seen.add(v.lower())
            variant_set.append(v)
        # Longest variant first so "Karen Matsuoka" wins over "Karen".
        variant_set.sort(key=lambda s: len(s.split()), reverse=True)
        for variant in variant_set:
            tokens = _tokenize_variant(variant)
            if tokens:
                entity_variant_tokens.append((entity, variant, tokens))

    # Precompute a cheap segment_id -> mentioned entity_uuids index so we only
    # scan the entities the LLM actually flagged for each chunk.
    seg_id_to_entities: Dict[str, List[Tuple[ReconciledEntity, str, List[str]]]] = {}
    for entity, variant, tokens in entity_variant_tokens:
        for sid in entity.mention_segment_ids or []:
            seg_id_to_entities.setdefault(sid, []).append((entity, variant, tokens))

    for idx, chunk in enumerate(chunk_data_items):
        seg_id = chunk.get("narrative_segment_id") or chunk.get("segment_id") or ""
        candidates = seg_id_to_entities.get(seg_id) or []
        if not candidates:
            continue
        word_ts = chunk.get("word_timestamps") or []
        if not word_ts:
            continue

        normalized_words = [_normalize_word(w.get("text", "")) for w in word_ts]
        consumed = [False] * len(word_ts)

        # Sort candidates so longest variants run first (cross-entity).
        candidates_sorted = sorted(candidates, key=lambda c: len(c[2]), reverse=True)

        chunk_mentions: List[Dict[str, Any]] = []
        for entity, variant, tokens in candidates_sorted:
            tlen = len(tokens)
            if tlen == 0:
                continue
            i = 0
            while i <= len(normalized_words) - tlen:
                if consumed[i]:
                    i += 1
                    continue
                window_ok = True
                # Walk window, skipping over consumed slots is not safe — require
                # contiguous unconsumed words.
                for j in range(tlen):
                    if consumed[i + j] or normalized_words[i + j] != tokens[j]:
                        window_ok = False
                        break
                if window_ok:
                    start_w = word_ts[i]
                    end_w = word_ts[i + tlen - 1]
                    matched_text = " ".join(
                        (word_ts[i + k].get("text") or "") for k in range(tlen)
                    ).strip()
                    eid = _entity_id(entity)
                    chunk_mentions.append(
                        {
                            "entity_uuid": _entity_uuid(collection_id or "default", eid),
                            "canonical_form": entity.canonical_form,
                            "label": entity.entity_type,
                            "text": matched_text or variant,
                            "start_time": float(start_w.get("start", 0.0)),
                            "end_time": float(end_w.get("end", start_w.get("start", 0.0))),
                            "segment_id": seg_id,
                        }
                    )
                    for k in range(tlen):
                        consumed[i + k] = True
                    i += tlen
                else:
                    i += 1

        if chunk_mentions:
            chunk_mentions.sort(key=lambda m: m["start_time"])
            out[idx] = chunk_mentions

    return out
