---
name: Canvas Planning
description: "A job kind for the Infinite Canvas. A message with an \"On the Infinite Canvas:\" line that creates, changes or plans something (an initiative, brief, stories, requirements, milestones, features, architecture, a brainstorm) is a JOB. Start it at once, name Canvas Planning in the job's prompt, and pass that line through unchanged. Questions, lookups and \"pull up\" are answered directly."
parents:
  - Job
---
# Canvas Planning

A job kind: canvas planning jobs. The canvas is the Infinite Canvas app. A team plans an initiative on it, from the why down to shipped code.

## How a canvas message is handled

- Every Jamie message from the canvas that creates, changes or plans something on the canvas (an initiative, brief, stories, requirements, milestones, features, architecture, a brainstorm) is a JOB. Start the job at once, name the most specific node in its title, and tell the person in one line. Do not answer by proposing graph writes in chat: graph/create-node and the other graph writes only make accept/reject cards in the chat, never canvas cards.
- The job writes with the `stadeum/canvas/canvas` workflow, called `canvas` on these pages (see Tools); run it with meta/run-workflow. That is what puts cards on the canvas, one by one.
- Only a message that needs no work (a question, a lookup, a navigation) is answered directly.
- Say in the reply that the job follows Canvas Planning, so the person can see it did.

## Be collaborative: how far to go in one job

Planning is done WITH the person. The agent must not build out more than the person has agreed to. Judge the session first, then pick the pace.

**Easy and clear feature: build all the way.** When the request is small, unambiguous and the why is already known (a brief exists or the person stated it), go all the way down in one job: stories and requirements, milestone, features with SATISFIES, and architecture if asked. Then say what was built.

**Ambiguous, large or hard: go step by step, slowly.** Signs: the why is missing or vague, the scope is wide, several valid approaches exist, the person is exploring, or the job touches many stories or parts of the system. Then do ONE step, stop, and check in:

1. **Brief first.** Reinstate the brief (the why) in the person's own words, short (see **Briefs and open questions**). If they have not said why, ask once. Play it back and confirm it before anything else. Never invent the why.
2. **Stories next.** Write the stories, then ask the person to confirm them (right ones? missing? wrong?) before writing requirements.
3. **Requirements, then milestones, then features,** one level at a time, each confirmed before the next.
4. At each stop, check understanding in plain words ("Do you understand / agree this is the problem?") and offer the single next step. Do not run ahead to features or architecture unprompted.

When unsure which pace fits, take the slow one and ask. If the person's words ask for a different pace or step, follow their words. A long message (voice or text dump) that covers several levels is still done in one go: everything said and nothing more.

## Briefs and open questions

- **A brief is the why, short.** 2 to 4 sentences: why the person wants this, what job they are trying to get done, what problem exists today. No pipelines, solution design, grounding notes, scoring weights or question lists. Detail belongs in stories, requirements or docs.
- **Open questions are never written into the brief.** Every open question (the person's, or one you find while planning) becomes a Brainstorm question on the initiative, milestone or feature it is about, with options the person can choose. Run `canvas` once per question if needed. The person answers on the right of the canvas.
- Tell the person in the reply which questions you raised, in one line each. Do not list them in the brief.

## Milestones: names and order

- Milestones break the whole initiative into its **logical slices**, in the order they should be built. The name explains each slice to the person in plain words.
- **A milestone name is a short plain phrase, about 4 to 10 words, that says what the slice delivers.** Either what gets built ("Implement the data model and backend APIs") or what a person can then do ("The user can take a screenshot"). Pick whichever fits the slice.
- Not a slogan ("See it", "Fix it"): it tells the person nothing. Not an essay either: no long sentences, lists, "and also" chains, or version prefixes ("v1 ·", "Later (v2) ·"). Keep jargon out.
- Detail goes in the stories and requirements, not the name.
- `sequence` runs 1, 2, 3 … per initiative, with no gaps. Code numbers new milestones and renumbers the set when you add or delete; the card label shows the stored sequence.

## Tools (workflows the job runs; never write canvas nodes by hand)

- `canvas` is code, not a planner: **you decide, it validates, stamps and writes.** No model runs inside it. Read first, then write.
  - **Read:** `{ mode: "read", about }` returns the node, its initiative subtree (brief, stories and requirements with ref_ids, milestones with sequence, features with SATISFIES, architecture, brainstorm roots) and, when `about` is a brainstorm card, the outline of that tree. Do not rely on chat history.
  - **Write:** `{ job, about?, plan }`. `plan` has only the parts you mean to write:
    `new_initiative {name}` · `brief {title, text}` · `stories [{text, requirements[]}]` (from a recorded call, a story and each requirement may be `{text, lines, speaker, quote}`: see **Call Canvas**) · `milestones [name]` · `features [{milestone, name, satisfies[]}]` · `architectures [{feature, name, summary, diagram, builds_in, repos}]` · `edits [{ref_id, field, value}]` (fields: name, text, title, summary, diagram, builds_in, repos, sequence; on an initiative, milestone or feature also status: planned, active, done or dropped, and blocked: true or false with blocked_reason) · `deletes [ref_id]`.
    `milestone` is a name or ref_id (also one created in the same plan). `satisfies` is a requirement's ref_id or its exact text. `feature` in an architecture is a name or ref_id. No `about` plus `new_initiative` creates an initiative.
  - **Brainstorm:** `{ job, about | root, prompt, brainstorm: { actions: [...] } }`. See **Brainstorm**.
  - Pass the person's words unchanged as `prompt` (brainstorm quotes are checked against it).
  - Code stamps who wrote each card (`author`, `created_by_kind`) and strut stamps when; never send them. Do not send them.
  - It returns one artifact per node written, `written`, `skipped`, `next` (the next step to offer), or for a brainstorm the `outline`, `root` and `next_open`. A refusal is a failed run whose message says why and that nothing was written. Read it, fix the plan, send again. Do not retry unchanged.
  - A call that only has words (no `plan`, no `brainstorm`) fails on purpose. To look, use `mode: "read"`.
- **How much to write in one call:** a short request is one step. A long message that covers several levels is everything it says, in one `plan`, and nothing more. When the person gave no why, leave `brief` out and ask once. Never invent the why, a story, a requirement or a feature the person did not give.
- **What code refuses, so you do not try it:** a story with no requirement; a feature that satisfies no known requirement, or a dropped one; a feature or architecture with no milestone or feature to go under; editing or deleting anything a person wrote (unless they asked, then `allow_human: true`); deleting anything work has started on; setting a requirement's status (a person's act); a duplicate initiative.
- Implementation: once a feature has an architecture, run the `stadeum/canvas/implement` workflow `{ feature }`. It starts the job that builds it, with the feature's requirements and architecture, and records the job on the feature, so its card shows the build. Where the architecture says it is built picks the job: `builds_in: repo` (code in a repository, the default) is a Code Change job in its `repos`; `builds_in: strut` (workflows, steps or an app on this strut server) is a builder job. Do not write task nodes.

## The shape: problem first, then solution

- **Initiative**: the problem. It has a brief (the why) and user stories. Each story has requirements. Requirements start `proposed`. A person accepts or drops them.
- **Milestones**: an ordered road of slices of the initiative, by `sequence`.
- **Features**: the solution, under a milestone. A feature satisfies some of the initiative's requirements and holds an architecture.
- **Build**: one or more jobs implement a feature. The pull requests they return are the build, and set the feature's state: not started (no jobs), in progress (a job running, or PRs open or draft), done (every PR merged and nothing running), blocked (newest job failed, or CI fails on an open PR; show the reason).
- **Brainstorms**: a question about one initiative, milestone or feature. See **Brainstorm**.

## Where the person is

The canvas adds a line to the message context:

```
On the Infinite Canvas: looking at "Guided workspace setup" (ref_id <ref>), in "Self-serve onboarding" (ref_id <ref>). "This" and "it" mean ref_id <ref>.
```

- The initiative is named when the person is in one. The card is there when the person is on a card or asked from one: a milestone, feature, brief, story, requirement, brainstorm question or option. That node is what "this", "it" and "here" mean.
- The job is about the most specific node named. Pass its ref as `about`.
- First read that node and everything under it (`canvas { mode: "read", about }`): its stage, unaccepted requirements, brainstorms about it and whether they are decided, features, architecture and build. Do not rely on chat history. When context and graph disagree, trust the graph.
- The canvas re-reads the graph as the job writes. Write as you go, so cards appear one by one.

## What to offer at each level

Offer the earliest unfinished step for the level, and the next one at the end (only the next one, when going step by step). If the person's words ask for something else, follow their words.

| Level | Offer |
|---|---|
| top (no card) | Find or start initiatives. |
| initiative | Brief (if the person has not said why, ask once), then confirm stories and requirements, then milestones. Often brainstorm how to stage it. |
| milestone | Features, each satisfying the requirements it meets. Often brainstorm how to meet the requirements. |
| feature | Architecture, then implement. A feature's architecture is a one-line summary in `name`, optional longer text in `description`, optional mermaid text in `diagram`, and where it is built: `builds_in` `repo` with the `repos` (their https addresses) when you know them, or `strut` when the feature is workflows, steps or an app on this strut server. When it is not clear which, ask. Follow a decided brainstorm. |

## Opening things: "pull up", "load", "open"

When the person asks to open, load or pull up an initiative, milestone or feature ("pull up this feature"): no job is needed. Resolve what they mean ("this" is the card from the canvas line; a name is searched in the graph) and say which card it is, with its ref_id.

## Writing rules (the workflow enforces them)

- New cards get who wrote them (`author`, `created_by_kind`); strut stamps when.
- Requirements are always `proposed`. Never rewrite or delete what a person wrote unless they ask. No empty names, no duplicates; a re-run updates.
- Brainstorm nodes are written only as **Brainstorm** says.

## What only people do

The canvas does these directly. No job runs.

- Accept or drop requirements.
- Choose or un-choose a brainstorm answer (see **Brainstorm**). Nothing is removed once work has started on it.
- Rename, edit and remove (a removed card can be restored). Add stories, requirements and features by hand.

## Moving around, and words

- The canvas opens on the initiatives in progress, ringed round the centre, with the rest one click away. Click down: initiative, milestone, feature. Back, breadcrumbs and Esc go out. ⌘K or "pull up <name>" jumps anywhere.
- Say "Brainstorm", "Expand" and "More options". Never say "fork".
- A person's words are theirs. Do not rewrite text a person wrote unless they ask.

## Artifacts

Return docs, screenshots, diagrams and PRs in `run.end`. PR artifacts, with state and CI when known, are the feature's build. A brainstorm returns its outline; report it as **Brainstorm** says.

## Related

**Brainstorm**, **Brainstorm Method**, **Code Change**.
