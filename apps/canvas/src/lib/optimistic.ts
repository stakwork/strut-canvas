// A person's act shown the moment it is made: the `ops` input applied to what
// the page last read, before the run that writes it ends. The read after the
// run (or the change feed) replaces it with what the graph holds; a refused
// act reads the graph again and the toast says why. Each returns null when
// the act changes nothing it knows how to draw. Pure.
import { stateOf, type Card, type OpsInput, type Plan } from "./plan";
import type { Why } from "./why";
import type { Brainstorms } from "./brainstorm";

const without = (list: string[] | undefined, gone: ReadonlySet<string>) => (list ?? []).filter((x) => !gone.has(x));

/** The plan with one act applied: a rename, a status, the blocked flag, a removal. */
export function patchPlan(plan: Plan, input: OpsInput): Plan | null {
  const c = input.ref_id ? plan.cards[input.ref_id] : undefined;
  if (!c || c.pencil) return null;
  if (input.op === "remove") {
    const gone = new Set<string>();
    const walk = (id: string) => {
      gone.add(id);
      for (const k of plan.kids[id] ?? []) walk(k);
    };
    walk(c.id);
    const cards = Object.fromEntries(Object.entries(plan.cards).filter(([id]) => !gone.has(id)));
    const kids = Object.fromEntries(Object.entries(plan.kids).filter(([id]) => !gone.has(id)).map(([id, ks]) => [id, without(ks, gone)]));
    const parent = Object.fromEntries(Object.entries(plan.parent).filter(([id]) => !gone.has(id)));
    return { cards, kids, parent, goals: without(plan.goals, gone) };
  }
  let next: Card | null = null;
  if (input.op === "edit" && input.field && input.value !== undefined) {
    const props = { ...c.props, [input.field]: input.value };
    next = { ...c, props, ...(input.field === "name" && input.value ? { title: input.value } : {}) };
  } else if (input.op === "set_status" && input.value) {
    const v = input.value.toLowerCase();
    if (v === "blocked") next = { ...c, state: "block", props: { ...c.props, blocked: true, ...(input.reason ? { blocked_reason: input.reason } : {}) } };
    else next = { ...c, status: v, state: stateOf(v, false), props: { ...c.props, status: v, blocked: false } };
  }
  if (!next) return null;
  return { ...plan, cards: { ...plan.cards, [c.id]: next } };
}

/** The why with one act applied: a requirement accepted, dropped or undecided; a story's, requirement's or brief's
 *  words; a story or requirement removed. */
export function patchWhy(why: Why, input: OpsInput): Why | null {
  const id = input.ref_id;
  if (!id) return null;
  const r = why.requirements[id];
  const s = why.stories[id];
  if (r && (input.op === "accept" || input.op === "drop" || input.op === "reset")) {
    const status = input.op === "accept" ? "accepted" : input.op === "drop" ? "dropped" : "proposed";
    return { ...why, requirements: { ...why.requirements, [id]: { ...r, status } } };
  }
  if (input.op === "edit" && input.field === "text" && input.value) {
    if (r) return { ...why, requirements: { ...why.requirements, [id]: { ...r, text: input.value } } };
    if (s) return { ...why, stories: { ...why.stories, [id]: { ...s, text: input.value } } };
    const goal = Object.keys(why.briefId).find((g) => why.briefId[g] === id);
    if (goal) return { ...why, brief: { ...why.brief, [goal]: input.value } };
    return null;
  }
  if (input.op === "remove" && (r || s)) {
    const gone = new Set([id, ...(s?.requirements ?? [])]);
    const requirements = Object.fromEntries(Object.entries(why.requirements).filter(([k]) => !gone.has(k)));
    const stories = Object.fromEntries(Object.entries(why.stories).filter(([k]) => !gone.has(k)).map(([k, v]) => [k, { ...v, requirements: without(v.requirements, gone) }]));
    const byGoal = Object.fromEntries(Object.entries(why.byGoal).map(([g, list]) => [g, without(list, gone)]));
    const answers = Object.fromEntries(Object.entries(why.answers).filter(([k]) => !gone.has(k)));
    const serves = Object.fromEntries(Object.entries(why.serves).map(([k, list]) => [k, without(list, gone)]));
    return { ...why, requirements, stories, byGoal, answers, serves };
  }
  return null;
}

/** The brainstorms with one act applied: an option chosen or un-chosen, a question's or option's words, a question or
 *  option removed. */
export function patchBrainstorms(b: Brainstorms, input: OpsInput): Brainstorms | null {
  const id = input.ref_id;
  if (!id) return null;
  const o = b.choices[id];
  const q = b.asks[id];
  const asker = o ? Object.values(b.asks).find((a) => a.options.includes(id)) : undefined;
  if (o && asker && (input.op === "choose" || input.op === "unchoose")) {
    const choices = { ...b.choices };
    if (input.op === "choose") {
      for (const k of asker.options) if (choices[k]) choices[k] = { ...choices[k]!, state: k === id ? "chosen" : "rejected" };
      return { ...b, choices, asks: { ...b.asks, [asker.id]: { ...asker, open: false } } };
    }
    choices[id] = { ...o, state: "open", said: null };
    const still = asker.options.some((k) => k !== id && choices[k]?.state === "chosen");
    if (!still) for (const k of asker.options) if (choices[k]?.state === "rejected") choices[k] = { ...choices[k]!, state: "open" };
    return { ...b, choices, asks: { ...b.asks, [asker.id]: { ...asker, open: !still } } };
  }
  if (input.op === "edit" && input.field === "text" && input.value) {
    if (q) return { ...b, asks: { ...b.asks, [id]: { ...q, text: input.value } } };
    if (o) return { ...b, choices: { ...b.choices, [id]: { ...o, text: input.value } } };
    return null;
  }
  if (input.op === "remove" && (q || o)) {
    // The card and what hangs under it: a question's options and sub-questions, an option's follow-ups, and theirs.
    const gone = new Set<string>();
    const walk = (k: string) => {
      if (gone.has(k)) return;
      gone.add(k);
      for (const x of b.asks[k]?.options ?? []) walk(x);
      for (const x of b.asks[k]?.subs ?? []) walk(x);
      for (const x of b.choices[k]?.asks ?? []) walk(x);
    };
    walk(id);
    const asks = Object.fromEntries(Object.entries(b.asks).filter(([k]) => !gone.has(k)).map(([k, a]) => [k, { ...a, options: without(a.options, gone), subs: without(a.subs, gone) }]));
    const choices = Object.fromEntries(Object.entries(b.choices).filter(([k]) => !gone.has(k)).map(([k, c]) => [k, { ...c, asks: without(c.asks, gone) }]));
    const byCard = Object.fromEntries(Object.entries(b.byCard).map(([k, list]) => [k, without(list, gone)]));
    return { asks, choices, byCard };
  }
  return null;
}
