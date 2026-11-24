// What a presented canvas follows (./present.ts), the pure part: the cards on
// the canvas, and which card a new one is shown as.
import type { Plan } from "./plan";
import type { Brainstorms } from "./brainstorm";

/** The card a written ref is shown as: a plan card, a question, or the question an option answers. */
export function shownAs(ref: string, plan: Plan | undefined, b: Brainstorms | undefined): string | null {
  if (plan?.cards[ref] && !plan.cards[ref]!.pencil) return ref;
  if (b?.asks[ref]) return ref;
  if (b?.choices[ref]) {
    const ask = Object.values(b.asks).find((a) => a.options.includes(ref));
    if (ask) return ask.id;
  }
  return null;
}

/** Every card on the canvas a write can add: plan cards (not proposals), questions and their options. */
export function cardsOn(plan: Plan, b: Brainstorms): Set<string> {
  const out = new Set<string>();
  for (const [id, c] of Object.entries(plan.cards)) if (!c.pencil) out.add(id);
  for (const id of Object.keys(b.asks)) out.add(id);
  for (const id of Object.keys(b.choices)) out.add(id);
  return out;
}
