---
name: Brainstorm Method
description: "How to write a good brainstorm tree: one decision per question, options that exclude each other, criteria and reversibility, the person's own words, and grounding in what the graph already knows."
parents:
  - Brainstorm
---
How to write the questions and options of a brainstorm tree. The agent that writes the tree reads this page before every turn.

## Questions

- A question asks for one decision. If the text holds two decisions, write two questions.
- When a topic holds several decisions, the root names the topic or goal. Each decision becomes a sub-question directly under the root.
- A sub-question is a decision that stands on its own: it makes sense whichever option is chosen elsewhere.
- A list of work items is not one question. Find the decisions behind the items, and write each as a sub-question.
- When the text holds only one decision, and the framing check shows that it is at the right level, the root is that decision, with options directly under it. If the decision is one solution to a higher goal, the root is the goal. See Brainstorm Framing.
- On every question, set `criteria`: the two to four things that decide it, such as cost, risk, recovery or speed.
- On every question, set `reversibility`. Use `one_way` when a choice is hard to undo once shipped or used, for example a key scheme, a data format or a public contract. Use `two_way` otherwise.

## Options

- The options under one question exclude each other. Choosing one means not choosing the others.
- Write two to four model options. The person's own options do not count toward that number. When the person already named both obvious answers, still add options of your own: a third way, a staged path, or a way to defer the decision.
- An option names one alternative in a short line. It does not also decide a later question.
- Do not repeat an option that already exists under the same question in other words.
- Recommend at most one option per question, and only when the effects and ratings support it: the recommended option's effects and ratings must actually be the best on the question. Otherwise do not recommend. End its text with "(recommended)", for example "VPN access (recommended)". Recommending is not choosing: the option stays open, and the person still chooses on the card. Never mark a person's own option as recommended in their words; say it in the reply instead.
- A new option's `state` is `open`. Use `simulated` only when the person asked to explore speculatively.

## Sizing a turn

- A first turn: a root question, then its sub-questions and options.
- Expand: one follow-up question under the option, with about two answers.
- More options: about two more answers under the same question.

## Effects

- Every option you write in a turn gets at least one effect. This includes the person's options.
- An effect is one result of choosing that option, weighed against one named requirement of the initiative. Link it `-AGAINST->` that Requirement. Read the requirements first. Prefer accepted ones. Never use a dropped one.
- Give the effect a short `name` and a one-sentence `description`. It is not the option said again, and it does not decide another question.
- Set `score` from -1 to 1: how much choosing the option serves (above 0) or hurts (below 0) that requirement. Scores are absolute, not relative to other options.
- When an option has a real cost and a real gain, write both. Do not make up a con or a pro only to balance the list.
- The same effect on the same requirement has the same score on every option where it appears.
- Effects on the person's options are yours. They have `made_by: model`. Never present them as the person's words.

## Ratings

- Every option you write gets `ratings`: `fast`, `good` and `cheap`, each from -1 to 1.
- Fast: how soon it can ship. Good: the quality of the result. Cheap: how little effort and cost it takes.
- Scores are absolute.

## makes

- At an initiative brainstorm, `makes` lists the milestones that the answer would create, in order.
- At a milestone brainstorm, it lists the features that the answer would create.
- At a feature brainstorm, it is `[]`.
- Each name is what the card will be called. Keep it short. Do not repeat a name that already exists under that parent.

## Follow-up questions

- A follow-up question goes under the option it depends on. It must only make sense if that option is chosen.
- A question that applies whatever option is chosen is a sub-question of the question above. Write it there, not under one option.

## Choosing

- Do not choose an option for a person. Choosing is a person's act, on the card. On a recorded call, record the choice a person says aloud, in their words (**Brainstorm**).
- To go deeper under an answer, write a follow-up question (Expand). To widen a question, add answers (More options).
- When a question is decided, do not reopen it. Point the person to the next open question in the tree.

## The person's options

- Every option the person stated becomes an option with `made_by: user` and their exact words as `quote`.
- Set `speaker` when the text names who said it.
- Never mark a model option as the person's.

## Cards a person wrote by hand

A person can write a question or an option straight onto the canvas, outside a run. Such a card has `made_by: user`, and no `job`, `run_id` or `turn`. It usually has no `quote`, because its `text` is already the person's own words.

- Treat its `text` as the person's own words. Do not reword it, merge it, move it or remove it unless the person asks.
- It counts as one of the person's options, not one of yours. Do not add a model option that says the same thing in other words.
- If the card breaks a rule on this page, for example two decisions in one question, keep it as it is. Say so in the reply, and suggest the fix.
- A card can appear between two turns. Read the whole tree each turn, and build on what is there.

## Grounding

- Before you write, read what the graph says about the company's direction (search for it), the card the question is `about`, and the initiative's requirements.
- Options must not contradict the stated strategy. If an option does, say so in its text.
- When the text refers to an earlier design or decision, search the graph for it. Ground the options in what it says, and do not reopen a choice it has already settled.

## Self-check before you send

No auditor reviews the draft after you; code checks only its structure. Before sending, go through this page rule by rule against each new node.

- A rule is broken only when a new node clearly does what it forbids, or clearly omits what it requires.
- Taste, wording, and a 0.1 to 0.2 score difference for the same effect are not breaches. Do not rewrite for them.
- Fix every clear breach before you send.

## Related

- Brainstorm Framing
- Brainstorm, Canvas Planning
