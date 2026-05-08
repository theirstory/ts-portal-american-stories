import json
import logging
import time
import traceback
from typing import Any, Dict, List, Optional

import numpy as np

from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import Config, NER_LABELS
from embedding_service import LocalEmbedding
from functools import lru_cache
from data_transformers import convert_api_format_to_sections
from narrative_pipeline import (
    EntityMention,
    EntityRelationship,
    NarrativeConfig,
    NarrativeLLMClient,
    NarrativeSegment,
    QuestionConstellation,
    QuestionCluster,
    QuestionItem,
    ReconciledEntity,
    SynthesizedThread,
    build_entity_mentions_per_chunk,
    build_legacy_ner_data_per_segment,
    build_thread_objects,
    cluster_questions,
    extract_mentions,
    generate_constellations,
    load_narrative_config,
    reconcile,
    segment_doc,
    synthesize_all,
)
from narrative_pipeline.pass2_threads import merge_similar_threads
from narrative_pipeline.entity_extraction import (
    _entity_id as _entity_public_id,
    _entity_slug,
    _entity_uuid,
)
from narrative_pipeline.segmentation import make_source_slug
from pipeline import TheirStoryTranscriptParser
from sentence_chunker import chunk_doc_sections
from utils import convert_to_uuid, safe_get, to_weaviate_date, words_to_text
from weaviate_client import (
    weaviate_batch_insert,
    weaviate_delete_chunks_by_story,
    weaviate_upsert_object,
)


# Print configuration on startup
Config.print_config()


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("nlp-processor.main")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)


# Configure logging to filter out health check requests
class HealthCheckFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return record.getMessage().find("/health") == -1


logging.getLogger("uvicorn.access").addFilter(HealthCheckFilter())

class ProcessRequest(BaseModel):
    """Request model for story processing endpoint."""
    payload: Dict[str, Any]
    collection: Optional[Dict[str, str]] = None
    folder: Optional[Dict[str, str]] = None


app = FastAPI(title="NLP Processor (Chunks + NER)")


@lru_cache(maxsize=1)
def get_transcript_parser() -> TheirStoryTranscriptParser:
    """Lazily initialize the transcript parser."""
    logger.info("[Pipeline] Loading TheirStory transcript parser")
    return TheirStoryTranscriptParser()


def _resolve_collection_metadata(
    payload: Dict[str, Any],
    req_collection: Optional[Dict[str, str]],
) -> Dict[str, str]:
    collection = req_collection or {}
    collection_id = (
        (collection.get("id") or "").strip()
        or str(safe_get(payload, ["story", "collection_id"], "")).strip()
        or "Collection"
    )
    collection_name = (
        (collection.get("name") or "").strip()
        or str(safe_get(payload, ["story", "collection_name"], "")).strip()
        or collection_id.replace("-", " ").replace("_", " ").title()
    )
    collection_description = (
        (collection.get("description") or "").strip()
        or str(safe_get(payload, ["story", "collection_description"], "")).strip()
        or ""
    )
    return {
        "id": collection_id,
        "name": collection_name,
        "description": collection_description,
        "uuid_prefix": collection_id.strip().lower() or "default",
    }


def _resolve_folder_metadata(
    payload: Dict[str, Any],
    req_folder: Optional[Dict[str, str]],
) -> Dict[str, str]:
    folder = req_folder or {}
    folder_id = (
        (folder.get("id") or "").strip()
        or str(safe_get(payload, ["story", "folder_id"], "")).strip()
    )
    folder_name = (
        (folder.get("name") or "").strip()
        or str(safe_get(payload, ["story", "folder_name"], "")).strip()
    )
    folder_path = (
        (folder.get("path") or "").strip()
        or str(safe_get(payload, ["story", "folder_path"], "")).strip()
    )
    return {
        "id": folder_id,
        "name": folder_name,
        "path": folder_path,
    }


def _extract_story_metadata(payload: Dict[str, Any]) -> Dict[str, Any]:
    story_id = safe_get(payload, ["story", "_id"], None) or safe_get(payload, ["transcript", "storyId"], None)
    custom_archive_media_type = safe_get(payload, ["story", "custom_archive_media_type"], None)
    return {
        "story_id": story_id,
        "record_date": safe_get(payload, ["story", "record_date"], None),
        "title": safe_get(payload, ["story", "title"], None),
        "description": safe_get(payload, ["story", "description"], None),
        "duration": float(safe_get(payload, ["story", "duration"], 0) or 0),
        "transcoded": safe_get(payload, ["story", "transcoded"], "") or "",
        "thumbnail_url": safe_get(payload, ["story", "thumbnail_url"], "") or "",
        "video_url": safe_get(payload, ["videoURL"], "") or "",
        "asset_id": safe_get(payload, ["story", "asset_id"], "") or "",
        "organization_id": safe_get(payload, ["story", "organization_id"], "") or "",
        "project_id": safe_get(payload, ["story", "project_id"], "") or "",
        "publisher": safe_get(payload, ["story", "author", "full_name"], "") or "",
        "is_audio_file": bool(
            custom_archive_media_type and str(custom_archive_media_type).startswith("audio")
        ),
    }


def _build_testimony_data(
    sections: List[Dict[str, Any]],
    testimony_uuid: str,
    story_meta: Dict[str, Any],
    collection_meta: Dict[str, str],
    folder_meta: Dict[str, str],
) -> Dict[str, Any]:
    return {
        "id": str(story_meta["story_id"]),
        "weaviate_uuid": testimony_uuid,
        "theirstory_id": testimony_uuid,
        "title": story_meta["title"] or "",
        "interview_description": story_meta["description"] or "",
        "interview_duration": story_meta["duration"],
        "transcoded": story_meta["transcoded"],
        "thumbnail_url": story_meta["thumbnail_url"],
        "video_url": story_meta["video_url"],
        "date": story_meta["record_date"] or "",
        "sections": sections,
        "asset_id": story_meta["asset_id"],
        "organization_id": story_meta["organization_id"],
        "project_id": story_meta["project_id"],
        "isAudioFile": story_meta["is_audio_file"],
        "collection_id": collection_meta["id"],
        "collection_name": collection_meta["name"],
        "collection_description": collection_meta["description"],
        "folder_id": folder_meta["id"],
        "folder_name": folder_meta["name"],
        "folder_path": folder_meta["path"],
    }


def _extract_speakers(sections: List[Dict[str, Any]]) -> List[str]:
    seen = set()
    speakers: List[str] = []
    for section in sections:
        for para in section.get("paragraphs", []):
            speaker = para.get("speaker", "")
            if speaker and speaker not in seen:
                seen.add(speaker)
                speakers.append(speaker)
    return speakers


def _classify_narrator_and_interviewers(
    sections: List[Dict[str, Any]],
    story_meta: Dict[str, Any],
) -> tuple:
    """Pick the narrator (story owner) and the set of interviewer speakers.

    Heuristic order:
      1. story.author.full_name (publisher) if it appears in the speaker list.
      2. Whoever has the highest total word count.
      3. The first speaker encountered.
    Everyone else is treated as an interviewer.
    """
    speakers = _extract_speakers(sections)
    if not speakers:
        return ("", set())

    publisher = (story_meta.get("publisher") or "").strip()
    narrator: str = ""
    if publisher and publisher in speakers:
        narrator = publisher

    if not narrator:
        word_counts: Dict[str, int] = {}
        for section in sections:
            for para in section.get("paragraphs", []):
                speaker = (para.get("speaker") or "").strip()
                if not speaker:
                    continue
                text = " ".join(
                    str(w.get("text", "") or "")
                    for w in para.get("words", [])
                    if isinstance(w, dict)
                )
                word_counts[speaker] = word_counts.get(speaker, 0) + len(text.split())
        if word_counts:
            narrator = max(word_counts, key=word_counts.get)
        else:
            narrator = speakers[0]

    interviewers = {s for s in speakers if s != narrator}
    return (narrator, interviewers)


def _build_testimony_object(
    testimony_uuid: str,
    testimony_data: Dict[str, Any],
    story_meta: Dict[str, Any],
    collection_meta: Dict[str, str],
    folder_meta: Dict[str, str],
    speakers: List[str],
) -> Dict[str, Any]:
    return {
        "class": "Testimonies",
        "id": testimony_uuid,
        "properties": {
            "interview_title": story_meta["title"] or "",
            "recording_date": story_meta["record_date"] or "",
            "interview_description": story_meta["description"] or "",
            "transcription": json.dumps(testimony_data, ensure_ascii=False),
            "transcoded": story_meta["transcoded"],
            "interview_duration": story_meta["duration"],
            "participants": speakers,
            "video_url": story_meta["video_url"],
            "publisher": story_meta["publisher"],
            "ner_labels": [],
            "ner_data": [],
            "isAudioFile": story_meta["is_audio_file"],
            "collection_id": collection_meta["id"],
            "collection_name": collection_meta["name"],
            "collection_description": collection_meta["description"],
            "folder_id": folder_meta["id"],
            "folder_name": folder_meta["name"],
            "folder_path": folder_meta["path"],
        },
    }


def _empty_ner_stats() -> Dict[str, Any]:
    """Skeleton for the NER stats dict returned to callers. Phase 1C populates
    these from the LLM extraction + reconciliation passes."""
    return {
        "segments_processed": 0,
        "segments_skipped_interviewer": 0,
        "raw_mentions": 0,
        "extraction_errors": 0,
        "reconciled_entities": 0,
        "wikidata_qids_verified": 0,
        "relationships": 0,
        "reconciliation_failed": False,
    }


def _build_chunk_objects(
    chunk_data_items: List[Dict[str, Any]],
    chunk_vectors: Any,
    testimony_uuid: str,
    story_meta: Dict[str, Any],
    collection_meta: Dict[str, str],
    folder_meta: Dict[str, str],
    question_vectors_by_idx: Optional[Dict[int, Any]] = None,
) -> List[Dict[str, Any]]:
    """Build Weaviate-shaped chunk objects.

    When `question_vectors_by_idx` is provided, the per-chunk identity
    question_vector is attached as a second named vector. Indexes correspond
    to positions in `chunk_data_items` / `chunk_vectors`.
    """
    chunks_objects: List[Dict[str, Any]] = []
    for idx, (chunk_data, chunk_vector) in enumerate(zip(chunk_data_items, chunk_vectors)):
        # Precise per-occurrence mentions (Phase 1C). When present we derive
        # ner_labels/ner_text from these and stop writing the legacy ner_data
        # array — the UI now bounds highlights to per-mention timestamps.
        entity_mentions = chunk_data.get("entity_mentions") or []
        if entity_mentions:
            ner_labels = sorted({m["label"] for m in entity_mentions if m.get("label")})
            ner_text = sorted({m["canonical_form"] for m in entity_mentions if m.get("canonical_form")})
            ner_data_legacy: List[Dict[str, Any]] = []
        else:
            chunk_entities = chunk_data.get("entities") or []
            ner_labels = list({ent["label"] for ent in chunk_entities})
            ner_text = [ent["text"] for ent in chunk_entities]
            ner_data_legacy = chunk_entities

        properties: Dict[str, Any] = {
            "theirstory_id": testimony_uuid,
            "chunk_id": int(chunk_data["chunk_id"]),
            "start_time": chunk_data["start_time"],
            "end_time": chunk_data["end_time"],
            "transcription": chunk_data["text"],
            "interview_title": story_meta["title"] or "",
            "recording_date": story_meta["record_date"] or "",
            "interview_duration": story_meta["duration"],
            "word_timestamps": chunk_data["word_timestamps"],
            "ner_data": ner_data_legacy,
            "ner_labels": ner_labels,
            "ner_text": ner_text,
            "entity_mentions": entity_mentions,
            "belongsToTestimony": [{"beacon": f"weaviate://localhost/Testimonies/{testimony_uuid}"}],
            "section_title": chunk_data["section_title"],
            "speaker": chunk_data["speaker"],
            "asset_id": story_meta["asset_id"],
            "organization_id": story_meta["organization_id"],
            "project_id": story_meta["project_id"],
            "section_id": int(chunk_data["section_id"]),
            "para_id": int(chunk_data["para_id"]),
            "transcoded": story_meta["transcoded"],
            "thumbnail_url": story_meta["thumbnail_url"],
            "date": to_weaviate_date(story_meta["record_date"]),
            "video_url": story_meta["video_url"],
            "isAudioFile": story_meta["is_audio_file"],
            "collection_id": collection_meta["id"],
            "collection_name": collection_meta["name"],
            "collection_description": collection_meta["description"],
            "folder_id": folder_meta["id"],
            "folder_name": folder_meta["name"],
            "folder_path": folder_meta["path"],
        }

        # Pass 0 narrative pipeline fields (only populated when narrative pipeline ran).
        narrative_segment_id = chunk_data.get("narrative_segment_id")
        if narrative_segment_id:
            properties["narrative_segment_id"] = narrative_segment_id
            properties["segment_summary"] = chunk_data.get("segment_summary") or ""
            properties["speaker_role"] = chunk_data.get("speaker_role") or ""
            properties["question_facts"] = chunk_data.get("question_facts") or []
            properties["question_feelings"] = chunk_data.get("question_feelings") or []
            properties["question_identity"] = chunk_data.get("question_identity") or []
            properties["question_source_level"] = chunk_data.get("question_source_level") or ""

        # Phase 1C: cross-ref to Entities mentioned in this segment.
        mentions_entity_uuids = chunk_data.get("mentions_entity_uuids") or []
        if mentions_entity_uuids:
            properties["mentionsEntities"] = [
                {"beacon": f"weaviate://localhost/Entities/{uuid}"} for uuid in mentions_entity_uuids
            ]

        vectors: Dict[str, Any] = {
            "transcription_vector": (
                chunk_vector.tolist() if hasattr(chunk_vector, "tolist") else list(chunk_vector)
            )
        }
        question_vector = (question_vectors_by_idx or {}).get(idx)
        if question_vector is not None:
            vectors["question_vector"] = (
                question_vector.tolist() if hasattr(question_vector, "tolist") else list(question_vector)
            )

        chunks_objects.append(
            {
                "class": "Chunks",
                "properties": properties,
                "vectors": vectors,
            }
        )
    return chunks_objects


def _run_pass0_pipeline(
    doc,
    sections: List[Dict[str, Any]],
    story_meta: Dict[str, Any],
    narrative_cfg: NarrativeConfig,
    *,
    collection_id: str = "",
) -> Dict[str, Any]:
    """Run the Pass 0 narrative pipeline.

    Phase 1B added: segmentation + question constellations + dual-vector embed.
    Phase 1C added: per-segment LLM NER extraction + source-level reconciliation
    (replacing GLiNER entirely) + Wikidata-verified entity records.

    Returns a dict with:
      - chunk_data_items: list of dicts, ready for _build_chunk_objects
      - segments: list of NarrativeSegment
      - constellations: list of QuestionConstellation aligned with chunk_data_items
      - identity_question_texts: concatenated identity-question strings (or None) per chunk
      - narrator, interviewers, source_slug
      - mentions: List[EntityMention] (raw per-segment NER output)
      - entities: List[ReconciledEntity]
      - relationships: List[EntityRelationship]
      - entity_uuid_lookup: canonical_form_lower -> Weaviate uuid
      - mentions_entities_uuids_by_idx: chunk_idx -> List[uuid] for cross-refs
      - ner_stats: dict of counters (replaces the old GLiNER ner_stats)
    """
    ner_stats = _empty_ner_stats()

    narrator, interviewers = _classify_narrator_and_interviewers(sections, story_meta)
    source_slug = make_source_slug(narrator, story_meta.get("story_id") or "source")
    print(f"   👤 Narrator: {narrator or '(unknown)'} | interviewers: {sorted(interviewers) or 'none'}")
    print(f"   🔗 Source slug: {source_slug}")

    segments = segment_doc(
        doc,
        source_slug=source_slug,
        interviewers=interviewers,
        min_segment_words=narrative_cfg.min_segment_words,
        max_segment_paragraphs=narrative_cfg.max_segment_paragraphs,
        drop_below_words=narrative_cfg.drop_segments_below_words,
    )
    print(
        f"   📑 Pass 0 segmentation produced {len(segments)} narrative segments "
        f"(drop floor: {narrative_cfg.drop_segments_below_words} words)"
    )
    ner_stats["segments_processed"] = len(segments)

    # ---- Pass 0 NER (Phase 1C): extraction + reconciliation -----------------
    mentions: List[EntityMention] = []
    entities: List[ReconciledEntity] = []
    relationships: List[EntityRelationship] = []
    entity_uuid_lookup: Dict[str, str] = {}
    mentions_entities_uuids_by_idx: Dict[int, List[str]] = {}

    client: Optional[NarrativeLLMClient] = None
    if narrative_cfg.enabled and segments:
        try:
            client = NarrativeLLMClient(narrative_cfg)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Narrative LLM unavailable; skipping all Pass 0 LLM passes: %s", exc)
            print(f"   ⚠️  Narrative LLM unavailable — skipping NER + question constellations: {exc}")

    if client is not None and segments:
        print(
            f"   🏷️  Pass 0 NER extraction (model={narrative_cfg.model}, runs/segment={narrative_cfg.ner_runs_per_segment}) "
            f"for {len(segments)} segments..."
        )
        t_ner = time.time()
        try:
            mentions = extract_mentions(segments, client=client, cfg=narrative_cfg)
        except Exception as exc:  # noqa: BLE001
            logger.warning("NER extraction failed at the source level; continuing without entities: %s", exc)
            print(f"   ⚠️  NER extraction failed: {exc}")
            mentions = []
            ner_stats["extraction_errors"] += 1
        ner_stats["raw_mentions"] = len(mentions)
        ner_stats["segments_skipped_interviewer"] = sum(
            1 for s in segments if s.speaker_role == "INTERVIEWER" and len(s.text.split()) < narrative_cfg.interviewer_min_words
        )
        print(
            f"   ✅ NER extraction yielded {len(mentions)} raw mentions in {time.time() - t_ner:.2f}s"
        )

        if mentions:
            print(f"   🧬 Pass 0 NER reconciliation across {len(mentions)} mentions...")
            t_rec = time.time()
            try:
                entities, relationships = reconcile(
                    mentions,
                    narrator=narrator,
                    source_slug=source_slug,
                    client=client,
                    cfg=narrative_cfg,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("NER reconciliation crashed: %s", exc)
                print(f"   ⚠️  NER reconciliation crashed: {exc}")
                entities, relationships = [], []
                ner_stats["reconciliation_failed"] = True
            ner_stats["reconciled_entities"] = len(entities)
            ner_stats["wikidata_qids_verified"] = sum(1 for e in entities if e.wikidata_qid)
            ner_stats["relationships"] = len(relationships)
            print(
                f"   ✅ Reconciled to {len(entities)} entities "
                f"({ner_stats['wikidata_qids_verified']} wikidata-verified) "
                f"and {len(relationships)} relationships in {time.time() - t_rec:.2f}s"
            )

    # Build entity_uuid_lookup keyed by lowercased canonical_form so chunk
    # cross-refs can resolve regardless of casing.
    for entity in entities:
        eid = _entity_public_id(entity)
        uuid = _entity_uuid(collection_id or "default", eid)
        entity_uuid_lookup[entity.canonical_form.lower()] = uuid
        for variant in entity.variants:
            entity_uuid_lookup.setdefault(variant.lower(), uuid)

    # Per-segment legacy ner_data for the chunks.ner_data property (UI compat)
    segments_by_id: Dict[str, NarrativeSegment] = {seg.segment_id: seg for seg in segments}
    legacy_ner_per_segment = build_legacy_ner_data_per_segment(mentions, segments_by_id)

    # Build a (chunk index -> entity uuids) map for the mentionsEntities cross-ref.
    # Walk reconciled entities (more accurate than raw mentions for which entities
    # actually live in this segment).
    seg_id_to_idx: Dict[str, int] = {seg.segment_id: i for i, seg in enumerate(segments)}
    for entity in entities:
        eid = _entity_public_id(entity)
        uuid = _entity_uuid(collection_id or "default", eid)
        for sid in entity.mention_segment_ids:
            idx = seg_id_to_idx.get(sid)
            if idx is None:
                continue
            mentions_entities_uuids_by_idx.setdefault(idx, [])
            if uuid not in mentions_entities_uuids_by_idx[idx]:
                mentions_entities_uuids_by_idx[idx].append(uuid)

    # ---- Question constellations (Phase 1B, unchanged) ---------------------
    constellations: List[QuestionConstellation] = []
    if client is not None and segments:
        try:
            print(
                f"   🧠 Generating question constellations (model={narrative_cfg.model}) "
                f"for {len(segments)} segments..."
            )
            t_q = time.time()
            constellations = generate_constellations(
                segments,
                client=client,
                narrator=narrator,
                cfg=narrative_cfg,
            )
            print(f"   ✅ Question constellations done in {time.time() - t_q:.2f}s")
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Question constellation pass failed; continuing without question_vector: %s",
                exc,
            )
            print(f"   ⚠️  Question constellation pass failed: {exc}")
            constellations = [QuestionConstellation(seg.segment_id) for seg in segments]
    if not constellations:
        constellations = [QuestionConstellation(seg.segment_id) for seg in segments]

    # ---- Build chunk_data_items --------------------------------------------
    chunk_data_items: List[Dict[str, Any]] = []
    identity_question_texts: List[Optional[str]] = []
    for idx, segment in enumerate(segments):
        item = segment.to_chunk_data(global_chunk_id=idx)
        item["entities"] = legacy_ner_per_segment.get(segment.segment_id, [])
        constellation = constellations[idx] if idx < len(constellations) else QuestionConstellation(segment.segment_id)
        item["question_facts"] = constellation.facts
        item["question_feelings"] = constellation.feelings
        item["question_identity"] = constellation.identity
        item["question_source_level"] = constellation.source_level or ""
        item["segment_summary"] = item.get("segment_summary") or ""
        item["mentions_entity_uuids"] = mentions_entities_uuids_by_idx.get(idx, [])
        chunk_data_items.append(item)

        identity_concat = constellation.identity_concat() if not constellation.is_empty else ""
        identity_question_texts.append(identity_concat or None)

    # Phase 1C: precise per-occurrence entity mentions, mapped onto each
    # chunk's word-level timestamps. Replaces the segment-spanning ner_data
    # bounds the UI used to highlight against.
    entity_mentions_by_idx = build_entity_mentions_per_chunk(
        chunk_data_items=chunk_data_items,
        entities=entities,
        collection_id=collection_id or "default",
    )
    for idx, item in enumerate(chunk_data_items):
        item["entity_mentions"] = entity_mentions_by_idx.get(idx, [])

    return {
        "chunk_data_items": chunk_data_items,
        "segments": segments,
        "constellations": constellations,
        "identity_question_texts": identity_question_texts,
        "narrator": narrator,
        "interviewers": sorted(interviewers),
        "source_slug": source_slug,
        "mentions": mentions,
        "entities": entities,
        "relationships": relationships,
        "entity_uuid_lookup": entity_uuid_lookup,
        "mentions_entities_uuids_by_idx": mentions_entities_uuids_by_idx,
        "ner_stats": ner_stats,
    }


def _build_entity_objects(
    entities: List[ReconciledEntity],
    relationships: List[EntityRelationship],
    *,
    collection_id: str,
    published_default: bool,
) -> List[Dict[str, Any]]:
    """Convert reconciled entities + relationships into Weaviate row objects.

    Relationships are stored as a nested object[] property on the source entity
    rather than as a Weaviate cross-ref, since Weaviate cross-refs can't carry
    the relationship_type qualifier we need.
    """
    relationships_by_subject: Dict[str, List[Dict[str, Any]]] = {}
    canonical_to_id: Dict[str, str] = {e.canonical_form.lower(): _entity_public_id(e) for e in entities}
    for rel in relationships:
        target_id = canonical_to_id.get(rel.object_canonical.lower(), "")
        relationships_by_subject.setdefault(rel.subject_canonical.lower(), []).append(
            {
                "target_entity_id": target_id,
                "target_canonical_form": rel.object_canonical,
                "relationship_type": rel.relationship_type,
                "qualifier": rel.qualifier,
                "grounding_quote": rel.grounding_quote,
                "source_chunk_id": rel.source_segment_id,
                "confidence": rel.confidence,
            }
        )

    objects: List[Dict[str, Any]] = []
    for entity in entities:
        eid = _entity_public_id(entity)
        uuid = _entity_uuid(collection_id or "default", eid)
        properties = {
            "entity_id": eid,
            "canonical_form": entity.canonical_form,
            "entity_slug": _entity_slug(entity.canonical_form),
            "entity_type": entity.entity_type,
            "variants": entity.variants,
            "linked_data_qid": entity.wikidata_qid,
            "linked_data_url": entity.wikidata_url,
            "linked_data_description": entity.wikidata_description,
            "internal_id": entity.internal_id,
            "context_summary": entity.context_summary,
            "transcription_notes": entity.transcription_notes,
            "relationships": relationships_by_subject.get(entity.canonical_form.lower(), []),
            "collection_id": collection_id,
            "published": bool(published_default),
        }
        objects.append({"class": "Entities", "id": uuid, "properties": properties})
    return objects


@app.post("/process-story")
async def process_story(
    req: ProcessRequest,
    write_to_weaviate: bool = Query(True),
    sentence_chunk_size: int = Query(Config.DEFAULT_SENTENCE_CHUNK_SIZE),
    overlap_sentences: int = Query(Config.DEFAULT_SENTENCE_OVERLAP),
    run_ner: bool = Query(True),
):
    """Process a story with chunking and NER, optionally writing to Weaviate.
    
    Args:
        req: Request containing story payload
        write_to_weaviate: Whether to write results to Weaviate
        sentence_chunk_size: Number of sentences per chunk
        overlap_sentences: Number of sentences to overlap between chunks
        run_ner: Whether to run NER processing
        
    Returns:
        JSON response with processed testimony and chunks
    """
    t0 = time.time()
    
    print("\n" + "="*70)
    print("📥 PROCESSING REQUEST RECEIVED")
    print("="*70)
    
    try:
        payload = req.payload

        collection_meta = _resolve_collection_metadata(payload, req.collection)
        folder_meta = _resolve_folder_metadata(payload, req.folder)
        story_meta = _extract_story_metadata(payload)
        story_id = story_meta["story_id"]
        
        print(f"📌 Story ID: {story_id}")
                    
        if not story_id:
            return JSONResponse(
                status_code=400,
                content={
                    "error": "Missing story id. Expected payload.story._id or payload.transcript.storyId"
                },
            )
        
        print(f"📝 Title: {story_meta['title'] or 'No title'}")
        print(f"📅 Date: {story_meta['record_date'] or 'No date'}")
        print(f"🗂️ Collection: {collection_meta['id']} ({collection_meta['name']})")
        if folder_meta["path"]:
            print(f"📁 Folder: {folder_meta['path']}")
        
        # Convert API format to sections
        sections = convert_api_format_to_sections(payload)
        testimony_uuid = convert_to_uuid(f"{collection_meta['uuid_prefix']}:{story_id}")
        testimony_data = _build_testimony_data(sections, testimony_uuid, story_meta, collection_meta, folder_meta)
        speakers = _extract_speakers(sections)
        
        # Parse transcript JSON into the structured spaCy document used by chunking.
        print("\n🧱 BUILDING TRANSCRIPT DOCUMENT...")
        doc = get_transcript_parser().parse_json(testimony_data)
        print(
            f"   ✅ Transcript doc ready with {len(doc._.sections)} sections "
            f"and {len(doc)} tokens"
        )

        # Create Weaviate testimony object
        testimony_obj = _build_testimony_object(
            testimony_uuid,
            testimony_data,
            story_meta,
            collection_meta,
            folder_meta,
            speakers,
        )
        narrative_cfg = load_narrative_config()
        narrative_pass0_result: Optional[Dict[str, Any]] = None
        ner_stats = _empty_ner_stats()

        # STEP 2: Chunking — narrative-segment granularity if pipeline is enabled,
        # otherwise fall back to legacy sentence-window chunking. Note that
        # legacy fallback no longer runs NER (GLiNER was removed in Phase 1C);
        # ner_data is empty in that path.
        if narrative_cfg.enabled:
            print(
                f"\n🧬 STARTING NARRATIVE PIPELINE PASS 0 "
                f"(model={narrative_cfg.model})..."
            )
            narrative_pass0_result = _run_pass0_pipeline(
                doc,
                sections,
                story_meta,
                narrative_cfg,
                collection_id=collection_meta["id"],
            )
            chunk_data_items = narrative_pass0_result["chunk_data_items"]
            ner_stats = narrative_pass0_result.get("ner_stats") or ner_stats
            print(
                f"\n📦 Pass 0 produced {len(chunk_data_items)} narrative segments "
                f"(replaces legacy sentence-window chunks)"
            )
        else:
            print(
                f"\n🔪 STARTING SENTENCE CHUNKING "
                f"(sentence_chunk_size={sentence_chunk_size}, overlap_sentences={overlap_sentences})..."
            )
            chunk_data_items = chunk_doc_sections(
                doc,
                [],  # GLiNER removed in Phase 1C; legacy path runs without NER.
                sentence_chunk_size,
                overlap_sentences,
            )
            print(f"\n📦 Sentence chunker produced {len(chunk_data_items)} chunks before embedding")

        # Collect ALL chunk texts first, then batch generate embeddings.
        all_chunk_texts = [chunk["text"] for chunk in chunk_data_items]

        question_vectors_by_idx: Dict[int, Any] = {}
        if all_chunk_texts:
            print(f"\n🧮 Generating {len(all_chunk_texts)} transcription embeddings in batch...")
            t_embed = time.time()
            try:
                chunk_vectors = LocalEmbedding.encode(all_chunk_texts, batch_size=32)
            except Exception as exc:
                logger.exception("Embedding generation failed")
                raise RuntimeError(
                    "Failed to load/generate embeddings. "
                    "Check EMBEDDING_MODEL and HuggingFace connectivity/cache. "
                    f"Current EMBEDDING_MODEL='{Config.EMBEDDING_MODEL}'."
                ) from exc
            print(f"   ✅ Transcription embeddings generated in {time.time() - t_embed:.2f}s")

            # Embed the identity-question concatenations as question_vector for chunks
            # that have a non-empty constellation.
            if narrative_pass0_result is not None:
                identity_texts: List[str] = []
                identity_indices: List[int] = []
                for idx, text in enumerate(narrative_pass0_result["identity_question_texts"]):
                    if text:
                        identity_indices.append(idx)
                        identity_texts.append(text)
                if identity_texts:
                    print(
                        f"\n🧠 Generating {len(identity_texts)} question_vector embeddings "
                        f"(of {len(all_chunk_texts)} segments)..."
                    )
                    t_qembed = time.time()
                    qvectors = LocalEmbedding.encode(identity_texts, batch_size=32)
                    print(f"   ✅ Question embeddings generated in {time.time() - t_qembed:.2f}s")
                    for idx, vec in zip(identity_indices, qvectors):
                        question_vectors_by_idx[idx] = vec

            chunks_objects = _build_chunk_objects(
                chunk_data_items,
                chunk_vectors,
                testimony_uuid,
                story_meta,
                collection_meta,
                folder_meta,
                question_vectors_by_idx=question_vectors_by_idx or None,
            )
        else:
            chunks_objects = []

        # Build entity objects for the new Entities collection (Phase 1C).
        entities: List[ReconciledEntity] = []
        relationships: List[EntityRelationship] = []
        if narrative_pass0_result is not None:
            entities = narrative_pass0_result.get("entities") or []
            relationships = narrative_pass0_result.get("relationships") or []
        entity_objects = _build_entity_objects(
            entities,
            relationships,
            collection_id=collection_meta["id"],
            published_default=narrative_cfg.is_published_by_default("entities"),
        )

        # Aggregate testimony-level entity_mentions across all chunks. The
        # story page reads this directly to highlight precise per-word spans
        # and to open the entity modal (keyed by entity_uuid).
        testimony_entity_mentions: List[Dict[str, Any]] = []
        testimony_ner_data_legacy: List[Dict[str, Any]] = []
        for chunk_obj in chunks_objects:
            chunk_props = chunk_obj.get("properties", {})
            mentions = chunk_props.get("entity_mentions") or []
            if mentions:
                for m in mentions:
                    if not (isinstance(m, dict) and m.get("canonical_form") and m.get("label")):
                        continue
                    testimony_entity_mentions.append(
                        {
                            "entity_uuid": m.get("entity_uuid", ""),
                            "canonical_form": m["canonical_form"],
                            "label": m["label"],
                            "text": m.get("text") or m["canonical_form"],
                            "start_time": float(m.get("start_time", 0.0)),
                            "end_time": float(m.get("end_time", 0.0)),
                            "segment_id": m.get("segment_id", ""),
                        }
                    )
            else:
                for ent in chunk_props.get("ner_data") or []:
                    if isinstance(ent, dict) and ent.get("text") and ent.get("label"):
                        testimony_ner_data_legacy.append(ent)

        testimony_obj["properties"]["entity_mentions"] = testimony_entity_mentions
        testimony_obj["properties"]["ner_data"] = testimony_ner_data_legacy
        if testimony_entity_mentions:
            testimony_obj["properties"]["ner_labels"] = sorted({
                m["label"] for m in testimony_entity_mentions if m.get("label")
            })
        else:
            testimony_obj["properties"]["ner_labels"] = sorted({
                ent["label"] for ent in testimony_ner_data_legacy if ent.get("label")
            })

        print(f"\n✅ CHUNKING COMPLETED: {len(chunks_objects)} total chunks, {len(entity_objects)} entities")
        print(f"\n📊 Pass 0 NER Statistics:")
        print(f"   - Segments processed: {ner_stats['segments_processed']}")
        if ner_stats.get('segments_skipped_interviewer'):
            print(f"   - Segments skipped (short interviewer turn): {ner_stats['segments_skipped_interviewer']}")
        print(f"   - Raw mentions extracted: {ner_stats['raw_mentions']}")
        print(f"   - Reconciled entities: {ner_stats['reconciled_entities']}")
        print(f"   - Wikidata QIDs verified: {ner_stats['wikidata_qids_verified']}")
        print(f"   - Relationships extracted: {ner_stats['relationships']}")
        if ner_stats.get('extraction_errors'):
            print(f"   - Extraction errors (segments): {ner_stats['extraction_errors']}")
        if ner_stats.get('reconciliation_failed'):
            print(f"   - ⚠️  Reconciliation pass crashed (entities collection got 0 records)")

        result: Dict[str, Any] = {
            "testimony": testimony_obj,
            "chunks": chunks_objects,
            "entities": entity_objects,
            "counts": {
                "chunks": len(chunks_objects),
                "entities": len(entity_objects),
                "relationships": len(relationships),
                "sections": len(doc._.sections),
            },
            "ner_stats": ner_stats,
        }

        # Write to Weaviate if requested
        if write_to_weaviate:
            print(f"\n💾 WRITING TO WEAVIATE...")
            print(f"   🗑️  Deleting previous chunks for this testimony...")
            await weaviate_delete_chunks_by_story(testimony_uuid)

            await weaviate_upsert_object("Testimonies", testimony_uuid, testimony_obj["properties"])

            # Entities first so chunks' mentionsEntities cross-refs resolve.
            if entity_objects:
                print(f"   👥 Upserting {len(entity_objects)} entities...")
                for entity_obj in entity_objects:
                    try:
                        await weaviate_upsert_object("Entities", entity_obj["id"], entity_obj["properties"])
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("Failed to upsert entity %s: %s", entity_obj["id"], exc)

            if chunks_objects:
                await weaviate_batch_insert(chunks_objects)
            else:
                print(f"   ⚠️  No chunks to insert")
        
        elapsed = time.time() - t0
        print(f"\n🎉 PROCESSING COMPLETED IN {elapsed:.2f}s")
        print("="*70 + "\n")
        
        return result
    
    except Exception as e:
        tb = traceback.format_exc()
        print(f"\n❌ PROCESSING ERROR: {repr(e)}")
        print(tb)
        print("="*70 + "\n")
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "trace": tb[:4000]},
        )

class EmbedRequest(BaseModel):
    text: str

class EmbedResponse(BaseModel):
    vector: List[float]
    dim: int


# ---------------------------------------------------------------------------
# Pass 2 — cross-source question threads
# ---------------------------------------------------------------------------


class Pass2Request(BaseModel):
    collection_id: str
    similarity_threshold: Optional[float] = None
    min_sources: Optional[int] = None
    min_members: Optional[int] = None
    max_threads_per_level: Optional[int] = None
    thread_merge_threshold: Optional[float] = None
    write_to_weaviate: bool = True


def _load_question_items_for_collection(
    collection_id: str,
) -> List[QuestionItem]:
    """Pull every NARRATOR chunk in the collection from Weaviate via REST and
    flatten its question_facts/feelings/identity into QuestionItems.

    INTERVIEWER chunks are excluded so that downstream `source_count` and the
    modal's "N recordings" both refer to narrators who *answered* the
    question, not interviewers who *asked* it. (The cluster math is the same;
    excluding interviewer-spoken question constellations from the pool is the
    cleanest way to keep source_count honest.)
    """
    import httpx

    items: List[QuestionItem] = []
    page = 0
    page_size = 500
    fields = [
        "_additional { id }",
        "theirstory_id",
        "collection_id",
        "speaker_role",
        "question_facts",
        "question_feelings",
        "question_identity",
    ]
    # Offset-based pagination. Weaviate's GraphQL `after` cursor advances over
    # the unfiltered global object order, so when combined with a `where`
    # filter it can stop early — past the first page of 200 it would return
    # zero rows even with thousands of matching chunks remaining. Offset is
    # safe up to QUERY_MAXIMUM_RESULTS (default 10k) which comfortably covers
    # this archive.
    offset = 0
    while True:
        page += 1
        query = (
            "{ Get { Chunks("
            f"limit: {page_size}, offset: {offset}, "
            "where: { path: [\"collection_id\"], operator: Equal, valueText: \""
            + collection_id
            + "\" }) { "
            + " ".join(fields)
            + " } } }"
        )
        with httpx.Client(timeout=60) as client:
            res = client.post(
                f"{Config.WEAVIATE_URL}/v1/graphql",
                json={"query": query},
            )
            res.raise_for_status()
            data = res.json()
        chunks = (data.get("data") or {}).get("Get", {}).get("Chunks") or []
        if not chunks:
            break
        for ch in chunks:
            speaker_role = (ch.get("speaker_role") or "").upper()
            if speaker_role and speaker_role != "NARRATOR":
                continue  # skip interviewer / other speakers
            chunk_uuid = (ch.get("_additional") or {}).get("id") or ""
            theirstory_id = ch.get("theirstory_id") or ""
            for level_field, level in (
                ("question_facts", "FACTS"),
                ("question_feelings", "FEELINGS"),
                ("question_identity", "IDENTITY"),
            ):
                raw_qs = ch.get(level_field) or []
                if not isinstance(raw_qs, list):
                    continue
                for q in raw_qs:
                    text = (q or "").strip() if isinstance(q, str) else ""
                    if len(text) < 6:
                        continue
                    items.append(
                        QuestionItem(
                            chunk_uuid=chunk_uuid,
                            theirstory_id=theirstory_id,
                            level=level,
                            question_text=text,
                        )
                    )
        if len(chunks) < page_size:
            break
        offset += page_size
        if page > 200:
            logger.warning("[pass2] pagination guard hit at page %d", page)
            break
    return items


async def _delete_threads_for_collection(collection_id: str) -> None:
    """Wipe existing QuestionThreads for this collection so reruns don't pile up."""
    import httpx

    body = {
        "match": {
            "class": "QuestionThreads",
            "where": {
                "path": ["collection_id"],
                "operator": "Equal",
                "valueText": collection_id,
            },
        },
        "output": "minimal",
    }
    # httpx's high-level `.delete()` doesn't carry a body — use `.request()`
    # so the JSON match block actually goes on the wire.
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.request(
            "DELETE",
            f"{Config.WEAVIATE_URL}/v1/batch/objects",
            json=body,
        )
        res.raise_for_status()
        print(f"[pass2] cleared previous threads ({res.json().get('results', {}).get('successful', 0)})")


@app.post("/run-pass2")
async def run_pass2(req: Pass2Request):
    """Cluster every Pass 0 question across the collection and synthesize
    cross-source threads.

    Returns the threads it produced (also writes them to Weaviate by default).
    """
    t0 = time.time()
    collection_id = (req.collection_id or "").strip()
    if not collection_id:
        raise HTTPException(status_code=400, detail="collection_id is required")

    print("\n" + "=" * 70)
    print(f"🧵 PASS 2: cross-source threads for collection_id={collection_id}")
    print("=" * 70)

    cfg = load_narrative_config()
    pass_cfg = cfg.for_pass("pass2_question_threads")

    # Tunables: explicit request overrides > pass override in config > defaults.
    similarity = req.similarity_threshold
    if similarity is None:
        similarity = float(getattr(pass_cfg, "similarity_threshold", 0.0) or 0.78)
    min_sources = req.min_sources or int(getattr(pass_cfg, "min_sources", 0) or 3)
    min_members = req.min_members or int(getattr(pass_cfg, "min_members", 0) or 3)
    max_per_level = req.max_threads_per_level or int(
        getattr(pass_cfg, "max_threads_per_level", 0) or 60
    )

    # 1. Load every chunk's questions.
    print("📥 Loading questions from Chunks...")
    items = _load_question_items_for_collection(collection_id)
    print(f"   {len(items)} question(s) loaded "
          f"across {len({i.theirstory_id for i in items})} sources")
    if not items:
        return {"threads": [], "counts": {"items": 0, "clusters": 0, "synthesized": 0}}

    # 2. Embed every question once.
    print("🧮 Embedding questions...")
    texts = [i.question_text for i in items]
    vectors = LocalEmbedding.encode(texts, batch_size=32)
    embeddings = np.asarray(vectors, dtype=np.float32)

    # 3. Cluster.
    print(
        f"🔗 Clustering (threshold={similarity}, "
        f"min_sources={min_sources}, min_members={min_members})..."
    )
    clusters = cluster_questions(
        items,
        embeddings,
        similarity_threshold=similarity,
        min_sources=min_sources,
        min_members=min_members,
    )
    print(f"   {len(clusters)} cluster(s) survived the source/member floor")
    by_level_counts: Dict[str, int] = {}
    for c in clusters:
        by_level_counts[c.level] = by_level_counts.get(c.level, 0) + 1
    for lvl, n in by_level_counts.items():
        print(f"     - {lvl}: {n}")

    if not clusters:
        return {
            "threads": [],
            "counts": {"items": len(items), "clusters": 0, "synthesized": 0},
        }

    # 4. Synthesize (LLM).
    print(f"🤖 Synthesizing threads (model={pass_cfg.model})...")
    llm_client = NarrativeLLMClient(cfg=cfg)
    threads = synthesize_all(
        clusters,
        client=llm_client,
        cfg=cfg,
        max_per_level=max_per_level,
    )
    print(f"   {len(threads)} thread(s) successfully synthesized")

    # 5. Embed each thread_question once. Embeddings double as: (a) the input
    # to the Stage 1.5 dedup merge, (b) the named question_vector written to
    # Weaviate for similarity search later.
    print("🧮 Embedding thread questions for named vector...")
    thread_texts = [t.thread_question for t in threads]
    thread_vectors_list = (
        LocalEmbedding.encode(thread_texts, batch_size=32) if thread_texts else []
    )
    thread_embeddings = np.asarray(thread_vectors_list, dtype=np.float32)

    # 5b. Stage 1.5 — collapse near-paraphrase threads.
    if len(threads) > 1:
        merge_threshold = (
            req.thread_merge_threshold
            if req.thread_merge_threshold is not None
            else float(getattr(pass_cfg, "thread_merge_threshold", 0.0) or 0.86)
        )
        before_count = len(threads)
        threads, merged_vector_lists = merge_similar_threads(
            threads, thread_embeddings, threshold=merge_threshold
        )
        print(
            f"   🔁 Stage 1.5 merge: {before_count} → {len(threads)} threads "
            f"(threshold={merge_threshold:.2f})"
        )
        # Refresh source_count on cluster.members union (cluster.source_count
        # is computed dynamically from members so already fresh).
        thread_embeddings = (
            np.asarray(merged_vector_lists, dtype=np.float32)
            if merged_vector_lists
            else thread_embeddings[: len(threads)]
        )

    from narrative_pipeline.pass2_threads import thread_uuid as _thread_uuid

    vectors_by_uuid: Dict[str, List[float]] = {}
    for thread, row in zip(threads, thread_embeddings):
        uuid = _thread_uuid(collection_id, thread.cluster.level, thread.thread_question)
        vectors_by_uuid[uuid] = [float(x) for x in row]

    objects = build_thread_objects(
        threads,
        collection_id=collection_id,
        published_default=cfg.is_published_by_default("threads"),
        question_vectors=vectors_by_uuid,
    )

    # 6. Write to Weaviate (optional).
    if req.write_to_weaviate:
        print(f"💾 Replacing threads for collection {collection_id}...")
        try:
            await _delete_threads_for_collection(collection_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[pass2] delete previous threads failed: %s", exc)
        for obj in objects:
            cross_ref_uuids = obj.pop("answeredByChunks", [])
            properties = obj["properties"]
            if cross_ref_uuids:
                properties["answeredByChunks"] = [
                    {"beacon": f"weaviate://localhost/Chunks/{u}"} for u in cross_ref_uuids
                ]
            # weaviate_upsert_object handles vectors via the standard payload
            # if we attach them directly to the body — but the helper only
            # forwards properties. Use batch insert which carries vectors.
        # Attach vectors as a top-level field for the batch insert path.
        batch_objs: List[Dict[str, Any]] = []
        for thread, obj in zip(threads, objects):
            uuid = _thread_uuid(collection_id, thread.cluster.level, thread.thread_question)
            entry: Dict[str, Any] = {
                "class": "QuestionThreads",
                "id": uuid,
                "properties": obj["properties"],
            }
            if uuid in vectors_by_uuid:
                entry["vectors"] = {"question_vector": vectors_by_uuid[uuid]}
            batch_objs.append(entry)
        if batch_objs:
            await weaviate_batch_insert(batch_objs)

    elapsed = time.time() - t0
    print(f"\n🎉 PASS 2 COMPLETE in {elapsed:.2f}s — {len(threads)} threads")
    print("=" * 70 + "\n")

    return {
        "threads": [
            {
                "level": t.cluster.level,
                "source_count": t.cluster.source_count,
                "thread_question": t.thread_question,
                "theme_label": t.theme_label,
                "convergence": t.convergence,
                "chunk_uuids": t.cluster.chunk_uuids,
            }
            for t in threads
        ],
        "counts": {
            "items": len(items),
            "clusters": len(clusters),
            "synthesized": len(threads),
        },
    }


@lru_cache(maxsize=2048)
def _embed_cached(text: str) -> List[float]:
    vec = LocalEmbedding.encode_single(text)
    return [float(x) for x in vec]

@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    try:
        vec = _embed_cached(text)
    except Exception as exc:
        logger.exception("Embed endpoint failed while loading/generating embedding")
        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to load/generate embeddings. Check EMBEDDING_MODEL and "
                "HuggingFace cache/connectivity. "
                f"Current EMBEDDING_MODEL='{Config.EMBEDDING_MODEL}'."
            ),
        ) from exc

    if not vec:
        raise HTTPException(status_code=500, detail="embedding returned empty vector")

    return {"vector": vec, "dim": len(vec)}

@app.get("/health")
async def health():
    """Health check endpoint.
    
    Returns:
        JSON with service status and configuration
    """
    narrative_cfg = load_narrative_config()
    return {
        "ok": True,
        "weaviate_url": Config.WEAVIATE_URL,
        "embedding_model": Config.EMBEDDING_MODEL,
        "embedding_loaded": LocalEmbedding.is_loaded(),
        "embedding_dimension": (
            LocalEmbedding.get_embedding_dimension() if LocalEmbedding.is_loaded() else None
        ),
        "use_gpu": Config.USE_GPU,
        "narrative_pipeline": {
            "enabled": narrative_cfg.enabled,
            "provider": narrative_cfg.provider,
            "model": narrative_cfg.model,
            "fallback_model": narrative_cfg.fallback_model,
            "entity_types": narrative_cfg.entity_types,
            "relationship_types_count": len(narrative_cfg.relationship_types),
            "ner_runs_per_segment": narrative_cfg.ner_runs_per_segment,
            "published_by_default": narrative_cfg.published_by_default,
        },
    }
