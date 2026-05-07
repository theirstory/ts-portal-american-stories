export enum SchemaTypes {
  Testimonies = 'Testimonies',
  Chunks = 'Chunks',
  Entities = 'Entities',
  Conflicts = 'Conflicts',
  QuestionThreads = 'QuestionThreads',
  Storylines = 'Storylines',
}

/** Per-occurrence entity mention bound to precise word-level timestamps.
 * Lives on chunks (entity_mentions) and is aggregated onto testimonies. */
export type EntityMention = {
  entity_uuid: string;
  canonical_form: string;
  /** PERSON | PLACE | EVENT | DATE | INSTITUTION | CULTURAL_ITEM | ORGANIZATION */
  label: string;
  /** The actual surface form used in this occurrence (may differ from canonical_form). */
  text: string;
  start_time: number;
  end_time: number;
  segment_id: string;
};

export type Testimonies = {
  transcription: string;
  interview_title: string;
  interview_description: string;
  collection_id: string;
  collection_name: string;
  collection_description: string;
  folder_id: string;
  folder_name: string;
  folder_path: string;
  recording_date: string;
  transcoded: string;
  interview_duration: number;
  ner_labels: any;
  /** @deprecated Use entity_mentions for new code. Retained only for legacy ingest fallback. */
  ner_data: any;
  /** Aggregated per-occurrence entity mentions across all chunks of this testimony. */
  entity_mentions: EntityMention[];
  participants: any;
  publisher: string;
  video_url: string;
  isAudioFile: boolean;
  hasChunks: any;
};

export type Chunks = {
  interview_duration: number;
  interview_title: string;
  collection_id: string;
  collection_name: string;
  collection_description: string;
  folder_id: string;
  folder_name: string;
  folder_path: string;
  description: string;
  transcoded: string;
  asset_id: string;
  theirstory_id: string;
  organization_id: string;
  project_id: string;
  section_id: number;
  para_id: number;
  chunk_id: number;
  recording_date: string;
  transcription: string;
  speaker: string;
  interviewers: any;
  is_interviewer: boolean;
  word_timestamps: any;
  /** @deprecated Use entity_mentions for new code. Retained only for legacy ingest fallback. */
  ner_data: any;
  ner_labels: any;
  ner_text: any;
  /** Per-occurrence entity mentions in this chunk with precise word-level spans. */
  entity_mentions: EntityMention[];
  start_time: number;
  end_time: number;
  section_title: string;

  // --- Pass 0 narrative pipeline (added in Phase 1A) ---
  /** Stable narrative segment id, e.g. "george_takei__seg_014". Set by Pass 0 segmentation. */
  narrative_segment_id: string;
  /** One-sentence neutral description of this segment. */
  segment_summary: string;
  /** NARRATOR | INTERVIEWER | OTHER */
  speaker_role: string;
  /** Facts-level questions this segment answers. */
  question_facts: string[];
  /** Feelings-level questions this segment answers. */
  question_feelings: string[];
  /** Identity-level questions this segment answers. Also embedded as question_vector. */
  question_identity: string[];
  /** Optional source-level question describing this segment's role in the full testimony arc. */
  question_source_level: string;

  thumbnail_url: string;
  video_url: string;
  isAudioFile: boolean;
  date: string;
  belongsToTestimony: any;
  /** Cross-ref to Entities mentioned in this chunk. */
  mentionsEntities: any;
};

/** PERSON | PLACE | EVENT | DATE | INSTITUTION | CULTURAL_ITEM */
export type EntityType = 'PERSON' | 'PLACE' | 'EVENT' | 'DATE' | 'INSTITUTION' | 'CULTURAL_ITEM';

export type EntityRelationship = {
  target_entity_id: string;
  target_canonical_form: string;
  relationship_type: string;
  qualifier: string;
  grounding_quote: string;
  source_chunk_id: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
};

export type EntityTranscriptionNote = {
  variant: string;
  likely_correct: string;
  reason: string;
};

export type Entities = {
  /** Wikidata QID like Q189330 if linked, otherwise internal_<source>_<type>_<NNN>. */
  entity_id: string;
  canonical_form: string;
  entity_slug: string;
  entity_type: EntityType;
  variants: string[];
  /** Wikidata QID if reconciled with HIGH confidence, else null. */
  linked_data_qid: string | null;
  linked_data_url: string | null;
  linked_data_description: string | null;
  /** Decimal-degree coordinates (WGS84) for PLACE entities, sourced from Wikidata P625. */
  latitude: number | null;
  longitude: number | null;
  /** Internal authority record id for entities with no linked-data match. */
  internal_id: string | null;
  /** One-sentence description of this entity's role across the source(s). */
  context_summary: string;
  transcription_notes: EntityTranscriptionNote[];
  relationships: EntityRelationship[];
  collection_id: string;
  /** Editorial publish flag. Entities stay draft until reviewed. */
  published: boolean;
  /** Cross-reference to Chunks that mention this entity. */
  mentionedInChunks: any;
};

export type ConflictType = 'FACTUAL' | 'EMOTIONAL' | 'IDENTITY' | 'FRACTURE';
export type ConflictScope = 'CROSS_SOURCE' | 'INTRA_SOURCE';

export type Conflicts = {
  conflict_id: string;
  conflict_type: ConflictType;
  scope: ConflictScope;
  description: string;
  /** The shared question both segments answer (the conflict surfaces in their answers). */
  shared_question: string;
  significance: string;
  unresolved: boolean;
  collection_id: string;
  involvesChunks: any;
  involvesTestimonies: any;
};

export type QuestionLevel = 'FACTS' | 'FEELINGS' | 'IDENTITY';
export type Convergence = 'AGREE' | 'DIVERGE' | 'CONTRADICT';

export type QuestionThreads = {
  thread_id: string;
  /** The shared question, written as a human would ask it. */
  thread_question: string;
  /** 1-3 word browseable label powering the homepage word cloud. */
  theme_label: string;
  question_level: QuestionLevel;
  /** Number of distinct sources that answer this question. */
  source_count: number;
  convergence: Convergence;
  /** Editorial publish flag. Threads stay draft until reviewed. */
  published: boolean;
  /** IDs of related Conflicts. */
  conflict_ids: string[];
  collection_id: string;
  answeredByChunks: any;
};

export type StorylineCompositionSection = {
  section_question: string;
  epigraph_quote: string;
  epigraph_attribution: string;
  accent_color: string;
  segment_ids: string[];
};

export type Storylines = {
  storyline_id: string;
  title: string;
  slug: string;
  /** The Rabiger dramatic question — the single question this storyline answers. */
  dramatic_question: string;
  /** Before-to-after transformation hypothesis (Lisa Cron). */
  transformation: string;
  editorial_attribution: string;
  published: boolean;
  composition: StorylineCompositionSection[];
  collection_id: string;
  includesChunks: any;
  includesThreads: any;
  includesConflicts: any;
};

export type SchemaMap = {
  [SchemaTypes.Testimonies]: Testimonies;
  [SchemaTypes.Chunks]: Chunks;
  [SchemaTypes.Entities]: Entities;
  [SchemaTypes.Conflicts]: Conflicts;
  [SchemaTypes.QuestionThreads]: QuestionThreads;
  [SchemaTypes.Storylines]: Storylines;
};

/**
 * Subset of SchemaTypes that the existing semantic-search store knows how to query.
 * The new narrative-pipeline collections (Entities, Conflicts, QuestionThreads,
 * Storylines) have their own access patterns and don't flow through the
 * `runHybridSearch` / `getAllStories` paths.
 */
export type SearchableSchemaType = SchemaTypes.Testimonies | SchemaTypes.Chunks;
