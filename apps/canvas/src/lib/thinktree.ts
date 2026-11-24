// The brainstorm as a tree on the canvas: the initiative, its milestones in
// road order, the features a question is about, the questions, and — for a
// question a person opened — its options as branches, each with the follow-up
// questions choosing it leads to hanging under it, then its sub-questions. Read left to right, top
// aligned like an outline, so opening a question never moves what is above it.
// Computed from the plan and the brainstorms (./brainstorm.ts), never stored;
// what is folded or opened is the viewer's. Pure.
import { asksIn, type Brainstorms } from "./brainstorm";
import type { Plan } from "./plan";

export type TKind = "goal" | "group" | "work" | "ask" | "option";
export type Show = "all" | "open" | "decided";

export interface TNode {
  id: string;
  kind: TKind;
  x: number;
  y: number;
  w: number;
  h: number;
  parent: string | null;
  depth: number;
  /** Its children as drawn (empty when folded or closed). */
  kids: string[];
}
export interface TEdge {
  from: string;
  to: string;
  kind: "plan" | "ask" | "asked" | "option" | "chosen" | "rejected" | "follow";
}
export interface Tally {
  open: number;
  decided: number;
}
export interface ThinkLayout {
  nodes: Record<string, TNode>;
  order: string[];
  edges: TEdge[];
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Root questions under each plan card (itself and everything under it), whatever the filter. */
  tally: Record<string, Tally>;
  /** Every root question in the initiative, whatever the filter. */
  all: Tally;
  /** The questions drawn, follow-ups included. */
  shownAsks: string[];
  /** Every question in the trees shown, drawn or not: what "Open all" opens. */
  everyAsk: string[];
}

export const TW: Record<TKind, number> = { goal: 264, group: 236, work: 210, ask: 300, option: 320 };
const HGAP = 76;
const VGAP = 16;
const PLAN_GAP = 30;

const lines = (text: string, per: number) => Math.max(1, Math.ceil(text.length / per));

/** How tall a node will draw before it has been measured. */
export function estimate(kind: TKind, text: string, extra = 0): number {
  if (kind === "goal") return 110;
  if (kind === "group") return 88;
  if (kind === "work") return 64;
  if (kind === "ask") return 78 + lines(text, 34) * 21 + extra;
  return 92 + lines(text, 36) * 20 + extra * 17;
}

export interface ThinkOpts {
  folded: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  show: Show;
  /** Measured heights, by node id. */
  sizes: Readonly<Record<string, number>>;
}

/** Each question's place: the option that leads to it or the question it is under, and each option's question. */
export function parentsOf(b: Brainstorms): Record<string, string> {
  const up: Record<string, string> = {};
  for (const q of Object.values(b.asks)) for (const o of q.options) up[o] ??= q.id;
  for (const q of Object.values(b.asks)) for (const k of q.subs) up[k] ??= q.id;
  for (const o of Object.values(b.choices)) for (const q of o.asks) up[q] ??= o.id;
  return up;
}

/** A question and every question under it: its sub-questions, and the follow-ups its options lead to. */
export function asksUnder(b: Brainstorms, id: string, out: string[] = []): string[] {
  if (!b.asks[id] || out.includes(id)) return out;
  out.push(id);
  for (const k of b.asks[id]!.subs) asksUnder(b, k, out);
  for (const o of b.asks[id]!.options) for (const f of b.choices[o]?.asks ?? []) asksUnder(b, f, out);
  return out;
}

/** The chain of questions above a follow-up, nearest last (the question itself not included). */
export function asksAbove(b: Brainstorms, id: string): string[] {
  const up = parentsOf(b);
  const out: string[] = [];
  let at = up[id];
  const seen = new Set<string>([id]);
  while (at && !seen.has(at)) {
    seen.add(at);
    if (b.asks[at]) out.unshift(at);
    at = up[at];
  }
  return out;
}

export function thinkTree(plan: Plan, b: Brainstorms, goal: string, o: ThinkOpts): ThinkLayout {
  const roots = asksIn(plan, b, goal);
  const keep = (id: string) => o.show === "all" || (o.show === "open" ? b.asks[id]!.open : !b.asks[id]!.open);
  const about: Record<string, string[]> = {};
  for (const id of roots) if (keep(id)) (about[b.asks[id]!.about!] ??= []).push(id);

  // Tally every root question up its plan path, whatever the filter.
  const tally: Record<string, Tally> = {};
  const all: Tally = { open: 0, decided: 0 };
  for (const id of roots) {
    const q = b.asks[id]!;
    const k = q.open ? "open" : "decided";
    all[k]++;
    let at: string | undefined = q.about!;
    while (at) {
      (tally[at] ??= { open: 0, decided: 0 })[k]++;
      if (at === goal) break;
      at = plan.parent[at];
    }
  }

  const live = (id: string) => !!plan.cards[id] && !plan.cards[id]!.pencil;
  const features = (under: string) => (plan.kids[under] ?? []).filter((k) => live(k) && plan.cards[k]!.role === "work" && (about[k]?.length ?? 0) > 0);
  const kidsOf = (id: string, kind: TKind): Array<[string, TKind]> => {
    if (kind === "goal") {
      const groups = (plan.kids[id] ?? []).filter((k) => live(k) && plan.cards[k]!.role === "group");
      return [...(about[id] ?? []).map((q) => [q, "ask"] as [string, TKind]), ...groups.map((g) => [g, "group"] as [string, TKind]), ...features(id).map((f) => [f, "work"] as [string, TKind])];
    }
    if (kind === "group" || kind === "work") {
      if (o.folded.has(id)) return [];
      return [...(about[id] ?? []).map((q) => [q, "ask"] as [string, TKind]), ...features(id).map((f) => [f, "work"] as [string, TKind])];
    }
    if (kind === "ask") {
      if (!o.expanded.has(id)) return [];
      const q = b.asks[id]!;
      return [...q.options.filter((c) => b.choices[c]).map((c) => [c, "option"] as [string, TKind]), ...q.subs.filter((k) => b.asks[k]).map((k) => [k, "ask"] as [string, TKind])];
    }
    return (b.choices[id]?.asks ?? []).filter((q) => b.asks[q]).map((q) => [q, "ask"] as [string, TKind]);
  };
  const textOf = (id: string, kind: TKind) => (kind === "ask" ? b.asks[id]!.text : kind === "option" ? b.choices[id]!.text : plan.cards[id]?.title ?? "");
  const extraOf = (id: string, kind: TKind) => {
    if (kind === "ask") {
      const q = b.asks[id]!;
      const chosen = q.options.map((c) => b.choices[c]).find((c) => c?.state === "chosen");
      return (chosen ? 26 + lines(chosen.text, 40) * 17 : 0) + (o.expanded.has(id) ? 44 : 0);
    }
    return kind === "option" ? 3 : 0;
  };

  const nodes: Record<string, TNode> = {};
  const order: string[] = [];
  const edges: TEdge[] = [];
  const shownAsks: string[] = [];
  const place = (id: string, kind: TKind, x: number, y: number, depth: number, parent: string | null): number => {
    if (nodes[id]) return y - VGAP;
    const w = TW[kind];
    const h = o.sizes[id] ?? estimate(kind, textOf(id, kind), extraOf(id, kind));
    const node: TNode = { id, kind, x, y, w, h, parent, depth, kids: [] };
    nodes[id] = node;
    order.push(id);
    if (kind === "ask") shownAsks.push(id);
    let cy = y;
    let bottom = y + h;
    const kids = kidsOf(id, kind);
    kids.forEach(([k, kk], i) => {
      if (nodes[k]) return;
      const gap = i === 0 ? 0 : kk === "group" || kk === "work" ? PLAN_GAP : VGAP;
      cy += gap;
      const end = place(k, kk, x + w + HGAP, cy, depth + 1, id);
      node.kids.push(k);
      edges.push({ from: id, to: k, kind: edgeKind(b, id, kind, k, kk) });
      cy = end;
      bottom = Math.max(bottom, end);
    });
    return bottom;
  };
  place(goal, "goal", 0, 0, 0, null);

  const list = Object.values(nodes);
  const box = list.length ? { x0: Math.min(...list.map((n) => n.x)), y0: Math.min(...list.map((n) => n.y)), x1: Math.max(...list.map((n) => n.x + n.w)), y1: Math.max(...list.map((n) => n.y + n.h)) } : null;
  const everyAsk: string[] = [];
  for (const list of Object.values(about)) for (const id of list) asksUnder(b, id, everyAsk);
  return { nodes, order, edges, box, tally, all, shownAsks, everyAsk };
}

function edgeKind(b: Brainstorms, _from: string, fromKind: TKind, to: string, toKind: TKind): TEdge["kind"] {
  if (toKind === "option") {
    const s = b.choices[to]!.state;
    return s === "chosen" ? "chosen" : s === "rejected" ? "rejected" : "option";
  }
  if (toKind === "ask") return fromKind === "option" ? "follow" : b.asks[to]!.open ? "ask" : "asked";
  return "plan";
}

/** The box a node and everything drawn under it fill. */
export function subtreeBox(t: ThinkLayout, id: string) {
  const n = t.nodes[id];
  if (!n) return null;
  let x0 = n.x, y0 = n.y, x1 = n.x + n.w, y1 = n.y + n.h;
  const walk = (k: string) => {
    const m = t.nodes[k]!;
    x0 = Math.min(x0, m.x);
    y0 = Math.min(y0, m.y);
    x1 = Math.max(x1, m.x + m.w);
    y1 = Math.max(y1, m.y + m.h);
    m.kids.forEach(walk);
  };
  n.kids.forEach(walk);
  return { x0, y0, x1, y1 };
}
