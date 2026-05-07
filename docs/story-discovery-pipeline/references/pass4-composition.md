# Pass 4: Source-to-Role Mapping

This pass runs on demand after the user selects a storyline candidate from Pass 3. It takes
every segment in the corpus and assigns it a narrative role within the chosen storyline,
producing a composition-ready arrangement of source material.

## When to Run

Only after the user has reviewed the storyline candidates from Pass 3 and selected one
(or asked to explore one further). This pass is editorial — it recruits existing material
into a narrative structure.

## Rabiger Three-Function Filter (run first)

Before the detailed role assignment, run each segment through Rabiger's simpler test.
Every piece of source material either:

1. **ADVANCES** the dramatic question — moves the audience closer to an answer
2. **COMPLICATES** the dramatic question — introduces a dimension that prevents easy resolution
3. **RESOLVES/REFRAMES** the dramatic question — provides an answer or changes how the question is understood

Material that does none of these is OUTSIDE this storyline. This is a fast, coarse filter
that separates relevant material from tangential material before the more granular role
assignment.

```
For the dramatic question: "{dramatic_question}"

Classify each segment as:
- ADVANCES: this segment moves the audience toward an answer
- COMPLICATES: this segment makes the answer harder, more nuanced, or contested
- RESOLVES: this segment provides or contributes to an answer or reframing
- OUTSIDE: this segment does not engage the dramatic question

Only segments classified as ADVANCES, COMPLICATES, or RESOLVES proceed to detailed
role assignment. OUTSIDE segments go to the tangential pool.
```

## Role Assignment Prompt

```
You are assigning narrative roles to source material for a specific storyline.

Storyline:
{storyline_summary}

Dramatic question: {dramatic_question}
Transformation: {transformation}
Question sequence: {question_sequence}
Conflict spine: {conflict_spine}

For each segment below, assign ONE primary role and optionally one secondary role.

Possible roles:

- SETS_THE_WORLD: Establishes the before-state. Shows the audience what existed before the
  tension arrived. These segments should make the audience care about what's at stake.

- INTRODUCES_TENSION: The first moment where the core tension becomes visible. Often a
  specific event, but can also be a realization or a question.

- ESCALATES: Raises the stakes. Shows the tension deepening, spreading, or becoming
  harder to ignore. Multiple segments can escalate in sequence.

- COMPLICATES: Adds a dimension the audience didn't expect. Introduces a new perspective,
  a contradictory fact, or a wrinkle that prevents easy resolution. Conflict Map segments
  often serve this role.

- TURNS: The pivotal moment — where the trajectory changes. In a multi-source storyline,
  there may be multiple turns (one per source that carries the thread), but identify the
  CENTRAL turn that the storyline hinges on.

- RESOLVES_OR_REFRAMES: Shows where the tension landed — not necessarily resolved, but
  understood differently. In many oral history storylines, the "resolution" is actually a
  reframing: the narrator now sees the experience through a different lens. Bookend
  segments often serve this role.

- PROVIDES_EVIDENCE: Data, documents, or factual details that prove the stakes were real.
  Not emotionally charged, but necessary for credibility. Spreadsheet data, dates, legal
  records referenced in testimony.

- REVEALS_THE_SYSTEM: Helps the audience understand WHY things unfolded the way they did.
  Segments that describe laws, policies, institutional dynamics, feedback loops. The Meadows
  lens — these segments make the story explanatory, not just chronological.

- ADDS_TEXTURE: Images, ambient details, sensory descriptions that make the story visceral.
  The enchiladas and the mariachi band. The icicles in a sister's hair. The crab-picking
  aunts. These segments don't advance the plot but they make it real.

- TANGENTIAL: Related to the storyline's themes but not part of THIS story. Flag but set
  aside — these may belong to a different storyline candidate.

For each segment, provide:
- segment_id
- source
- primary_role
- secondary_role (optional)
- placement: which question in the question_sequence does this segment primarily serve?
- quote: the single most powerful line from this segment for this storyline (the line
  a producer would use in a trailer, an editor would use as a pull-quote)
- note: one sentence on why this segment serves this role

Segments to analyze:
{all_segments_with_extractions}
```

## Composition View

After role assignment, produce a **composition view** — the segments arranged in narrative
order, organized by the question sequence from Pass 3.

```
STORYLINE: "The Cost of Belonging"
DRAMATIC QUESTION: What does America demand you give up in order to belong — and what
happens when the next generation wants it back?

─── ACT 1: WHAT DID THEY HAVE? ───

[SETS_THE_WORLD] karen_matsuoka__seg_002
Karen Matsuoka — Terminal Island, the fishing village called "furusato"
"Never having to choose between his Japanese heritage or being American"

[SETS_THE_WORLD] sarah_adams__seg_040
Sarah Adams — The Choctaw creation story of Nanih Waiya
"We were the last ones to come out of the earth because we wanted to stay with our mother"

[ADDS_TEXTURE] george_takei__seg_022
George Takei — Mrs. Gonzalez and the enchiladas, taco-eating contests
"My mother served us enchiladas one meal, and it was delicious"

─── ACT 2: WHAT FORCED THE CHOICE? ───

[INTRODUCES_TENSION] george_takei__seg_005
George Takei — Soldiers with bayonets at the family home
"Tears were streaming down her cheeks. I'll never forget that morning."

[ESCALATES] karen_matsuoka__seg_005
Karen Matsuoka — 48 hours to evacuate, baby in one arm, pregnant
"They were given 48 hours to pack... she had no idea how long they were going
to be away"

[REVEALS_THE_SYSTEM] sarah_adams__seg_022
Sarah Adams — Boarding schools as assimilation infrastructure
"What schools have cemeteries?"

...etc
```

This composition view is what the user interacts with. They can:

- Reorder segments within a section
- Swap one segment for another that serves the same role
- Remove segments that don't work
- Add segments from the TANGENTIAL pool
- Preview the storyline as a sequence of quotes and sources

## Output Format

### CompositionMap

```json
{
  "storyline_id": "storyline_001",
  "roles": [
    {
      "segment_id": "karen_matsuoka__seg_002",
      "source": "karen_matsuoka",
      "primary_role": "SETS_THE_WORLD",
      "secondary_role": null,
      "placement": "What did these families have before the demand to assimilate?",
      "quote": "Never having to choose between his Japanese heritage or being American",
      "note": "Establishes Terminal Island as the Eden before the fall — a place where dual identity was natural and unforced"
    }
  ],
  "composition_sequence": [
    {
      "section_question": "What did these families have before the demand to assimilate?",
      "segments_in_order": ["karen_matsuoka__seg_002", "sarah_adams__seg_040", "george_takei__seg_022"]
    }
  ],
  "unused_tangential": [
    {
      "segment_id": "heidi_mathers__seg_012",
      "source": "heidi_mathers",
      "note": "Trip to Denmark — relevant to cultural roots but this storyline focuses on coerced loss, not voluntary migration"
    }
  ]
}
```

## Presentation to User

When presenting the composition view to the user, frame it as a working draft, not a
finished product. Use language like:

"Here's how your archive tells this story. I've arranged the sources by the role each
moment plays in the narrative. The pull-quotes are the lines I think carry the most
weight. You can rearrange, swap, or remove anything — this is a starting point for
your editorial process, not the final cut."

If the storyline has significant gaps (from Pass 3 gap analysis), surface them here:

"You'll notice that the section on [X] is thinner than the others — I only found [N]
segments that speak to this part of the story. Based on what's here, the person who
could fill this gap is [description]. Here's what I'd ask them: [questions]."
