# Pass 2: Cross-Source Pattern Detection

# Pass 3: Storyline Candidate Generation

These passes operate across the full corpus. They are where editorial intent enters — the
user's sense of what the collection is about can optionally seed the analysis, and the
output is compositional rather than extractive.

## Table of Contents

1. [Pass 2: Cross-Source Pattern Detection](#pass-2-cross-source-pattern-detection)
2. [Pass 3: Storyline Candidate Generation](#pass-3-storyline-candidate-generation)
3. [Output Format](#output-format)

---

## Pass 2: Cross-Source Pattern Detection

### Strategy

The primary unit of cross-source discovery is the **question**. A thread is not a tension
you name after the fact — a thread IS a question that multiple sources independently answer.
The question is the key. The excerpts are the values. The thread is the question.

Pass 2 has three stages that run in sequence:

1. **Question clustering** — the primary discovery mechanism
2. **Multi-frame analysis** — a secondary lens that catches threads question clustering misses
3. **Transformation and meta-thread detection** — catches patterns that neither of the above surface

### Stage 1: Question Clustering (Primary)

Take all question constellations generated in Pass 0 across all sources. Cluster them by
semantic similarity (embedding-based for large collections, LLM-based for small ones).
Look for questions that 3+ sources independently answer.

For each cluster of similar questions, produce a **Question Thread**:

```
You have a cluster of semantically similar questions from the question constellations
of multiple oral history sources. These questions were generated independently for
different segments of different testimonies, but they converge on the same underlying
question.

Your task: identify the single best formulation of the shared question this cluster
represents. Then collect the specific excerpts from each source that answer it.

Question cluster:
{list of similar questions with their source_ids and segment_ids}

For each question thread, produce:
- thread_question: The single best formulation of the shared question. Write it as
  a question a human being would genuinely ask — not academic, not analytical, but
  the kind of question you'd stay up late talking about. The question IS the thread.
- theme_label: 1-3 words that summarize this question as a browseable theme.
  This is what appears in a word cloud, tag filter, or navigation pill.
  "belonging", "sacrifice for family", "the stranger who saved us", "joy as resistance",
  "language lost", "proving you belong". The label is the door; the question is the room.
  Multiple question threads can share a theme label if they cluster around the same
  concept — this is how the word cloud stays manageable even as question threads multiply.
- question_level: FACTS | FEELINGS | IDENTITY — which level are the clustered questions at?
  (Identity-level clusters are the most narratively powerful)
- answers: An array of source excerpts that answer this question, each with:
  - source_id
  - segment_id
  - excerpt: The exact words from the transcript (not paraphrased)
  - narrator: The speaker's name
  - context: One sentence of context (place, time, situation)
- source_count: How many different sources answer this question
- convergence: Do the answers AGREE, DIVERGE, or CONTRADICT?
  - AGREE: sources give structurally similar answers
  - DIVERGE: sources give different but compatible answers
  - CONTRADICT: sources give opposing answers to the same question
- conflicts: Any conflict_ids from the ConflictMap that are relevant
```

The output is a set of Question Threads — each one a question with an array of answers
from across the collection. These are the primary building blocks for storylines.

**For small collections (< 15 sources):** Feed all question constellations into a single
clustering analysis. The LLM can hold them in context.

**For large collections:** Use embedding similarity to pre-cluster questions
computationally, then run the LLM synthesis within each cluster.

### User Seeding (Optional)

Before running Stage 1, ask the user: "In a few words, what do you think this collection is
about?" Use their answer as a prior — not to constrain the clustering, but to ensure the
threads surfaced include what the user already senses, alongside surprises they haven't
noticed. You can also seed with explicit questions: "Is there a question you wish the
collection could answer?"

### Stage 2: Multi-Frame Analysis (Minsky)

Run the cross-source analysis through multiple interpretive frames in parallel. Each frame
looks at the same material through a different lens. This catches threads that question
clustering misses — particularly threads defined by systemic dynamics, power structures,
or emotional patterns that don't cluster neatly around a single question.

Threads that emerge from both question clustering AND multi-frame analysis independently
are the most robust.

#### Frame 1: Power Dynamics

```
Examine these segment extractions for patterns related to power — who has it, who doesn't,
how it's exercised, how it's resisted, how it shifts. Look for:
- Moments where institutional power overrides individual agency
- Moments where individuals reclaim power from institutions
- Patterns of who gets to define who belongs
- Power exercised through law, violence, language, or social pressure
```

#### Frame 2: Identity Formation

```
Examine these segment extractions for patterns related to identity — how people come to
understand who they are, how that understanding is challenged, and how it transforms.
Look for:
- The tension between self-defined identity and externally imposed identity
- Moments where someone claims or reclaims an identity
- The cost of hiding, suppressing, or performing an identity
- Generational shifts in what identity means
```

#### Frame 3: Loss and Adaptation

```
Examine these segment extractions for patterns related to what was lost and what was built
in its place. Look for:
- What specific things were lost (language, land, home, community, status, safety)
- Whether the loss was voluntary, coerced, or somewhere in between
- What was created or preserved in response to the loss
- Whether the narrator frames the adaptation as healing, compromise, or betrayal
```

#### Frame 4: Systemic Dynamics (Meadows)

```
Examine these segment extractions through a systems lens. Look for:
- Stocks that were accumulating or depleting (trust, cultural knowledge, economic
  security, community cohesion) — and when did they become visibly depleted?
- Reinforcing loops: things that accelerated once they started
  (e.g., discrimination → hiding identity → loss of culture → invisibility → more
  discrimination)
- Balancing loops: self-correcting mechanisms that eventually failed or succeeded
- Leverage points: moments where a small intervention changed the whole trajectory
  (one lawyer, one judge, one neighbor)
```

#### Frame 5: Joy and Resilience

```
Examine these segment extractions for patterns of joy, humor, creativity, and resilience.
Look for:
- Joy that exists ALONGSIDE suffering, not as its replacement
- Cultural practices that survived specifically because they were sources of joy
- Humor as resistance or coping
- Moments of unexpected connection across cultural boundaries
- What was preserved even when "everything" was taken
```

### Synthesis Prompt

After running all five frames, synthesize:

```
You have analyzed a collection of oral history sources through five interpretive frames.
Below are the patterns each frame surfaced.

Your task is to identify NARRATIVE THREADS — recurring tensions or transformations that
run across multiple sources and could form the spine of a compelling storyline.

Apply the Rabiger test to each candidate thread: can you state it as a dramatic question
someone would stay in their seat to hear answered? A theme is "assimilation." A dramatic
question is "What does America demand you give up in order to belong?" If you can't form
a genuine dramatic question, it's a topic cluster, not a narrative thread — note it but
don't elevate it.

For each thread, provide:
- thread_name: A short, evocative name (e.g., "The Cost of Belonging")
- dramatic_question: The Rabiger dramatic question — the single question an audience needs answered
- core_tension: The opposing values or forces that create this thread
- sources_involved: Which sources carry this thread (by source_id)
- supporting_segments: Key segment IDs that carry the thread
- temporal_arc: Does the tension intensify, resolve, remain open, or cycle?
- key_voices: Who are the primary narrators for this thread?
- system_dynamic: What systemic pattern (Meadows) underlies this thread?
- frames_that_surfaced_it: Which of the five frames independently identified this pattern?
  (Threads found by 3+ frames are the most robust)
- conflicts: Any conflicts from the ConflictMap that are central to this thread

Important:
- Prioritize threads that emerge from MULTIPLE frames independently
- The most compelling threads involve UNRESOLVED conflict — the archive genuinely
  doesn't agree, and the audience has to sit with that
- A thread is not a topic (e.g., "immigration"). A thread is a tension
  (e.g., "the promise of belonging vs. the demand to prove you belong")
- Look for threads that NO INDIVIDUAL SOURCE can tell alone — threads that only
  become visible when sources are put in dialogue with each other

{frame_1_output}
{frame_2_output}
{frame_3_output}
{frame_4_output}
{frame_5_output}

User's sense of what this collection is about (if provided):
{user_seed}
```

### Stage 3: Transformation and Meta-Thread Detection

Question clustering finds threads where sources answer the same question. Multi-frame
analysis finds threads defined by recurring tensions. But two important thread types
can slip through both:

**Transformation threads** — defined not by a shared question or tension but by a shared
_movement_ from one state to another. Multiple sources independently undergo the same
transformation, even if they describe it differently.

```
Examine the Pass 1 narrative extractions across all sources, focusing on:
- Stance markers: segments where narrators explicitly describe a before/after
  ("I used to believe... but now I understand...")
- Bookend deltas: where the same question was answered differently at the start
  and end of an interview
- Generational arcs: where a grandparent, parent, and child each represent a
  different stage of the same transformation

For each transformation thread, identify:
- transformation: The before → after movement (e.g., "performing identity → claiming it",
  "anger at ancestors → understanding their choices", "hiding heritage → reclaiming it")
- sources_that_undergo_it: Which sources show this transformation
- evidence: The specific moments where the transformation is visible — quote the
  before-state and the after-state for each source
- question_it_answers: State the transformation as a question
  (e.g., "When did you stop performing your identity and start claiming it?")
- timing: Does the transformation happen within the interview, within a lifetime,
  or across generations?
```

**Meta-threads** — questions that ALL or nearly all sources answer, even though they
answer differently. Because they're universal to the collection, they don't cluster
as a subset — they're the water the fish don't notice.

```
Look across all question constellations and all Pass 1 extractions. Is there a question
that every source in the collection answers, even though they answer it differently?

This is the meta-thread — the question the COLLECTION answers that no individual
testimony answers alone. It often maps to the project's founding question (for
American Stories: "How did your family become American?" / "What does it mean to be
American?") but the collection's actual meta-thread may be more specific or surprising.

For each meta-thread, provide:
- meta_question: The question every source answers
- why_its_invisible: Why this thread doesn't emerge from subset-based clustering
- spectrum_of_answers: Map each source to its position on the spectrum of answers,
  from one pole to the other
  (e.g., "America as aspiration" ←→ "America as imposition", with each source placed)
- what_the_collection_says: The composite answer that only emerges when all sources
  are heard together — the thing no individual testimony can say
```

After Stage 3, merge all findings: Question Threads from Stage 1, frame-based threads
from Stage 2, transformation threads and meta-threads from Stage 3. Deduplicate —
some will overlap. The strongest threads are those found by multiple stages independently.

---

## Pass 3: Storyline Candidate Generation

For each strong narrative thread from Pass 2, generate a storyline candidate — a
fully-formed proposal for a story this collection could tell.

### Storyline Generation Prompt

```
You are composing a storyline candidate from a narrative thread identified across an
oral history collection.

Thread:
{thread_summary}

Supporting segments (with extractions):
{segments_with_extractions}

Conflicts central to this thread:
{relevant_conflicts}

Entity connections relevant to this thread:
{relevant_entities_and_relationships}

Generate a STORYLINE CANDIDATE with these components:

1. **Dramatic question**: The single question the audience needs answered. Write it as
   a question someone would genuinely want to know the answer to.
   Example: "What does America demand you give up in order to belong — and what happens
   when the next generation wants it back?"

2. **Transformation hypothesis**: What belief or understanding shifts across this material?
   State it as a before→after:
   Example: "From assimilation as the price of survival → reclamation as the form resistance
   takes when survival is no longer in doubt"

3. **Question sequence**: Express the storyline as a series of 5-8 questions the story
   answers, in narrative order. This is the story expressed as curiosity — it should feel
   like a conversation the audience is being led through.
   Example:
   - "What did these families have before America took it?"
   - "Why did some choose to comply and others to resist?"
   - "What was the cost of each choice — and who paid it?"
   - "What did the next generation inherit?"
   - "What are they bringing back, and what is lost forever?"

4. **Evidence map**: For each question in the sequence, list the specific segments
   (by ID) that answer it, noting which source each comes from. This shows the user
   exactly which moments from their archive build this story.

5. **Conflict spine**: The unresolved tensions that give this storyline its energy.
   Reference specific conflicts from the ConflictMap. A storyline without conflict is
   a report, not a story.

6. **Entity anchors**: Key people, places, events, and institutions from the EntityGraph
   that anchor this storyline in specificity.

7. **Gap analysis**: What is MISSING from this storyline?
   - What questions in the sequence have weak or missing evidence?
   - Whose perspective is absent? (Name the type of person, and if possible the specific
     person, who should be interviewed next)
   - What would you ask them? (Provide 2-3 specific interview questions)
   - What documents, images, or data would strengthen this storyline?

8. **Strength assessment**:
   - How many sources contribute? (more = more robust)
   - How many frames independently surfaced this thread? (more = more robust)
   - Is the conflict spine genuinely unresolved, or does one reading clearly dominate?
   - Does this storyline tell something the collection uniquely can tell, or is it a
     story anyone could tell without these specific sources?

Rank your confidence in this storyline: HIGH (compelling, well-evidenced, unique to this
collection), MEDIUM (interesting but needs more material or has a weak conflict spine),
LOW (worth noting but not yet a story).
```

---

## Output Format

### NarrativeThreads

```json
{
  "threads": [
    {
      "thread_id": "thread_001",
      "thread_name": "The Cost of Belonging",
      "core_tension": "the promise of belonging vs. the demand to surrender identity as the price of admission",
      "sources_involved": ["sarah_adams", "george_takei", "karen_matsuoka", "akir_gutierrez", "heidi_mathers"],
      "supporting_segments": [
        "sarah_adams__seg_003",
        "sarah_adams__seg_008",
        "george_takei__seg_022",
        "george_takei__seg_028",
        "karen_matsuoka__seg_002",
        "karen_matsuoka__seg_015",
        "akir_gutierrez__seg_003",
        "heidi_mathers__seg_009"
      ],
      "temporal_arc": "CYCLIC — each generation faces the same tension in a different form; the arc across the collection moves from coerced assimilation to voluntary reclamation",
      "key_voices": ["Sarah Adams", "George Takei", "Karen Matsuoka", "Akir Gutierrez"],
      "system_dynamic": "Cultural identity as a stock that was deliberately depleted as survival strategy; the cost becomes visible only when the next generation tries to draw on it and finds it empty. The feedback loop: external threat → suppress identity → survive → children lose cultural foundation → grief and reclamation.",
      "frames_that_surfaced_it": ["identity_formation", "loss_and_adaptation", "systemic_dynamics", "power_dynamics"],
      "conflicts": ["conflict_001", "conflict_002"]
    }
  ]
}
```

### StorylineCandidates

```json
{
  "candidates": [
    {
      "storyline_id": "storyline_001",
      "thread_id": "thread_001",
      "dramatic_question": "What does America demand you give up in order to belong — and what happens when the next generation wants it back?",
      "transformation": "From assimilation as survival → reclamation as resistance",
      "question_sequence": [
        {
          "question": "What did these families have before the demand to assimilate?",
          "evidence": [
            {
              "segment_id": "karen_matsuoka__seg_002",
              "source": "karen_matsuoka",
              "note": "Terminal Island as furusato — Japanese and American identities coexisting without conflict"
            },
            {
              "segment_id": "sarah_adams__seg_040",
              "source": "sarah_adams",
              "note": "Choctaw creation story of Nanih Waiya — identity rooted in the land itself"
            }
          ]
        },
        {
          "question": "What forced the choice — assimilate or be destroyed?",
          "evidence": [
            {
              "segment_id": "george_takei__seg_005",
              "source": "george_takei",
              "note": "Soldiers with bayonets at the family home"
            },
            {
              "segment_id": "sarah_adams__seg_022",
              "source": "sarah_adams",
              "note": "Boarding schools designed to eliminate indigenous identity"
            },
            {
              "segment_id": "karen_matsuoka__seg_005",
              "source": "karen_matsuoka",
              "note": "48 hours to evacuate Terminal Island"
            }
          ]
        },
        {
          "question": "Why did some choose to comply and others to resist?",
          "evidence": [
            {
              "segment_id": "george_takei__seg_012",
              "source": "george_takei",
              "note": "Father chose participation — 'we the people have to participate'"
            },
            {
              "segment_id": "karen_matsuoka__seg_008",
              "source": "karen_matsuoka",
              "note": "Grandfather chose refusal — 'the patriotic thing is to call it out and to resist'"
            }
          ]
        },
        {
          "question": "What was the cost of each choice — and who paid it?",
          "evidence": [
            {
              "segment_id": "sarah_adams__seg_008",
              "source": "sarah_adams",
              "note": "Grandpa Pop's assimilation meant children lost language and culture"
            },
            {
              "segment_id": "karen_matsuoka__seg_012",
              "source": "karen_matsuoka",
              "note": "Grandfather's resistance meant 11 years fighting to regain citizenship"
            },
            {
              "segment_id": "akir_gutierrez__seg_003",
              "source": "akir_gutierrez",
              "note": "Hiding indigenous identity to prove American credentials"
            }
          ]
        },
        {
          "question": "What did the next generation inherit — and what did they discover was missing?",
          "evidence": [
            {
              "segment_id": "sarah_adams__seg_010",
              "source": "sarah_adams",
              "note": "'God, we could just almost reach out and grab it' — the language was one generation away"
            },
            {
              "segment_id": "akir_gutierrez__seg_003",
              "source": "akir_gutierrez",
              "note": "Six years ago, finally owning his indigeneity after a lifetime of denial"
            }
          ]
        },
        {
          "question": "What are they bringing back, and what is lost forever?",
          "evidence": [
            {
              "segment_id": "sarah_adams__seg_035",
              "source": "sarah_adams",
              "note": "Blue learning Choctaw language, the reclamation generation"
            },
            {
              "segment_id": "sarah_adams__seg_009",
              "source": "sarah_adams",
              "note": "'I think he would be proud that we are in a time now that we can bring it back'"
            }
          ]
        }
      ],
      "conflict_spine": ["conflict_001", "conflict_002", "conflict_003"],
      "entity_anchors": [
        "Tule Lake",
        "Terminal Island",
        "Goodland Boarding School",
        "Executive Order 9066",
        "Questions 27 and 28",
        "Indian Child Welfare Act",
        "American Indian Religious Freedom Act (1978)"
      ],
      "gap_analysis": {
        "weak_evidence": "The 'why did some comply and others resist?' question is well-covered for Japanese Americans but needs more voices from other communities. The Choctaw/Cherokee perspective on this specific question is mostly about boarding school compliance vs. the Adams family's later reclamation — we don't have a Choctaw voice who actively resisted in the boarding school era.",
        "missing_perspectives": [
          "Someone who chose assimilation and does NOT regret it — the archive is weighted toward reclamation",
          "A descendant of the people who enforced the assimilation (a boarding school administrator's family, a WRA official's descendant)",
          "A younger-generation person who is ambivalent about reclamation — not everyone feels the pull to recover what was lost"
        ],
        "suggested_interviews": [
          {
            "who": "A Japanese American who served in the 442nd — someone whose family answered Yes-Yes and sees that as the heroic choice",
            "questions": [
              "Did you ever question whether compliance was the right response?",
              "How do you feel about the No-No boys being called heroes now?",
              "What did it cost your family to prove your loyalty through service?"
            ]
          },
          {
            "who": "An elder Choctaw first-language speaker who went through a boarding school",
            "questions": [
              "What did you hold onto that they tried to take?",
              "Do you see the young people learning the language now? What do you want them to know about what it cost to keep it alive?",
              "When people say the boarding schools 'weren't that bad,' what do you want to say to them?"
            ]
          }
        ],
        "missing_documents": "Court records from Judge Goodman's ruling in the Matsuoka grandfather's case; photos from Terminal Island before the raids; the actual text of Questions 27 and 28"
      },
      "strength": {
        "source_count": 5,
        "frames_count": 4,
        "conflict_genuine": true,
        "unique_to_collection": true,
        "confidence": "HIGH"
      }
    }
  ]
}
```
