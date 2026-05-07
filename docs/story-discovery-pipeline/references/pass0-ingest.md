# Pass 0: Ingest & Normalize

This pass runs once per source at upload time. It produces three outputs for each source:
a segment index, an entity extraction, and question constellations. All three are stable —
they don't change based on editorial intent — and should be cached.

## Table of Contents

1. [Step 1: Segmentation](#step-1-segmentation)
2. [Step 2: Named Entity Recognition](#step-2-named-entity-recognition)
3. [Step 3: Question Constellation Generation](#step-3-question-constellation-generation)
4. [Output Format](#output-format)

---

## Step 1: Segmentation

Break each transcript into citable segments. A segment is a continuous stretch of speech by one
speaker that addresses a coherent topic or moment. Segment boundaries occur when:

- The speaker changes (interviewer/narrator turn)
- The topic shifts significantly within a single speaker's turn
- The temporal frame shifts (narrator moves to a different time period)
- The emotional register shifts markedly

Each segment gets a stable ID: `{source_slug}__seg_{NNN}` (e.g., `george_takei__seg_014`).

For timestamped transcripts, preserve start and end timestamps. For untimestamped text,
preserve character offsets.

### Segmentation Prompt

```
You are segmenting an oral history transcript into citable units. Each segment should be a
coherent stretch of speech that a researcher could cite as a self-contained excerpt.

Rules:
- Keep interviewer questions attached to the response they elicit ONLY when the question is
  very short (< 2 sentences) and essential context for understanding the answer. Otherwise,
  interviewer turns are their own segments.
- A segment should be roughly 1-8 paragraphs. If a narrator speaks uninterrupted for several
  minutes across multiple distinct topics, split into multiple segments.
- Preserve the exact original text. Do not summarize or paraphrase.
- For each segment, provide: segment_id, speaker, start_time, end_time, text.
- Also provide a one-sentence summary (segment_summary) that captures the core content,
  written as a neutral description (e.g., "Narrator describes the family's arrival at
  Santa Anita racetrack and conditions in the horse stalls").

Transcript to segment:
{transcript}
```

---

## Step 2: Named Entity Recognition

For each segment, extract all named entities. Then deduplicate and reconcile across the full
source. The approach follows William Mattingly's LLM-based NER pipeline (Yale/chai-tea):

### Entity Types

- **PERSON**: Named individuals. Include role/relationship if stated (e.g., "my grandfather",
  "the attorney who represented us").
- **PLACE**: Named locations. Include type if clear (city, camp, school, neighborhood, country).
- **EVENT**: Named or clearly identifiable historical events (e.g., "Pearl Harbor",
  "Executive Order 9066", "the Land Run of 1889").
- **DATE**: Explicit dates or date ranges. Also capture implicit temporal anchors
  ("when I was five", "after the war", "in the 60s") as approximate dates when context
  allows resolution.
- **INSTITUTION**: Named organizations, agencies, schools, companies, military units, tribes,
  government bodies.
- **CULTURAL_ITEM**: Named songs, books, films, TV shows, laws, court cases, traditions,
  ceremonies, foods that carry cultural significance in context.

### NER Extraction Prompt

```
You are extracting named entities from an oral history segment. Your goal is precision and
completeness — capture every entity that a researcher, family member, or student might want
to search for.

For each entity, provide:
- entity_text: the exact text as it appears in the segment
- entity_type: PERSON | PLACE | EVENT | DATE | INSTITUTION | CULTURAL_ITEM
- context_role: a brief phrase describing this entity's role in this segment
  (e.g., "narrator's grandfather", "camp where family was interned",
  "law that enabled citizenship stripping")
- confidence: HIGH | MEDIUM | LOW

Important:
- Capture variant forms. If the narrator says "Tule Lake" in one place and "Toovey Lake"
  in another (transcription variant), note both.
- For PERSON entities, note whether the person is the narrator, the interviewer, someone
  being described in the present, or someone being remembered/referenced.
- For DATE entities, resolve implicit dates when the transcript provides enough context
  (e.g., if narrator says "I was born in 1937" and later says "when I was five", resolve
  to approximately 1942).
- Flag potential transcription errors (e.g., "Executive Order 966" likely means "9066",
  "Elaine Collins" likely means "Wayne Collins") with a note.

Segment:
{segment_text}

Source context (for date resolution):
{source_metadata}
```

### Deduplication & Reconciliation

After extracting entities from all segments in a source, run a deduplication pass:

```
You are deduplicating and reconciling named entities extracted from an oral history.
Below are all entities extracted across all segments of this source.

For each unique entity:
1. Group all variant forms (spelling variations, nicknames, partial names, transcription errors)
2. Select a canonical form
3. Attempt to reconcile with linked open data:
   - For notable persons: provide Wikidata QID if confident
   - For well-known places: provide Wikidata QID or GeoNames ID
   - For historical events: provide Wikidata QID if one exists
   - For institutions: provide Wikidata QID if notable
4. For entities that do NOT match any linked data source, create an internal authority record
   with a unique internal ID (format: internal_{source_slug}_{entity_type}_{NNN})
5. Extract relationships between entities with qualifiers and grounding quotes:
   - Format: {subject_entity} -> {relationship_type} -> {object_entity}
   - Include the grounding quote from the transcript
   - Example: "Wayne Collins" -> REPRESENTED -> "George Takei's mother"
     Quote: "He was the one that came to the rescue of my mother"

Relationship types to look for:
FAMILY_OF, REPRESENTED, INTERNED_AT, LIVED_IN, WORKED_AT, FOUGHT_FOR, CREATED,
LED, TAUGHT, SAVED, OPPOSED, COLLABORATED_WITH, INFLUENCED, PRECEDED, FOLLOWED

Entity list:
{all_entities_json}
```

---

## Step 3: Question Constellation Generation

For each segment, generate the questions this segment meaningfully answers. This is the
Holocaust Museum reverse-question technique, structured through the Difficult Conversations
three-lens framework.

### Question Generation Prompt

```
You are generating a "question constellation" for an oral history segment. Your job is to
reverse-engineer the questions this segment would be the ideal answer to.

Generate questions at THREE levels:

**Facts** — What happened? Who was there? What did it look like/sound like/feel like
physically? When and where? These are the questions a researcher types when they know
what they're looking for.

**Feelings** — What was the emotional experience of being inside this moment? What did it
feel like to be this person in this situation? These surface when someone is looking for
resonance and human connection rather than information.

**Identity** — What meaning did this person make of this experience? How did it shape
their understanding of who they are, who others are, or how the world works? These are
the deepest questions — they connect this segment to universal human experiences that
transcend the specific facts. Pay special attention to Frankl moments — places where the
narrator articulates the meaning that allowed them to endure, the irreducible thing that
could not be taken. Not just "what did this mean to you?" but "what did you hold onto
that kept you going?" These are the most powerful connective tissue across testimonies.

Rules:
- Generate 2-4 questions per level (6-12 total per segment)
- Facts questions should be specific enough to be useful search queries
- Feelings questions should name the emotion or emotional dynamic, not just ask
  "how did you feel?"
- Identity questions should be abstract enough to connect this segment to other segments
  about completely different events but the same human experience
- Write questions as a searcher would phrase them, not as an interviewer would ask them
- Include at least one question at each level that someone from a DIFFERENT cultural or
  historical context might search for and find this segment relevant to

Also generate ONE source-level question if this segment contributes to the overall arc
of the full testimony (e.g., "How did the internment experience shape George Takei's
lifelong activism?"). Not every segment warrants this — only generate if the segment
is structurally important to the source's narrative arc.

Segment:
{segment_text}

Segment summary:
{segment_summary}

Source context:
{source_metadata}
```

---

## Output Format

Pass 0 produces three JSON objects per source:

### SegmentIndex

```json
{
  "source_id": "george_takei",
  "source_metadata": {
    "narrator": "George Takei",
    "interviewer": "Elizabeth Hira",
    "date_recorded": null,
    "location": null,
    "duration": "47:13",
    "project": "American Stories"
  },
  "segments": [
    {
      "segment_id": "george_takei__seg_001",
      "speaker": "GEORGE TAKEI",
      "start_time": "00:00:00",
      "end_time": "00:00:22",
      "text": "I'm George Takei. My family is from California and Japan...",
      "segment_summary": "Narrator introduces himself with the American Stories format."
    }
  ]
}
```

### EntityGraph

```json
{
  "source_id": "george_takei",
  "entities": [
    {
      "canonical_form": "Wayne Collins",
      "entity_type": "PERSON",
      "variants": ["Wayne Collins", "Elaine Collins"],
      "linked_data": {
        "wikidata_qid": "Q7975234",
        "description": "American civil liberties attorney"
      },
      "internal_id": null,
      "mentions": [
        {
          "segment_id": "george_takei__seg_018",
          "entity_text": "Wayne Collins",
          "context_role": "attorney who saved narrator's mother from deportation"
        }
      ]
    },
    {
      "canonical_form": "Mrs. Gonzalez",
      "entity_type": "PERSON",
      "variants": ["Mrs. Gonzalez"],
      "linked_data": null,
      "internal_id": "internal_george_takei_person_001",
      "mentions": [
        {
          "segment_id": "george_takei__seg_022",
          "entity_text": "Mrs. Gonzalez",
          "context_role": "next-door neighbor who exchanged recipes with narrator's mother"
        }
      ]
    }
  ],
  "relationships": [
    {
      "subject": "Wayne Collins",
      "relationship": "REPRESENTED",
      "object": "George Takei's mother",
      "qualifier": "prevented deportation to Japan",
      "grounding_quote": "He was the one that came to the rescue of my mother",
      "segment_id": "george_takei__seg_018"
    }
  ]
}
```

### QuestionConstellations

```json
{
  "source_id": "george_takei",
  "constellations": [
    {
      "segment_id": "george_takei__seg_005",
      "facts": [
        "What happened when Japanese American families were ordered to leave their homes?",
        "What were families allowed to bring when evacuated during WWII internment?",
        "How were soldiers involved in removing Japanese Americans from their homes?"
      ],
      "feelings": [
        "What did it feel like as a child to see armed soldiers at your front door?",
        "What is the experience of watching your parent be threatened at gunpoint?",
        "What does it feel like to leave your home not knowing if you'll return?"
      ],
      "identity": [
        "How does childhood trauma from state violence shape a person's relationship to their country?",
        "What does it mean to witness your parents' powerlessness as a child?",
        "How do families preserve dignity when stripped of everything they own?"
      ],
      "source_level": "How did the day of forced removal become the foundational memory of George Takei's activism?"
    }
  ]
}
```
