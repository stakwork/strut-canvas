// ⌘K: find any card by its words — initiatives, milestones, features,
// stories, requirements and brainstorm questions — grouped by kind. Pure.
import type { Brainstorms } from "./brainstorm";
import type { Plan, Role } from "./plan";
import type { Why } from "./why";

export type HitKind = Role | "story" | "requirement" | "question";
export interface Hit {
  id: string;
  kind: HitKind;
  text: string;
  /** The card to open for it: the card itself, or the goal a story or requirement belongs to. */
  card: string | null;
}

export const KIND_WORD: Record<HitKind, string> = { goal: "Initiatives", group: "Milestones", work: "Features", story: "Stories", requirement: "Requirements", question: "Questions" };
const ORDER: HitKind[] = ["goal", "group", "work", "question", "story", "requirement"];

/** Each word of the query must appear in the text, any case. Empty finds the goals. */
export function search(q: string, plan: Plan, why?: Why | null, b?: Brainstorms | null, per = 6): Array<{ kind: HitKind; hits: Hit[] }> {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (t: string) => words.every((w) => t.toLowerCase().includes(w));
  const all: Hit[] = [];
  for (const c of Object.values(plan.cards)) if (!c.pencil) all.push({ id: c.id, kind: c.role, text: c.title, card: c.id });
  if (why) {
    const goalOfStory = new Map<string, string>();
    for (const [g, ss] of Object.entries(why.byGoal)) for (const s of ss) goalOfStory.set(s, g);
    for (const s of Object.values(why.stories)) all.push({ id: s.id, kind: "story", text: s.text, card: goalOfStory.get(s.id) ?? null });
    for (const r of Object.values(why.requirements)) all.push({ id: r.id, kind: "requirement", text: r.text, card: r.story ? (goalOfStory.get(r.story) ?? null) : null });
  }
  if (b) for (const a of Object.values(b.asks)) if (a.about) all.push({ id: a.id, kind: "question", text: a.text, card: a.about });
  return ORDER.map((kind) => ({
    kind,
    hits: all.filter((h) => h.kind === kind && (words.length ? hit(h.text) : kind === "goal")).slice(0, words.length ? per : 8),
  })).filter((g) => g.hits.length);
}
