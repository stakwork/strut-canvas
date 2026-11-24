---
name: Brainstorm
description: "A job kind: a question about one initiative, milestone or feature, with answers weighed against the initiative's requirements and rated fast, good and cheap, grown turn by turn by the job agent and written through the canvas workflow."
parents:
  - Canvas Planning
---
A job kind: a brainstorm is a Question ABOUT one initiative, milestone or feature. Its answers are Options. The job agent grows the tree turn by turn and writes it through the `canvas` workflow (`stadeum/canvas/canvas`).

## The tree

- `Question`: something to decide. Its `state` is open or decided.
- `Option`: one answer to a question. Its `state` is open, chosen, rejected or simulated.

Every node has `made_by` (user or model). A user's node can have a `speaker` and a `quote` of their own words.

The tree has three kinds of link, all `PARENT_OF`:

- A question has options under it.
- A question can have sub-questions under it: separate decisions inside the same topic.
- An option can have a follow-up question under it: a decision that only exists if that option is chosen.

An option never sits directly under another option.

`Question -[:ABOUT]-> node` names the initiative, milestone or feature the question is about. Several brainstorms can be about the same node. One is open at a time.

## Effects: pros and cons

`Option -[:HAS_EFFECT]-> Effect -[:AGAINST]-> Requirement`. Each effect is weighed against one named requirement of the initiative.

- `score` on the Effect, from -1 to 1: how much choosing the option serves (above 0, a pro) or hurts (below 0, a con) that requirement. Scores are absolute, not relative to other options.
- `name`: a short label. `description`: one sentence.

## Ratings

`fast`, `good` and `cheap` on the Option, each from -1 to 1, absolute.

## makes

`makes` on the Option is JSON text: a list of the names that choosing the option creates one level down.

- At the initiative: milestones.
- At a milestone: features.
- At a feature: `[]`. Choosing settles the approach that the architecture and implementation follow.

At most 12 names. `makes` says what choosing the option would lead to; choosing does not create those cards. The person, or a Canvas Planning job they ask, writes them.

## Expand and More options

- **Expand**: a follow-up Question under an answer, with about two answers.
- **More options**: about two more answers to the same Question.

## Choosing is a person's act

The person does it on the card. A job does not choose for them.

One exception: on a recorded call nobody can press a card, so the scribe
(**Call Canvas**) records a choice a person says aloud. The draft action is
`{ op: "choose", option, speaker, quote }`: `option` is the option's ref_id,
or the `tmp` of an option added earlier in the same draft. `quote` is the
speaker's exact words, from their own line of the transcript. Anything else
is refused.

- The Option becomes `chosen`. The Question becomes `decided`.
- Un-choosing opens the Option again, and the Question too unless another option under it is still chosen.
- Edit and remove are also a person's card actions.

If a person asks in chat to choose, do not choose. Tell them to choose on the card.

How to write good questions, options, effects, ratings and `makes` is in the child page **Brainstorm Method** and any pages under it. Read that whole tree before every turn.

## Writing a brainstorm turn

Brainstorm when the person asks to brainstorm, to see options, to expand an answer, or for more options.

You write the tree; `canvas` checks its structure and writes it. Never write, change or delete Question, Option or Effect nodes any other way.

- `about` is the card from **Canvas Planning** (the "On the Infinite Canvas:" line): the initiative, milestone or feature. If there is none, search the graph for what the text names. If nothing clearly matches, pass no `about`, and say so.

1. **Read:** `canvas { mode: "read", about }` (or `about` = the card you were asked from). You need the requirement ref_ids it returns, the existing tree outline, and the Method page.
2. **Send:** `canvas { job, about, prompt, brainstorm: { actions: [...] } }`. `prompt` is the person's text, unchanged. `job` is this job's id. For a later turn on a tree, add `root` (the root question's ref_id).
3. **Each action is an add:** `{ op: "add", tmp, parent, kind: question|option, text, made_by: user|model, ... }`.
   - `tmp`: your id ("q1", "o3"), unique in the draft. `parent`: an existing ref_id, a `tmp` added earlier in the draft, or `null` for the root question (first turn only, first action).
   - A question: `criteria` (one string: the two to four things that decide it) and `reversibility` (`one_way` | `two_way`). Nothing else.
   - An option: `makes` (names, or `[]` at a feature), `effects` `[{ name, description, score (-1..1, not 0), requirement (ref_id) }]` (at least one), `ratings` `{ fast, good, cheap }` (each -1..1), and `recommended: true` on at most one model option per question.
   - A person's option: `made_by: "user"`, `quote` = their words verbatim from `prompt`, `speaker` only if the message names who said it.
   - Do not send `created_at`, `created_by`, `author` or any stamp.
4. **Before you send,** check the draft against every rule on **Brainstorm Method**, node by node. Nothing audits it after you; code only checks the structure.
5. **If the call fails** with "the brainstorm draft was refused", the message lists each problem. Fix exactly those and send again. Nothing was written. If it fails after that, the write was rolled back.
6. **It returns** `outline` (the whole tree), `root` and `next_open`. Keep `root` and the root question in `notes/brainstorm.md`, so that a later turn or another job can find the tree.

## Cards people write

People can write questions, options and text edits by hand on the canvas. The canvas saves them, signed with who wrote it (`by`). These cards have `made_by: user` and no `job`, `run_id` or `turn`.

- You do not write them. Do not re-create them through `canvas`.
- They can appear between your turns. Read the tree from the graph every turn.
- A tree can be started by a person, so a root can have no `job`. To grow it, send `canvas` with that root.

## Steering

Labels follow the path: a sub-question gets a number, an option a letter (1, 1A, 1B, 2, 2A).

- "Expand 1B" adds a follow-up question with answers under 1B, and leaves 1B open.
- "More options on 1" adds answers to question 1.
- Choose, deselect and remove are the person's card actions.

Pass the person's words to `canvas` unchanged as `prompt`. A message from a card names the option and its ref_id. Use that as the parent.

Report what `canvas` returns: the gist in one or two sentences, then the outline, then the next open question if there is one.

Never present a model option or a model effect as the person's.

## When a run fails

The deliverable of a brainstorm is the tree in the graph. A file is never the deliverable.

- Do not write the questions and options into a markdown file, a note or an outline as a substitute. `notes/brainstorm.md` holds only the root, the run record and the failure reasons.
- Read the refusal message. Fix the problems it lists and send again. If it keeps refusing, report the problems in plain words and say whether they were the same each time.
- Do not state a cause that no message shows. If you have a theory, mark it as your theory.
- Then ask the person for one decision to start the tree, in their own words, and write it with that text unchanged.

## Related

- **Canvas Planning** (the parent page: the canvas flow, context and writing rules).
