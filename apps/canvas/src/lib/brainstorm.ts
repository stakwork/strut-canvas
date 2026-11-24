// Brainstorms on the canvas: a question asked about a card, the options under
// it, and the questions an option leads to. Built from typed nodes and the
// edges among them, like the plan (./plan.ts); which types and edges those
// are is data. Pure.
import { authorOf, type Author } from "./author";
import { fontOf } from "./font";
import { byOf, goalOf, isLive, type Plan, type RawEdge, type RawNode } from "./plan";

export interface BrainstormRoles {
  question: string;
  option: string;
  /** question → the card it is about. */
  about: string;
  /** question → its options, and option → the questions it leads to. */
  leads: string;
}

/** The brainstorm trees the canvas writes. */
export const BRAINSTORM: BrainstormRoles = { question: "Question", option: "Option", about: "ABOUT", leads: "PARENT_OF" };

type By = "person" | "agent" | null;

export interface Ask {
  id: string;
  text: string;
  /** Still waiting on a choice. */
  open: boolean;
  by: By;
  /** Who wrote it, by name (./author). */
  author: Author;
  /** Written by hand on the canvas (drawn in handwriting). */
  hand: boolean;
  /** The job that wrote it, when the graph says. */
  job: string | null;
  at: number;
  /** The plan card it is about; null when that card is not on the canvas. */
  about: string | null;
  options: string[];
  /** Asked about a card, not led to by an option. */
  root: boolean;
}

export interface Choice {
  id: string;
  text: string;
  state: "open" | "chosen" | "rejected";
  by: By;
  author: Author;
  hand: boolean;
  /** The questions choosing this leads to. */
  asks: string[];
}

export interface Brainstorms {
  asks: Record<string, Ask>;
  choices: Record<string, Choice>;
  /** A plan card's root questions, the open ones first, then the newest. */
  byCard: Record<string, string[]>;
}

const textOf = (n: RawNode): string => {
  const t = n.properties?.["text"];
  return ((typeof t === "string" && t) || n.name || n.ref_id.slice(0, 8)).trim();
};
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v ? Date.parse(v) || 0 : 0);
const idOf = (n: RawNode) => String(n.properties?.["option_id"] ?? n.properties?.["question_id"] ?? "");
/** Who said it: a brainstorm node's `made_by` (the person's own words, quoted, or the model's) wins over who wrote the node. */
const saidBy = (p: Record<string, unknown>): By => {
  const m = String(p["made_by"] ?? "").toLowerCase();
  return m === "user" || m === "person" || m === "human" ? "person" : m === "model" ? "agent" : byOf(p);
};
/** Drawn in handwriting: a sticky a person wrote (see ./font). */
const isHand = (p: Record<string, unknown>): boolean => fontOf("sticky", saidBy(p)) === "hand";

export function buildBrainstorms(questions: RawNode[], options: RawNode[], edges: RawEdge[], plan: Plan, roles: BrainstormRoles = BRAINSTORM): Brainstorms {
  const asks: Record<string, Ask> = {};
  const choices: Record<string, Choice> = {};
  const order = new Map<string, string>();
  for (const n of questions) {
    const p = n.properties ?? {};
    if (!isLive(p) || asks[n.ref_id]) continue;
    asks[n.ref_id] = { id: n.ref_id, text: textOf(n), open: p["state"] !== "decided", by: saidBy(p), author: authorOf(p), hand: isHand(p), job: typeof p["job"] === "string" && p["job"] ? p["job"] : null, at: num(p["date_added_to_graph"] ?? p["created_at"]), about: null, options: [], root: true };
  }
  for (const n of options) {
    const p = n.properties ?? {};
    if (!isLive(p) || choices[n.ref_id]) continue;
    const s = p["state"];
    choices[n.ref_id] = { id: n.ref_id, text: textOf(n), state: s === "chosen" ? "chosen" : s === "rejected" ? "rejected" : "open", by: saidBy(p), author: authorOf(p), hand: isHand(p), asks: [] };
    order.set(n.ref_id, idOf(n));
  }
  for (const e of edges) {
    const q = asks[e.source];
    if (q && e.edge_type === roles.about && plan.cards[e.target] && !q.about) q.about = e.target;
    else if (q && e.edge_type === roles.leads && choices[e.target] && !q.options.includes(e.target)) q.options.push(e.target);
    else if (choices[e.source] && e.edge_type === roles.leads && asks[e.target]) {
      asks[e.target]!.root = false;
      if (!choices[e.source]!.asks.includes(e.target)) choices[e.source]!.asks.push(e.target);
    }
  }
  for (const q of Object.values(asks)) q.options.sort((a, b) => (order.get(a) ?? "").localeCompare(order.get(b) ?? "", undefined, { numeric: true }));
  // Once a question is decided, what was not chosen was passed over.
  for (const q of Object.values(asks)) {
    if (q.open || !q.options.some((o) => choices[o]!.state === "chosen")) continue;
    for (const o of q.options) if (choices[o]!.state === "open") choices[o]!.state = "rejected";
  }
  const byCard: Record<string, string[]> = {};
  for (const q of Object.values(asks)) if (q.root && q.about) (byCard[q.about] ??= []).push(q.id);
  const ord = (a: string, b: string) => Number(asks[b]!.open) - Number(asks[a]!.open) || asks[b]!.at - asks[a]!.at || asks[a]!.text.localeCompare(asks[b]!.text);
  for (const id of Object.keys(byCard)) byCard[id]!.sort(ord);
  return { asks, choices, byCard };
}

/** Every root question about a goal or anything under it, the open ones first. */
export function asksIn(plan: Plan, b: Brainstorms, goal: string): string[] {
  const out: string[] = [];
  for (const [card, ids] of Object.entries(b.byCard)) if (goalOf(plan, card) === goal) out.push(...ids);
  return out.sort((x, y) => Number(b.asks[y]!.open) - Number(b.asks[x]!.open) || b.asks[y]!.at - b.asks[x]!.at || b.asks[x]!.text.localeCompare(b.asks[y]!.text));
}

/** How many open root questions each goal holds. */
export function openByGoal(plan: Plan, b: Brainstorms): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [card, ids] of Object.entries(b.byCard)) {
    const g = goalOf(plan, card);
    const n = ids.filter((id) => b.asks[id]!.open).length;
    if (g && n) out[g] = (out[g] ?? 0) + n;
  }
  return out;
}

/** The jobs that wrote a card's questions: one way a running job is tied to a card. */
export function jobsByCard(b: Brainstorms): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const q of Object.values(b.asks)) {
    if (!q.job || !q.about) continue;
    const list = (out[q.about] ??= []);
    if (!list.includes(q.job)) list.push(q.job);
  }
  return out;
}

/** One node of a brainstorm's tree as `canvas/brainstorm-tree` reads it (options with their ratings and effects). */
export interface TreeNode {
  ref_id: string;
  depth: number;
  kind: "question" | "option" | string;
  label?: string;
  text: string;
  made_by?: string;
  state?: string;
  ratings?: { fast?: number; good?: number; cheap?: number } | null;
  effects?: Array<{ name: string; description?: string; direction: "pro" | "con" | string; impact?: number }>;
}

/** A -1..1 rating as 1–3 pips. */
export const pips = (score: number | undefined) => (score === undefined || score === null ? 0 : Math.min(3, Math.max(1, Math.round(score + 2))));
