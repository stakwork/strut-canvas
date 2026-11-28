# stadeum/canvas

The Infinite Canvas as a strut package: a canvas where a team plans
initiatives and brainstorms the decisions in them, with Jamie beside it.

- **The app** (`apps/canvas`, `stadeum/canvas/canvas`): the initiatives in
  progress ringed round the centre; each opens into a road through its
  milestones with their features beside it, why it exists on a sheet
  beside it (brief, stories, requirements), its brainstorms as trees of
  decisions, and what each feature's jobs built. Jamie is docked beside the
  map.
- **`canvas`** (`workflows/canvas.yaml`): the one workflow a Canvas Planning
  job writes through. No model runs in it: the job agent decides, it checks
  and writes. Modes: `read`, `write` (a typed plan), `brainstorm` (a draft of
  questions and options, checked whole before anything is written).
- **`ops`**: a person's act from the app (add, edit, set a status, remove,
  restore, accept or drop a requirement, choose an option), one run each, as
  the viewer.
- **`implement`**: starts a Code Change job on a feature that has an
  architecture, and records the job on the feature so its card shows the
  build.
- **The pages** (`concepts/`): Canvas Planning (a job kind, under Job),
  Brainstorm, Brainstorm Method, Brainstorm Framing, Call Canvas (the
  scribe of a recorded call) and Call Summary under it. They are what the
  job agent, Jamie and the summary's model read; change how they plan and
  write there, not in code.

## Recorded calls

A group call recorded on a box is a `call-…` job (the scribe, a Call
Canvas job, which writes the cards). Beside it, in that job's files:

| File | Written by | Holds |
| --- | --- | --- |
| `transcript.jsonl` | `transcript-append`, called by the voice service with each batch | one line per thing said: `{ n, at, speaker, identity?, source, text }` |
| `transcript.end` | `transcript-append { end: true }` | the recording stopped |
| `call.json` | `transcript-append`, with each batch | who spoke (never Jamie), from when to when, how many lines |
| `summary.json` | `call-summary`, the last step of `summarize` | title, discussed, decided, action items by person, open questions |

- **`summarize`** (`workflows/summarize.yaml`): one model call over the
  transcript. It starts by itself when a recording stops (the first
  `end: true`), and from Summarize on a call that has none. How a summary
  is written is the **Call Summary** page; the workflow keeps the reads,
  the shape and the rule that the transcript is data.
- **The Calls page** (the app's Calls button, or `view=calls` in its
  link, with `call=<job>` to open on one): every recorded call, newest
  first, with who spoke and how long, its summary, and its transcript one
  click away. It reads `calls`, which reads the two small files per call
  and never a transcript.

### Lingo: correcting a word in a transcript

Right-click a word in a call's transcript (or select a few and
right-click) to say what it should have been. The pair goes into the
server's vocabulary, the one strut's dictation uses (`dictation/add`: the
word, and how it was heard), and every line of every call is shown with
that vocabulary's corrections (`memory/lexicon`), each marked and showing
what was heard. Undo on the toast takes the last one back
(`dictation/undo`). The app keeps no type of its own for this. On a
server whose strut keeps no vocabulary the transcript is plain text and
there is nothing to right-click.

## The graph

| Type | Holds | Links |
| --- | --- | --- |
| Initiative | the goal; status, blocked | HAS_BRIEF, HAS_STORY, HAS_MILESTONE |
| Milestone | a stage, by `sequence` | HAS_FEATURE |
| Feature | a piece of the solution; `jobs` started on it | SATISFIES Requirement, HAS_ARCHITECTURE |
| Brief | why the initiative exists | |
| UserStory | a story, as text | HAS_REQUIREMENT |
| Requirement | proposed, accepted or dropped | |
| Architecture | how a feature is built; optional mermaid `diagram` | |
| Question | a decision; open or decided | PARENT_OF Option or Question, ABOUT a plan card |
| Option | an answer; chosen or not, `recommended`, `fast`/`good`/`cheap`, `makes` | PARENT_OF a follow-up Question, HAS_EFFECT |
| Effect | what choosing an option causes, `score` -1..1 | AGAINST a Requirement |

Statuses of an initiative, milestone or feature: `planned`, `active`,
`done`, `dropped`, with a `blocked` flag beside them. A removed card keeps
its place in the graph (`removed_at`) with everything under it, so it can
be restored; every reader leaves it out. Every step reaches the graph
through strut's own `graph/*` steps, so the package runs on Neo4j and on a
LadybugDB file alike, and every write shows in strut's change feed.

## Working on it

On a box, open this repository as a package repo (strut's Packages page:
Open repo) and build there, with Jamie or by hand. Commit pushes the
workflows, steps, app and pages back here; tick "Push straight to main" to
skip the pull request. Edits made here come back with Pull. Graph types
(`graph/`) and `strut.yaml` are edited here.

## Testing

```bash
STRUT_DIR=../strut npm test
```

installs the package into a strut started from a checkout of
stakwork/strut (with its install) on a LadybugDB file, and drives the
`canvas`, `ops` and `implement` workflows, a recorded call (lines appended
as the voice service sends them, its list entry, its summary kept) and the
app's reads. No model runs in it. CI runs the
same on every pull request. `promote.yml` moves `stable`, the branch boxes
follow, to a commit of main whose checks passed.

## Where it came from

swarm38's `brainstorm-canvas` app (v71), its `canvas`, `canvas-ops` and
`canvas-implement` workflows and the 19 steps they reach, cut down to what
runs: Hive's type names and statuses, the org id, the legacy `Choice` type,
the fast/good/cheap nodes (now numbers on the option), the "(recommended)"
text suffix (now a field) and the raw Neo4j queries are gone.
