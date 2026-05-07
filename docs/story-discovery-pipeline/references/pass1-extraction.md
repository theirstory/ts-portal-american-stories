# Pass 1: Segment-Level Narrative Extraction

# Pass 1.5: Conflict Detection

These passes run at ingest time alongside Pass 0. They add interpretive layers to each segment
and then detect conflicts across segments within and between sources.

## Table of Contents

1. [Pass 1: Narrative Extraction](#pass-1-narrative-extraction)
2. [Pass 1.5: Conflict Detection](#pass-15-conflict-detection)
3. [Output Format](#output-format)

---

## Pass 1: Narrative Extraction

For each segment, extract the raw narrative material that downstream passes will use to find
threads and compose storylines. This is not summarization — it's analytical decomposition.

### Narrative Extraction Prompt

```
You are analyzing a segment from an oral history. Your job is not to summarize — it's to
extract narrative raw material that will be used to discover stories across a collection.

For this segment, identify:

1. **Values at play**: What human values are at stake? Not topics — values. A segment about
   a budget cut isn't "about finance," it's about survival, betrayal, or pragmatism depending
   on how the speaker frames it. Name the values and whether they are being AFFIRMED (speaker
   describes the value being upheld or honored) or THREATENED (the value is under attack,
   eroded, or violated). Common values in oral histories: belonging, safety, freedom, justice,
   identity, legacy, loyalty, dignity, community, autonomy, faith, family, truth.

2. **Emotional charge & trajectory**: What is the emotional arc WITHIN this segment?
   Does it start positive and turn negative? Stay in one register? Build in intensity?
   Use McKee's value-charge model: identify what value is at stake and whether the segment
   moves it from positive to negative (a "down" turn), negative to positive (an "up" turn),
   or holds it steady. The TURNS — moments where the charge flips — are where narrative
   energy lives. Flag them specifically.

3. **Temporal markers**: When does this moment sit in time? Capture both explicit dates
   and implicit temporal anchoring ("before the merger", "after Mom died", "when we were
   still on Main Street"). Note whether the narrator is describing events in chronological
   order or jumping between time periods.

4. **Stance markers**: Is the speaker reflecting from a distance ("I used to believe...",
   "Looking back...") or speaking from inside the experience ("We have to fight this",
   "It was terrifying")? Reflective stance is especially valuable because it signals
   someone who has undergone a transformation and can articulate the before and after.
   The presence of BOTH stances in the same segment ("At the time I thought X, but now
   I understand Y") is a transformation marker — flag it prominently.

5. **Tension indicators**: Any moment where the segment contains opposition, contradiction,
   or unresolved friction. "We loved that place but we knew it was killing us." "The board
   said one thing and did another." "I'm proud to be American but America didn't want us."
   These are the load-bearing walls of narrative. Quote the exact language.

6. **Conceptual metaphors** (Lakoff): What metaphorical frames does the speaker use? Is the
   organization a FAMILY, a MACHINE, a SHIP, a BUILDING, a BATTLE? Is the life story a
   JOURNEY, a CLIMB, a WEAVING? Is identity a CONTAINER (in/out), a PERFORMANCE (role/mask),
   a POSSESSION (have/lose)? These metaphors reveal worldview. When metaphors SHIFT across
   time or between speakers, you've found a transformation. Flag the specific metaphorical
   language used.

7. **Bookend detection**: If this segment appears to answer the same question asked earlier
   in the interview (especially if the interview format repeats a question at the end),
   flag it and note what has changed in how the narrator answers.

Be specific. Cite exact language from the segment to support every claim.

Segment:
{segment_text}

Segment summary:
{segment_summary}

Full source context (for bookend detection):
{source_metadata}
```

### Confidence and Alternative Readings

For each element extracted, provide a primary reading and, where applicable, an alternative
reading. This is especially important for emotional charge and metaphor analysis.

Example:

```
Value: loyalty
Primary reading: THREATENED (narrator describes being forced to renounce citizenship)
Alternative reading: AFFIRMED (narrator's choice to renounce was itself an act of loyalty
to family over country)
Confidence: MEDIUM — both readings are valid; the storyline context determines which is primary
```

This multi-valent approach (drawn from Minsky) ensures that segments can be recruited into
different storylines without losing interpretive integrity.

---

## Pass 1.5: Conflict Detection

After Pass 1 has run on all segments across all sources, scan for conflicts. This pass
operates on pairs of segments that share some relationship — same entity, same event,
overlapping temporal period, or similar question constellation.

### Conflict Types

**Factual Divergence**: Two sources describe the same event, person, or place with
different details or different decisions in response to the same circumstances.
These are not errors — they're perspectives. The most interesting factual divergences
are about CHOICES: two people faced the same situation and chose differently.

**Emotional Opposition**: Two sources describe the same type of experience with opposite
emotional charges. One narrator describes assimilation as a wound; another describes it
as natural adaptation. Same structural experience, opposite feeling. These are valuable
because they force the audience to ask WHY the emotional charge differs — and the answer
is usually about power, coercion, and choice.

**Identity Contradiction**: Two sources answer the same identity-level question with
opposite conclusions. "When your country betrays you, the patriotic response is to
participate and reform from within" vs. "When your country betrays you, the patriotic
response is to resist and refuse." These contradictions are the central nervous system
of a multi-source storyline.

**Narrative Fracture**: A contradiction WITHIN a single source or family. The narrator
tells a story of reclamation, but a family member quoted within the same testimony
disagrees ("the boarding schools weren't that bad"). Or the narrator's aspirational
frame ("the American dream worked for us") cracks when they describe a specific moment
of disillusionment. These fractures are the most honest moments in any testimony.

### Conflict Detection Prompt

```
You are analyzing two segments from an oral history collection to detect narrative
conflicts. A conflict is not an error — it's a place where the archive is in dialogue
with itself. Conflicts are the most narratively valuable material in a collection
because they create the tension that makes storylines compelling.

Segment A:
Source: {source_a}
Segment ID: {segment_a_id}
Text: {segment_a_text}
Pass 1 analysis: {segment_a_extraction}

Segment B:
Source: {source_b}
Segment ID: {segment_b_id}
Text: {segment_b_text}
Pass 1 analysis: {segment_b_extraction}

Shared connection (why these segments are being compared):
{connection_reason}

Analyze for each conflict type:

1. **Factual divergence**: Do these segments describe the same event, person, or
   situation with different factual details or different choices? If so, what specifically
   diverges, and is the divergence about perception, memory, or deliberate choice?

2. **Emotional opposition**: Do these segments describe structurally similar experiences
   with different emotional charges? If so, name the structural similarity and the
   emotional divergence. Why might the emotional charge differ?

3. **Identity contradiction**: Do these segments answer the same identity-level question
   differently? If so, state the question they both implicitly answer, and state each
   segment's answer. Do NOT resolve the contradiction — the point is to surface it.

4. **Narrative fracture**: Does either segment contain internal contradiction — a moment
   where the narrator's own story undermines the frame they're constructing? Or does it
   reference disagreement within the narrator's family or community?

For each conflict found, provide:
- conflict_type: FACTUAL | EMOTIONAL | IDENTITY | FRACTURE
- scope: CROSS_SOURCE | INTRA_SOURCE
- segment_ids: [list of segment IDs involved]
- description: what the conflict is, in one sentence
- significance: why this conflict matters narratively (one sentence)
- unresolved: true/false — is this a tension the archive leaves open, or does one
  source's framing clearly supersede the other?

If no conflict exists between these segments, say so. Not every pair has one.
```

### Which Segments to Compare

Don't compare every segment pair (combinatorial explosion). Compare segments that share:

- **The same entity** (both mention Tule Lake, both reference the loyalty questionnaire)
- **The same event** (both describe evacuation day, both discuss post-war return)
- **Overlapping temporal period** (both describe the 1940s, both describe "coming home")
- **Similar question constellations** (both answer questions about what patriotism means,
  both answer questions about the cost of assimilation)
- **The same value in tension** (both have "loyalty" flagged as a key value, but with
  different charges)

---

## Output Format

### NarrativeExtraction (per segment)

```json
{
  "segment_id": "karen_matsuoka__seg_008",
  "values": [
    {
      "value": "loyalty",
      "charge": "THREATENED",
      "alternative_charge": "AFFIRMED",
      "evidence": "My grandfather's response to injustice was to stand up for his rights",
      "confidence": "MEDIUM",
      "note": "Threatened in the eyes of the community who saw compliance as loyalty; affirmed in the narrator's framing of resistance as the deeper loyalty"
    },
    {
      "value": "dignity",
      "charge": "AFFIRMED",
      "evidence": "the patriotic thing is to call it out and to resist it",
      "confidence": "HIGH"
    }
  ],
  "emotional_trajectory": {
    "start_charge": "negative",
    "end_charge": "positive",
    "turns": [
      {
        "at": "My grandfather said no",
        "from": "negative (oppression, coercion)",
        "to": "positive (defiance, self-determination)"
      }
    ]
  },
  "temporal_markers": [
    { "text": "during World War Two", "resolved_date": "1942-1945" },
    { "text": "the draft was instituted", "resolved_date": "~1944" }
  ],
  "stance": {
    "primary": "REFLECTIVE",
    "evidence": "narrator is telling grandfather's story from decades of distance",
    "transformation_marker": false
  },
  "tensions": [
    {
      "text": "This country doesn't believe that we're American. We need to prove that we are.",
      "between": "institutional belonging vs. self-evident identity"
    },
    {
      "text": "Both are equally stories of valor, and yet one was pushed as American and his actions were presented as being the most un-American thing that he could have done",
      "between": "compliance-as-patriotism vs. resistance-as-patriotism"
    }
  ],
  "metaphors": [
    {
      "metaphor": "patriotism as PROOF",
      "evidence": "We need to prove that we are",
      "frame": "identity as something that must be demonstrated to an external judge"
    },
    {
      "metaphor": "resistance as STANDING",
      "evidence": "to stand up for his rights",
      "frame": "justice as physical posture — you rise against what pushes you down"
    }
  ],
  "bookend": null
}
```

### ConflictMap (corpus-level)

```json
{
  "conflicts": [
    {
      "conflict_id": "conflict_001",
      "conflict_type": "IDENTITY",
      "scope": "CROSS_SOURCE",
      "segment_ids": ["george_takei__seg_012", "karen_matsuoka__seg_008"],
      "sources": ["george_takei", "karen_matsuoka"],
      "description": "Both families faced the loyalty questionnaire at Tule Lake. Takei's father cooperated and worked within the system; Matsuoka's grandfather refused and resisted. Both are framed as patriotic by their descendants.",
      "the_question_they_both_answer": "When your country imprisons you, is the patriotic response to cooperate or to resist?",
      "significance": "This is the central unresolved tension of the Japanese American internment narrative and of the broader archive — it runs through nearly every testimony in different forms.",
      "unresolved": true
    },
    {
      "conflict_id": "conflict_002",
      "conflict_type": "EMOTIONAL",
      "scope": "CROSS_SOURCE",
      "segment_ids": ["sarah_adams__seg_015", "heidi_mathers__seg_009"],
      "sources": ["sarah_adams", "heidi_mathers"],
      "description": "Both families lost cultural markers through assimilation. For Adams, the loss of Choctaw language is a wound ('it feels like a deep wound'). For Mathers, the fading of Danish traditions is bittersweet but not traumatic ('a beautiful quilt').",
      "the_question_they_both_answer": "What does it feel like to lose your family's cultural identity in America?",
      "significance": "Same structural experience, opposite emotional weight — the difference reveals that coerced assimilation and voluntary adaptation are fundamentally different even when they look similar from outside.",
      "unresolved": true
    },
    {
      "conflict_id": "conflict_003",
      "conflict_type": "FRACTURE",
      "scope": "INTRA_SOURCE",
      "segment_ids": ["sarah_adams__seg_018", "sarah_adams__seg_019"],
      "sources": ["sarah_adams"],
      "description": "Sarah Adams frames boarding schools as sites of trauma and cultural destruction, while acknowledging that family members say 'the boarding schools weren't that bad' and that her grandparents met and fell in love there.",
      "the_question_they_both_answer": "Were Indian boarding schools places of harm or places where life happened anyway?",
      "significance": "The most honest version of this storyline includes the fracture — the family doesn't agree on the meaning of its own history.",
      "unresolved": true
    }
  ]
}
```
