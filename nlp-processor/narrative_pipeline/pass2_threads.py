"""Pass 2 Stage 1 — cross-source question clustering.

Reads every chunk's question_facts/feelings/identity from Weaviate, clusters
the questions by semantic similarity inside each level, and emits clusters
that ≥3 distinct sources answer. Stage 2 (multi-frame) and Stage 3
(transformation/meta-threads) are not implemented yet — Stage 1 is what powers
the homepage word cloud.
"""

from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from .llm_client import NarrativeConfig, NarrativeLLMClient
from .prompts import build_thread_synthesis_system, THREAD_SYNTHESIS_USER_TEMPLATE

logger = logging.getLogger(__name__)


PASS_NAME = "pass2_question_threads"

# Levels we cluster on. FACTS / FEELINGS / IDENTITY are independent question
# spaces — a cluster never crosses levels.
QUESTION_LEVELS = ("FACTS", "FEELINGS", "IDENTITY")

# Defaults; overridable via NarrativeConfig.passes[PASS_NAME].
DEFAULT_SIMILARITY_THRESHOLD = 0.78
DEFAULT_MIN_SOURCES = 3
DEFAULT_MIN_MEMBERS_PER_CLUSTER = 3
DEFAULT_MAX_THREADS_PER_LEVEL = 60
# After synthesis, two synthesized threads whose canonical question_vector
# cosine-similarity exceeds this are collapsed into one (Stage 1.5 dedup).
# We deliberately set this higher than the cluster-time threshold — Stage 1
# already groups synonyms; this only catches cases where two clusters
# produce questions that read as paraphrases.
DEFAULT_THREAD_MERGE_THRESHOLD = 0.86


@dataclass
class QuestionItem:
    """One question pulled from a chunk, ready for clustering."""

    chunk_uuid: str
    theirstory_id: str
    level: str  # FACTS | FEELINGS | IDENTITY
    question_text: str


@dataclass
class QuestionCluster:
    """A group of questions across sources that the model judged similar."""

    level: str
    members: List[QuestionItem] = field(default_factory=list)

    @property
    def source_count(self) -> int:
        return len({m.theirstory_id for m in self.members})

    @property
    def chunk_uuids(self) -> List[str]:
        # Stable, de-duplicated.
        seen: List[str] = []
        seen_set: set[str] = set()
        for m in self.members:
            if m.chunk_uuid not in seen_set:
                seen.append(m.chunk_uuid)
                seen_set.add(m.chunk_uuid)
        return seen

    def representative_questions(self, limit: int = 10) -> List[str]:
        """One question per source, up to `limit` — feeds the synthesis prompt."""
        out: List[str] = []
        seen_sources: set[str] = set()
        for m in self.members:
            if m.theirstory_id in seen_sources:
                continue
            seen_sources.add(m.theirstory_id)
            out.append(m.question_text)
            if len(out) >= limit:
                break
        return out


@dataclass
class SynthesizedThread:
    """LLM output for one cluster — written to QuestionThreads."""

    cluster: QuestionCluster
    thread_question: str
    theme_label: str
    convergence: str  # AGREE | DIVERGE | CONTRADICT


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------


def _normalize(vectors: np.ndarray) -> np.ndarray:
    """L2-normalize rows so cosine == dot product."""
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    return vectors / norms


def cluster_questions(
    items: List[QuestionItem],
    embeddings: np.ndarray,
    *,
    similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
    min_sources: int = DEFAULT_MIN_SOURCES,
    min_members: int = DEFAULT_MIN_MEMBERS_PER_CLUSTER,
) -> List[QuestionCluster]:
    """Greedy single-link clustering inside each level.

    For each unassigned item, take all unassigned items whose cosine similarity
    is above the threshold; merge them into one cluster. Repeat. Drop clusters
    that don't hit the source/member floor.
    """
    if len(items) == 0:
        return []
    if embeddings.shape[0] != len(items):
        raise ValueError(
            f"embeddings/items length mismatch: {embeddings.shape[0]} vs {len(items)}"
        )

    # Bucket by level so cosine matrices stay manageable.
    by_level: Dict[str, List[int]] = {}
    for idx, item in enumerate(items):
        by_level.setdefault(item.level, []).append(idx)

    clusters: List[QuestionCluster] = []
    norm = _normalize(embeddings)

    for level, indices in by_level.items():
        if not indices:
            continue
        sub = norm[indices]
        sim = sub @ sub.T  # (N, N) cosine matrix
        np.fill_diagonal(sim, -1.0)

        unassigned: set[int] = set(range(len(indices)))
        # Seeds we've already tried that produced an undersized cluster. We
        # remember them so the loop terminates, but their would-be members
        # stay in `unassigned` so they can join a different (accepted) cluster
        # whose seed has more high-sim neighbors. Without this, a chunk that
        # is similar to a popular cluster but happens to be picked as a seed
        # before that cluster forms gets pulled into a 1-2 member group, the
        # group is dropped for failing min_sources, and the chunk is lost.
        tried_seeds: set[int] = set()
        while True:
            available = unassigned - tried_seeds
            if not available:
                break
            # Prefer seeds with the most above-threshold neighbors so the
            # broadest cluster forms first. Falls back to insertion order on
            # ties for determinism. Iterating the full `available` set is
            # O(N²) per pass but N is bounded per level (a few hundred at
            # most for this archive).
            seed_local = max(
                available,
                key=lambda i: int((sim[i] >= similarity_threshold).sum()),
            )
            # Transitive single-link expansion: keep absorbing items that are
            # similar to ANY current member, not just to the seed. A chunk
            # with sim 0.84 to member B but only 0.7 to seed A still belongs
            # in the same cluster — without this, perimeter chunks get
            # stranded and dropped on the next pass.
            members_local = {seed_local}
            frontier = {seed_local}
            while frontier:
                next_frontier: set[int] = set()
                for m in frontier:
                    row = sim[m]
                    for j in range(len(indices)):
                        if j in members_local or j not in unassigned:
                            continue
                        if row[j] >= similarity_threshold:
                            members_local.add(j)
                            next_frontier.add(j)
                frontier = next_frontier

            cluster_items = [items[indices[j]] for j in members_local]
            cluster = QuestionCluster(level=level, members=cluster_items)

            if (
                len(cluster.members) >= min_members
                and cluster.source_count >= min_sources
            ):
                clusters.append(cluster)
                unassigned -= members_local
            else:
                # Reject the cluster but keep its members available so they
                # can re-cluster around a different seed. Mark only the
                # current seed as tried so we don't re-attempt it.
                tried_seeds.add(seed_local)

    # Sort by source_count desc so downstream consumers (and the cap) prefer
    # the broadest threads.
    clusters.sort(key=lambda c: (-c.source_count, -len(c.members)))
    return clusters


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------


def _coerce_str(value: Any, default: str = "") -> str:
    if isinstance(value, str):
        return value.strip()
    if value is None:
        return default
    return str(value).strip() or default


def _coerce_convergence(value: Any) -> str:
    raw = _coerce_str(value).upper()
    return raw if raw in {"AGREE", "DIVERGE", "CONTRADICT"} else "AGREE"


def synthesize_thread(
    cluster: QuestionCluster,
    *,
    client: NarrativeLLMClient,
    cfg: NarrativeConfig,
) -> Optional[SynthesizedThread]:
    """Ask the LLM to produce {thread_question, theme_label, convergence}.

    Returns None if the LLM fails or returns an unusable shape — caller skips
    the cluster rather than writing a degenerate thread.
    """
    pass_cfg = cfg.for_pass(PASS_NAME)
    system_prompt = build_thread_synthesis_system()
    questions_block = "\n".join(f"- {q}" for q in cluster.representative_questions(limit=12))
    user = THREAD_SYNTHESIS_USER_TEMPLATE.format(
        level=cluster.level,
        source_count=cluster.source_count,
        member_count=len(cluster.members),
        questions_block=questions_block,
    )

    try:
        raw = client.chat_json(system_prompt, user, model=pass_cfg.model)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pass2] thread synthesis failed: %s", exc)
        return None

    if not isinstance(raw, dict):
        return None

    thread_question = _coerce_str(raw.get("thread_question"))
    theme_label = _coerce_str(raw.get("theme_label"))
    convergence = _coerce_convergence(raw.get("convergence"))

    if not thread_question or not theme_label:
        return None

    return SynthesizedThread(
        cluster=cluster,
        thread_question=thread_question,
        theme_label=theme_label,
        convergence=convergence,
    )


# ---------------------------------------------------------------------------
# Weaviate row shaping
# ---------------------------------------------------------------------------


_THREAD_NAMESPACE = "8f8a8a40-narrative-pipeline-question-threads"


def thread_uuid(collection_id: str, level: str, thread_question: str) -> str:
    """Deterministic UUID for a thread row.

    Hashes (collection_id || level || lower(thread_question)) so reruns of
    Pass 2 over the same data idempotently upsert.
    """
    raw = f"{_THREAD_NAMESPACE}|{collection_id or 'default'}|{level}|{thread_question.strip().lower()}".encode(
        "utf-8"
    )
    digest = hashlib.sha1(raw).hexdigest()
    return f"{digest[0:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:32]}"


def thread_id_string(level: str, thread_question: str) -> str:
    """Public, human-readable thread_id for the row's `thread_id` property."""
    slug = thread_question.strip().lower().replace(" ", "_")[:60]
    safe = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in slug)
    return f"{level.lower()}__{safe}"


def build_thread_objects(
    threads: List[SynthesizedThread],
    *,
    collection_id: str,
    published_default: bool,
    question_vectors: Optional[Dict[str, List[float]]] = None,
) -> List[Dict[str, Any]]:
    """Shape SynthesizedThread → Weaviate row objects.

    `question_vectors` maps thread_uuid → embedding for the named
    `question_vector` HNSW. When omitted, threads land without a vector
    (search-by-similarity won't work, but BM25 still does).
    """
    out: List[Dict[str, Any]] = []
    for thread in threads:
        cluster = thread.cluster
        uuid = thread_uuid(collection_id, cluster.level, thread.thread_question)
        properties = {
            "thread_id": thread_id_string(cluster.level, thread.thread_question),
            "thread_question": thread.thread_question,
            "theme_label": thread.theme_label,
            "question_level": cluster.level,
            "source_count": cluster.source_count,
            "convergence": thread.convergence,
            "published": bool(published_default),
            "conflict_ids": [],  # populated by Pass 1.5 later
            "collection_id": collection_id,
        }
        obj: Dict[str, Any] = {
            "class": "QuestionThreads",
            "id": uuid,
            "properties": properties,
            "answeredByChunks": cluster.chunk_uuids,
        }
        if question_vectors and uuid in question_vectors:
            obj["vectors"] = {"question_vector": question_vectors[uuid]}
        out.append(obj)
    return out


# ---------------------------------------------------------------------------
# Orchestrator helpers (data loading is done by the caller in main.py — this
# module deliberately doesn't know about Weaviate so it stays unit-testable).
# ---------------------------------------------------------------------------


def synthesize_all(
    clusters: List[QuestionCluster],
    *,
    client: NarrativeLLMClient,
    cfg: NarrativeConfig,
    max_per_level: int = DEFAULT_MAX_THREADS_PER_LEVEL,
) -> List[SynthesizedThread]:
    """Loop synthesize_thread over every cluster, capping per level."""
    out: List[SynthesizedThread] = []
    by_level_count: Dict[str, int] = {}
    t0 = time.time()
    for cluster in clusters:
        if by_level_count.get(cluster.level, 0) >= max_per_level:
            continue
        synthesized = synthesize_thread(cluster, client=client, cfg=cfg)
        if synthesized is None:
            continue
        out.append(synthesized)
        by_level_count[cluster.level] = by_level_count.get(cluster.level, 0) + 1
    logger.info(
        "[pass2] synthesized %d threads from %d clusters in %.2fs",
        len(out),
        len(clusters),
        time.time() - t0,
    )
    return out


def merge_similar_threads(
    threads: List[SynthesizedThread],
    thread_embeddings: np.ndarray,
    *,
    threshold: float = DEFAULT_THREAD_MERGE_THRESHOLD,
) -> Tuple[List[SynthesizedThread], List[List[float]]]:
    """Stage 1.5 dedup: collapse near-paraphrase threads into one.

    Two signals trigger a merge:
      1. Cosine similarity of question_vector ≥ `threshold`.
      2. Identical theme_label (case-insensitive) inside the same level —
         the user-facing token is the same so two surviving rows would
         confuse the cloud regardless of question wording.

    Walk threads in descending source_count, fold matches into the survivor.
    Survivor's cluster members are unioned (re-counts unique sources
    automatically via QuestionCluster.source_count).
    """
    if len(threads) == 0:
        return [], []
    if thread_embeddings.shape[0] != len(threads):
        raise ValueError("thread/embedding length mismatch")

    norm = _normalize(thread_embeddings)

    # Stable sort by (-source_count, -member_count) to pick survivors first.
    order = sorted(
        range(len(threads)),
        key=lambda i: (-threads[i].cluster.source_count, -len(threads[i].cluster.members)),
    )

    consumed: set[int] = set()
    survivors: List[int] = []
    merged_into: Dict[int, int] = {}
    for idx in order:
        if idx in consumed:
            continue
        survivors.append(idx)
        seed_vec = norm[idx]
        sims = norm @ seed_vec  # cosine sim of every thread to this survivor
        survivor_label = threads[idx].theme_label.strip().lower()
        for j in order:
            if j == idx or j in consumed:
                continue
            # Only fold same-level threads — FACTS shouldn't absorb IDENTITY.
            if threads[j].cluster.level != threads[idx].cluster.level:
                continue
            sim_match = sims[j] >= threshold
            label_match = (
                survivor_label
                and threads[j].theme_label.strip().lower() == survivor_label
            )
            if sim_match or label_match:
                consumed.add(j)
                merged_into[j] = idx

    # Apply the merges: union members, dedupe by (chunk_uuid, theirstory_id).
    for j, into_idx in merged_into.items():
        survivor = threads[into_idx]
        candidate = threads[j]
        seen = {(m.chunk_uuid, m.theirstory_id) for m in survivor.cluster.members}
        for m in candidate.cluster.members:
            key = (m.chunk_uuid, m.theirstory_id)
            if key in seen:
                continue
            survivor.cluster.members.append(m)
            seen.add(key)

    survivor_threads = [threads[i] for i in survivors]
    survivor_vectors = [thread_embeddings[i].tolist() for i in survivors]
    logger.info(
        "[pass2] thread dedup: %d → %d survivors (merged %d at threshold %.2f)",
        len(threads),
        len(survivor_threads),
        len(merged_into),
        threshold,
    )
    return survivor_threads, survivor_vectors
