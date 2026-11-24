// Brainstorms on the canvas: a question asked about a card, the options under
// it, the sub-questions under it (separate decisions in the same topic), the
// questions an option leads to, and each option's ratings and effects. Built
// from typed nodes and the edges among them, like the plan (./plan.ts), in
// the one read the page makes of them: no tree is read question by question.
// Which types and edges those are is data. Pure.
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
/** What choosing an option causes, weighed against a requirement: its type, and the option's link to it. */
export const EFFECT = { type: "Effect", has: "HAS_EFFECT" } as const;

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
  /** Separate decisions under it, in the same topic. */
  subs: string[];
  /** Asked about a card, not under an option or another question. */
  root: boolean;
  /** Led to by an option: it only arises if that option is chosen. */
  follows: boolean;
  /** Its place in its tree: 1, 2, 1.1 (a root has none). */
  label: string;
}

export interface Effect {
  name: string;
  description: string;
  score: number | null;
  direction: "pro" | "con";
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
  /** Its letter in its tree: A, 1B. */
  label: string;
  /** fast, good and cheap, -1..1; null when it was not rated. */
  ratings: { fast: number | null; good: number | null; cheap: number | null } | null;
  effects: Effect[];
  recommended: boolean;
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
/** Write order: the card's `seq`, else when it was written, else the legacy id. Labels follow it. */
const stampOf = (n: RawNode): string => {
  const p = n.properties ?? {};
  if (p["seq"] !== undefined && p["seq"] !== null && p["seq"] !== "") return String(p["seq"]).padStart(20, "0");
  const at = p["created_at"] ?? p["date_added_to_graph"];
  return at !== undefined && at !== null ? String(at).padStart(20, "0") : `~${String(p["option_id"] ?? p["question_id"] ?? "")}`;
};
const score = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** "A", "B" … "Z", "AA". */
const letter = (i: number) => {
  let out = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};
/** Who said it: a brainstorm node's `made_by` (the person's own words, quoted, or the model's) wins over who wrote the node. */
const saidBy = (p: Record<string, unknown>): By => {
  const m = String(p["made_by"] ?? "").toLowerCase();
  return m === "user" || m === "person" || m === "human" ? "person" : m === "model" ? "agent" : byOf(p);
};
/** Drawn in handwriting: a sticky a person wrote (see ./font). */
const isHand = (p: Record<string, unknown>): boolean => fontOf("sticky", saidBy(p)) === "hand";

export function buildBrainstorms(questions: RawNode[], options: RawNode[], edges: RawEdge[], plan: Plan, roles: BrainstormRoles = BRAINSTORM, effectNodes: RawNode[] = []): Brainstorms {
  const asks: Record<string, Ask> = {};
  const choices: Record<string, Choice> = {};
  const order = new Map<string, string>();
  for (const n of questions) {
    const p = n.properties ?? {};
    if (!isLive(p) || asks[n.ref_id]) continue;
    asks[n.ref_id] = { id: n.ref_id, text: textOf(n), open: p["state"] !== "decided", by: saidBy(p), author: authorOf(p), hand: isHand(p), job: typeof p["job"] === "string" && p["job"] ? p["job"] : null, at: num(p["date_added_to_graph"] ?? p["created_at"]), about: null, options: [], subs: [], root: true, follows: false, label: "" };
    order.set(n.ref_id, stampOf(n));
  }
  for (const n of options) {
    const p = n.properties ?? {};
    if (!isLive(p) || choices[n.ref_id]) continue;
    const s = p["state"];
    const fast = score(p["fast"]), good = score(p["good"]), cheap = score(p["cheap"]);
    choices[n.ref_id] = {
      id: n.ref_id,
      text: textOf(n),
      state: s === "chosen" ? "chosen" : s === "rejected" ? "rejected" : "open",
      by: saidBy(p),
      author: authorOf(p),
      hand: isHand(p),
      asks: [],
      label: "",
      ratings: fast === null && good === null && cheap === null ? null : { fast, good, cheap },
      effects: [],
      recommended: p["recommended"] === true || p["recommended"] === "true",
    };
    order.set(n.ref_id, stampOf(n));
  }
  const effects = new Map<string, Effect>();
  for (const n of effectNodes) {
    const p = n.properties ?? {};
    if (!isLive(p)) continue;
    const sc = score(p["score"]);
    effects.set(n.ref_id, { name: String(p["name"] ?? n.name ?? "").trim(), description: String(p["description"] ?? "").trim(), score: sc, direction: sc !== null && sc > 0 ? "pro" : "con" });
  }
  for (const e of edges) {
    const q = asks[e.source];
    if (q && e.edge_type === roles.about && plan.cards[e.target] && !q.about) q.about = e.target;
    else if (q && e.edge_type === roles.leads && choices[e.target] && !q.options.includes(e.target)) q.options.push(e.target);
    else if (q && e.edge_type === roles.leads && asks[e.target] && e.target !== q.id) {
      asks[e.target]!.root = false;
      if (!q.subs.includes(e.target)) q.subs.push(e.target);
    } else if (choices[e.source] && e.edge_type === roles.leads && asks[e.target]) {
      asks[e.target]!.root = false;
      asks[e.target]!.follows = true;
      if (!choices[e.source]!.asks.includes(e.target)) choices[e.source]!.asks.push(e.target);
    } else if (choices[e.source] && e.edge_type === EFFECT.has && effects.has(e.target)) choices[e.source]!.effects.push(effects.get(e.target)!);
  }
  const byStamp = (a: string, b: string) => (order.get(a) ?? "").localeCompare(order.get(b) ?? "", undefined, { numeric: true }) || a.localeCompare(b);
  for (const q of Object.values(asks)) {
    q.options.sort(byStamp);
    q.subs.sort(byStamp);
  }
  for (const c of Object.values(choices)) c.asks.sort(byStamp);
  // Labels, as the canvas workflow's outline gives them: a sub-question is numbered (1, 2; 1.1), an option lettered
  // after its question (A, 1A), a follow-up passes its option's label down.
  const seen = new Set<string>();
  const labelUnder = (id: string, base: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const q = asks[id]!;
    const kids = [...q.options, ...q.subs].sort(byStamp);
    let qi = 0, oi = 0;
    for (const k of kids) {
      if (asks[k]) {
        asks[k]!.label = /[0-9]$/.test(base) ? `${base}.${++qi}` : `${base}${++qi}`;
        labelUnder(k, asks[k]!.label);
      } else {
        const c = choices[k]!;
        c.label = `${base}${letter(oi++)}`;
        for (const f of c.asks) labelUnder(f, c.label);
      }
    }
  };
  for (const q of Object.values(asks)) if (q.root) labelUnder(q.id, "");
  // A topic (a question with sub-questions and no options of its own) is no decision: it is open while one under it is.
  const openMemo = new Map<string, boolean>();
  const openOf = (id: string, depth = 0): boolean => {
    const q = asks[id]!;
    if (q.options.length || !q.subs.length || depth > 30) return q.open;
    if (!openMemo.has(id)) openMemo.set(id, q.subs.some((k) => openOf(k, depth + 1)));
    return openMemo.get(id)!;
  };
  for (const q of Object.values(asks)) if (!q.options.length && q.subs.length) q.open = openOf(q.id);
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

/** A -1..1 rating as 1–3 pips. */
export const pips = (score: number | null | undefined) => (score === undefined || score === null ? 0 : Math.min(3, Math.max(1, Math.round(score + 2))));
