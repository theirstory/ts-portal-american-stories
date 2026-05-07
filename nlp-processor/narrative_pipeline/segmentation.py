"""Pass 0 narrative segmentation.

Phase 1 MVP strategy:
- TheirStory's transcript already provides speaker-diarized paragraphs and
  auto-generated chapter indexes. We use the paragraph boundaries (= speaker
  turns) as the primary segment boundary signal, since speaker change is the
  strongest segment marker per the SKILL spec.
- Each paragraph becomes one narrative segment. We do NOT yet split paragraphs
  on intra-paragraph topic / temporal / emotional shifts. That refinement is a
  later enhancement once dual-vector search is proven.
- Very short adjacent same-speaker paragraphs are merged so we don't generate
  question constellations for one-word fillers ("Yeah." "Right.").
- Stable IDs of the form `{source_slug}__seg_{NNN}` follow the spec.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from spacy.tokens import Span

from utils import normalize_text

logger = logging.getLogger("nlp-processor.narrative_pipeline.segmentation")


SPEAKER_ROLE_NARRATOR = "NARRATOR"
SPEAKER_ROLE_INTERVIEWER = "INTERVIEWER"
SPEAKER_ROLE_OTHER = "OTHER"


@dataclass
class NarrativeSegment:
    """One Pass 0 narrative segment, ready to be embedded and persisted."""

    segment_id: str
    section_idx: int
    para_idxs: List[int]
    section_title: str
    speaker: str
    speaker_role: str
    start_time: float
    end_time: float
    text: str
    word_timestamps: List[Dict[str, Any]]

    def to_chunk_data(self, global_chunk_id: int) -> Dict[str, Any]:
        """Shape this segment into the dict expected by _build_chunk_objects."""
        return {
            "chunk_id": global_chunk_id,
            "section_id": self.section_idx,
            # Use the first paragraph's index to keep the column meaningful.
            # Multi-paragraph segments still group cleanly because we have
            # narrative_segment_id as the canonical identifier.
            "para_id": self.para_idxs[0] if self.para_idxs else 0,
            "section_title": self.section_title,
            "speaker": self.speaker,
            "speaker_role": self.speaker_role,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "text": self.text,
            "word_timestamps": self.word_timestamps,
            "narrative_segment_id": self.segment_id,
            # Entities and segment_summary populated downstream by Pass 0/1
            "entities": [],
            "segment_summary": "",
            "question_facts": [],
            "question_feelings": [],
            "question_identity": [],
            "question_source_level": "",
        }


_SLUG_PATTERN = re.compile(r"[^a-z0-9]+")


def make_source_slug(narrator: str, story_id: str) -> str:
    """Stable, human-readable source slug used as the prefix for segment ids.

    Falls back to the story_id if the narrator name is missing.
    """
    base = (narrator or story_id or "source").strip().lower()
    base = _SLUG_PATTERN.sub("_", base).strip("_")
    if not base:
        base = "source"
    return base


def _classify_speaker_role(speaker: Optional[str], interviewers: Set[str]) -> str:
    if not speaker:
        return SPEAKER_ROLE_OTHER
    if speaker.strip() in interviewers:
        return SPEAKER_ROLE_INTERVIEWER
    return SPEAKER_ROLE_NARRATOR


def _paragraph_word_timestamps(paragraph: Span) -> List[Dict[str, Any]]:
    return [
        {
            "text": token.text,
            "start": float(token._.start_time),
            "end": float(token._.end_time),
        }
        for token in paragraph
        if token._.start_time is not None and token._.end_time is not None
    ]


def _word_count(text: str) -> int:
    return len(text.split()) if text else 0


def segment_doc(
    doc,
    source_slug: str,
    interviewers: Optional[Iterable[str]] = None,
    *,
    min_segment_words: int = 25,
    max_segment_paragraphs: int = 8,
    drop_below_words: int = 5,
) -> List[NarrativeSegment]:
    """Walk a parsed transcript doc and produce narrative segments.

    Args:
      doc: spaCy Doc with sections/paragraphs, as built by
        TheirStoryTranscriptParser.parse_json.
      source_slug: stable prefix for segment ids
        (e.g. "george_takei" -> "george_takei__seg_014").
      interviewers: speaker names to mark as INTERVIEWER. Anything else
        (and unknown) is NARRATOR. Empty/None marks all as NARRATOR.
      min_segment_words: paragraphs with fewer words than this get merged
        into the previous same-speaker segment. Avoids generating question
        constellations for "Yeah." filler.
      max_segment_paragraphs: cap on how many paragraphs can be merged into
        one segment. Stops runaway merging when a speaker holds the floor.
      drop_below_words: hard floor on segment word count. Segments still
        below this AFTER merging are dropped entirely (no chunk, no embed,
        no question generation). This catches isolated 1-2 word
        interjections that the merge logic can't absorb because the
        adjacent speaker differs. The remaining segments get fresh
        contiguous segment_ids.

    Returns:
      List of NarrativeSegment in transcript order with stable ids assigned.
    """
    interviewer_set: Set[str] = set(s.strip() for s in (interviewers or []) if s)

    segments: List[NarrativeSegment] = []
    seg_counter = 0

    for section_idx, section in enumerate(doc._.sections):
        section_title = section._.title or f"Section {section_idx + 1}"

        for para_idx, paragraph in enumerate(section._.paragraphs):
            para_text = normalize_text(paragraph.text)
            if not para_text:
                continue

            speaker = (paragraph._.speaker or "").strip() or "Unknown"
            speaker_role = _classify_speaker_role(speaker, interviewer_set)

            # Pull word timestamps; if the paragraph has no aligned tokens we
            # skip it (no usable temporal anchor).
            word_timestamps = _paragraph_word_timestamps(paragraph)
            if not word_timestamps:
                continue

            start_time = word_timestamps[0]["start"]
            end_time = word_timestamps[-1]["end"]

            # Merge into the previous segment when the previous segment is the
            # same speaker AND either this paragraph is short, OR we are in
            # the middle of a sustained turn that hasn't yet exceeded
            # max_segment_paragraphs.
            should_merge = (
                segments
                and segments[-1].speaker == speaker
                and segments[-1].section_idx == section_idx
                and len(segments[-1].para_idxs) < max_segment_paragraphs
                and (
                    _word_count(para_text) < min_segment_words
                    or _word_count(segments[-1].text) < min_segment_words
                )
            )

            if should_merge:
                last = segments[-1]
                last.para_idxs.append(para_idx)
                last.end_time = end_time
                last.text = f"{last.text}\n\n{para_text}"
                last.word_timestamps.extend(word_timestamps)
                continue

            segment_id = f"{source_slug}__seg_{seg_counter:03d}"
            segments.append(
                NarrativeSegment(
                    segment_id=segment_id,
                    section_idx=section_idx,
                    para_idxs=[para_idx],
                    section_title=section_title,
                    speaker=speaker,
                    speaker_role=speaker_role,
                    start_time=float(start_time),
                    end_time=float(end_time),
                    text=para_text,
                    word_timestamps=word_timestamps,
                )
            )
            seg_counter += 1

    pre_drop = len(segments)
    if drop_below_words > 0:
        segments = [s for s in segments if _word_count(s.text) >= drop_below_words]
        # Reassign contiguous segment_ids so downstream code never sees gaps.
        for new_idx, seg in enumerate(segments):
            seg.segment_id = f"{source_slug}__seg_{new_idx:03d}"

    dropped = pre_drop - len(segments)
    logger.info(
        "[segmentation] source_slug=%s produced %d narrative segments (dropped %d below %d-word floor)",
        source_slug,
        len(segments),
        dropped,
        drop_below_words,
    )
    return segments
