// What a presented canvas follows (./present.ts), the pure part: the cards on
// the canvas, which card a new one is shown as, and whether it is following or
// a person is looking around.
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

/** A presented canvas following the job, or a person looking around it (in a call tile, where it is the page itself
 *  and not a video of it). */
export interface Following {
  /** New cards are brought to the middle. Off once a person looks around, until they press Follow. */
  on: boolean;
  /** The newest card written, followed or not. */
  newest: string | null;
  /** The card to bring to the middle: `n` moves on each time. */
  target: { id: string; n: number } | null;
}

export const FOLLOWING: Following = { on: true, newest: null, target: null };

/** A card written (followed only while following), a person looking around, or Follow pressed (back to following, at
 *  the newest card). */
export type FollowEvent = { wrote: string } | "look" | "follow";

export function follow(s: Following, e: FollowEvent): Following {
  const to = (id: string | null) => (id ? { id, n: (s.target?.n ?? 0) + 1 } : s.target);
  if (e === "look") return s.on ? { ...s, on: false } : s;
  if (e === "follow") return s.on ? s : { ...s, on: true, target: to(s.newest) };
  return { ...s, newest: e.wrote, target: s.on ? to(e.wrote) : s.target };
}

/** What a person does to a presented page that means they are looking around: a wheel (a scroll or a zoom), a drag
 *  (a pan, a pinch, a scroll by touch), or a press on a card, a question or a story. A press on the desk that does not
 *  move is not one, nor anything on `except` (the Follow button). Nobody does any of these to the call's video.
 *  Calls `look` each time; returns the way to stop listening. */
export function watchLooking(el: EventTarget, look: () => void, except = ".sb-follow"): () => void {
  const at = new Map<number, { x: number; y: number }>();
  const target = (e: Event) => e.target as Element | null;
  const theirs = (e: Event) => !target(e)?.closest?.(except);
  const on: Record<string, (e: Event) => void> = {
    pointerdown: (e) => {
      const p = e as PointerEvent;
      if (theirs(e)) at.set(p.pointerId, { x: p.clientX, y: p.clientY });
    },
    pointermove: (e) => {
      const p = e as PointerEvent;
      const from = at.get(p.pointerId);
      if (!from || Math.hypot(p.clientX - from.x, p.clientY - from.y) < 4) return;
      at.delete(p.pointerId);
      look();
    },
    pointerup: (e) => at.delete((e as PointerEvent).pointerId),
    pointercancel: (e) => at.delete((e as PointerEvent).pointerId),
    wheel: (e) => theirs(e) && look(),
    click: (e) => !!target(e)?.closest?.("button, a, [role=button]") && theirs(e) && look(),
  };
  for (const [type, f] of Object.entries(on)) el.addEventListener(type, f, { capture: true, passive: true });
  return () => {
    for (const [type, f] of Object.entries(on)) el.removeEventListener(type, f, { capture: true });
  };
}
