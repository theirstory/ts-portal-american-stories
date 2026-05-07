"""Narrative intelligence pipeline (Pass 0+).

Pass 0 modules:
- llm_client: OpenAI-compatible LLM wrapper (Gemini/OpenAI/etc.)
- segmentation: refine TheirStory paragraphs into narrative segments
- question_constellations: per-segment facts/feelings/identity questions
- entity_extraction: per-segment NER + source-level reconciliation
- wikidata: best-effort linked-data verifier

Phase 1 scope. Pass 1+ modules will be added in subsequent phases.
"""

from .entity_extraction import (
    EntityMention,
    EntityRelationship,
    ReconciledEntity,
    build_entity_mentions_per_chunk,
    build_legacy_ner_data_per_segment,
    extract_mentions,
    reconcile,
)
from .llm_client import NarrativeConfig, NarrativeLLMClient, load_narrative_config
from .pass2_threads import (
    QuestionCluster,
    QuestionItem,
    SynthesizedThread,
    build_thread_objects,
    cluster_questions,
    synthesize_all,
    synthesize_thread,
)
from .question_constellations import (
    QuestionConstellation,
    generate_constellation,
    generate_constellations,
)
from .segmentation import NarrativeSegment, segment_doc

__all__ = [
    "EntityMention",
    "EntityRelationship",
    "NarrativeConfig",
    "NarrativeLLMClient",
    "NarrativeSegment",
    "QuestionConstellation",
    "QuestionCluster",
    "QuestionItem",
    "ReconciledEntity",
    "SynthesizedThread",
    "build_entity_mentions_per_chunk",
    "build_legacy_ner_data_per_segment",
    "build_thread_objects",
    "cluster_questions",
    "extract_mentions",
    "generate_constellation",
    "generate_constellations",
    "load_narrative_config",
    "reconcile",
    "segment_doc",
    "synthesize_all",
    "synthesize_thread",
]
