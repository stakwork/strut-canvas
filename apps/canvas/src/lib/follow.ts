// What a presented canvas follows (./present.ts), the pure part: the cards on
// the canvas, and which card a new one is shown as.
import type { Plan } from "./plan";
import type { Brainstorms } from "./brainstorm";
import type { Why } from "./why";

/** The card a written ref is shown as: a plan card, a question, the question an option answers, or a brief, story or
 *  requirement (on its initiative's Why sheet). */
export function shownAs(ref: string, plan: Plan | undefined, b: Brainstorms | undefined, why?: Why): string | null {
  if (plan?.cards[ref] && !plan.cards[ref]!.pencil) return ref;
  if (b?.asks[ref]) return ref;
  if (b?.choices[ref]) {
    const ask = Object.values(b.asks).find((a) => a.options.includes(ref));
    if (ask) return ask.id;
  }
  if (why && (why.stories[ref] || why.requirements[ref] || Object.values(why.briefId).includes(ref))) return ref;
  return null;
}

/** Every card on the canvas a write can add: plan cards (not proposals), questions and their options, and what is
 *  on the Why sheets. */
export function cardsOn(plan: Plan, b: Brainstorms, why?: Why): Set<string> {
  const out = new Set<string>();
  for (const [id, c] of Object.entries(plan.cards)) if (!c.pencil) out.add(id);
  for (const id of Object.keys(b.asks)) out.add(id);
  for (const id of Object.keys(b.choices)) out.add(id);
  if (why) for (const id of [...Object.keys(why.stories), ...Object.keys(why.requirements), ...Object.values(why.briefId)]) out.add(id);
  return out;
}

/** The options chosen: a choice recorded while the canvas is shown is brought to the middle like a new card. */
export function chosenOn(b: Brainstorms): Set<string> {
  return new Set(Object.values(b.choices).filter((c) => c.state === "chosen").map((c) => c.id));
}

/** The initiative a brief, story or requirement belongs to, and the story to open on its Why sheet. Null for anything
 *  else. */
export function whyPlace(ref: string, why: Why): { goal: string; story: string | null; requirement: string | null } | null {
  const req = why.requirements[ref];
  const story = req ? req.story : why.stories[ref] ? ref : null;
  if (story) {
    const goal = Object.keys(why.byGoal).find((g) => why.byGoal[g]!.includes(story));
    return goal ? { goal, story, requirement: req ? ref : null } : null;
  }
  const goal = Object.keys(why.briefId).find((g) => why.briefId[g] === ref);
  return goal ? { goal, story: null, requirement: null } : null;
}
