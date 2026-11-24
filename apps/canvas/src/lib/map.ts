// Where the map puts each card. Positions are computed from the plan, never
// stored: the home map rings the goals round the centre (those in progress
// nearest), and a goal's own map is a road running left to right through
// its groups in order (by `sequence`), each with a plot of its work beside it.
// Pure.
import type { Plan, State } from "./plan";
export interface Spot {
  x: number;
  y: number;
}
export interface Road {
  a: Spot;
  b: Spot;
  /** The state of the card the road leads to; "stem" joins a group to its plot. */
  kind: State | "stem";
}
export interface Plot extends Spot {
  w: number;
  h: number;
  state: "done" | "prog" | "idle" | "block";
}
export interface Ring {
  rx: number;
  ry: number;
}
export interface MapLayout {
  /** Top-left of every card the map shows. A card with no spot is not drawn. */
  spots: Record<string, Spot>;
  roads: Road[];
  plots: Plot[];
  rings: Ring[];
  /** Goals with nothing under them, drawn faint at the edge of the home map. */
  faded: string[];
  /** Small headings on the desk. */
  labels: Array<Spot & { text: string }>;
}

/** A goal or group card's width, a work tile's size, and the road between two groups. */
export const CARD_W = 264;
export const GROUP_W = 224;
export const TILE_W = 176;
export const TILE_H = 58;
export const SPAN = 430;
const GAP = 8;

const empty = (): MapLayout => ({ spots: {}, roads: [], plots: [], rings: [], faded: [], labels: [] });

/** Half a goal card's height on the home map, about. */
const GOAL_HALF_H = 54;

/** Where a road from `a` to a card centred on `c` meets the card's edge, so it ends at the card instead of running
 *  under it (a draft or faded card is see-through). */
export function toEdge(a: Spot, c: Spot, halfW = CARD_W / 2, halfH = GOAL_HALF_H): Spot {
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const s = Math.min(dx ? halfW / Math.abs(dx) : Infinity, dy ? halfH / Math.abs(dy) : Infinity);
  if (!Number.isFinite(s) || s >= 1) return c;
  return { x: Math.round(c.x - dx * s), y: Math.round(c.y - dy * s) };
}

/** A note on a goal's shelf: its width, and the room each takes. */
export const NOTE_W = 250;
export const NOTE_STEP = 116;

/** The home map: `shown` goals on rings round (0, 0), an ellipse wider than tall. With `oneRing` (a handful, the
 *  newest first) they go round one ring in the order given, clockwise from the top, whatever their state: the card
 *  says its state, the place says how recent it is. Otherwise those in progress go nearest, then the rest. */
export function homeMap(plan: Plan, shown: string[], oneRing = false): MapLayout {
  const out = empty();
  if (oneRing) {
    const radius = 430;
    const take = shown.filter((g) => plan.cards[g]);
    take.forEach((g, j) => {
      const a = -Math.PI / 2 + (2 * Math.PI * j) / take.length;
      const x = Math.cos(a) * radius * 1.6;
      const y = Math.sin(a) * radius;
      out.spots[g] = { x: Math.round(x - CARD_W / 2), y: Math.round(y - 56) };
      const kids = plan.kids[g] ?? [];
      if (!kids.length) out.faded.push(g);
      const kind: State = plan.cards[g]!.state === "done" ? "done" : kids.some((m) => plan.cards[m]?.state === "prog") || plan.cards[g]!.state === "prog" ? "prog" : "idle";
      const from = { x: Math.round(Math.cos(a) * 150), y: Math.round(Math.sin(a) * 95) };
      out.roads.push({ a: from, b: toEdge(from, { x: Math.round(x), y: Math.round(y) }), kind });
    });
    if (take.length) out.rings.push({ rx: Math.round(radius * 1.6), ry: radius });
    return out;
  }
  const rank = (g: string) => (plan.cards[g]!.state === "prog" ? 0 : plan.kids[g]?.length ? 1 : 2);
  let radius = 430;
  for (const k of [0, 1, 2]) {
    const group = shown.filter((g) => plan.cards[g] && rank(g) === k);
    while (group.length) {
      // As many as fit round the ring without touching.
      const cap = Math.max(3, Math.floor((2 * Math.PI * radius * 1.25) / (CARD_W + 66)));
      const take = group.splice(0, cap);
      take.forEach((g, j) => {
        const a = -Math.PI / 2 + (2 * Math.PI * (j + (k % 2 ? 0.5 : 0))) / take.length;
        const x = Math.cos(a) * radius * 1.6;
        const y = Math.sin(a) * radius;
        out.spots[g] = { x: Math.round(x - CARD_W / 2), y: Math.round(y - 56) };
        if (k === 2) out.faded.push(g);
        if (k === 0) {
          const busy = (plan.kids[g] ?? []).some((m) => plan.cards[m]?.state === "prog");
          const from = { x: Math.round(Math.cos(a) * 150), y: Math.round(Math.sin(a) * 95) };
          out.roads.push({ a: from, b: toEdge(from, { x: Math.round(x), y: Math.round(y) }), kind: busy ? "prog" : "idle" });
        }
      });
      out.rings.push({ rx: Math.round(radius * 1.6), ry: radius });
      radius += 400;
    }
  }
  return out;
}

/** What a plot of work looks like from what is in it: done when all is, blocked or in progress when any is. */
export function plotState(states: State[]): Plot["state"] {
  if (states.length && states.every((s) => s === "done")) return "done";
  if (states.includes("block")) return "block";
  if (states.includes("prog")) return "prog";
  return "idle";
}

/** One goal's map: the goal at the gate, its groups along the road, each group's work in a plot above or below,
 *  and `shelf` — its brainstorms — stacked under the gate, clear of the road. */
export function goalMap(plan: Plan, goal: string, shelf: string[] = []): MapLayout {
  const out = empty();
  if (!plan.cards[goal]) return out;
  const all = plan.kids[goal] ?? [];
  const groups = all.filter((k) => plan.cards[k]!.role === "group");
  // A goal whose work hangs straight off it is its own single stop.
  const stops = groups.length ? groups : [goal];
  let prev: Spot | null = null;
  if (groups.length) {
    out.spots[goal] = { x: -(CARD_W + 116), y: -56 };
    prev = { x: -116, y: 0 };
  }
  stops.forEach((m, i) => {
    const x = i * SPAN;
    out.spots[m] = { x, y: -44 };
    if (prev) out.roads.push({ a: prev, b: { x, y: 0 }, kind: plan.cards[m]!.state });
    prev = { x: x + GROUP_W, y: 0 };
    const work = (plan.kids[m] ?? []).filter((k) => plan.cards[k]!.role === "work");
    if (!work.length) return;
    // Plots alternate above and below the road so neighbours never meet.
    const rows = Math.ceil(work.length / 2);
    const up = i % 2 === 1;
    const h = rows * (TILE_H + GAP) - GAP;
    const y0 = up ? -104 - h : 110;
    work.forEach((f, k) => {
      out.spots[f] = { x: x - 68 + (k % 2) * (TILE_W + GAP), y: y0 + Math.floor(k / 2) * (TILE_H + GAP) };
    });
    out.plots.push({ x: x - 82, y: y0 - 14, w: 2 * TILE_W + GAP + 28, h: h + 28, state: plotState(work.filter((f) => !plan.cards[f]!.pencil).map((f) => plan.cards[f]!.state)) });
    out.roads.push({ a: { x: x + GROUP_W / 2, y: up ? -44 : 60 }, b: { x: x + GROUP_W / 2, y: up ? y0 + h + 14 : y0 - 14 }, kind: "stem" });
  });
  if (shelf.length) {
    // One card under the gate opens the brainstorm tree; the questions themselves are drawn there, not as a list here.
    out.spots[BRAINSTORM_SPOT] = { x: -(CARD_W + 116), y: groups.length ? 110 : -44 };
  }
  return out;
}

/** The map's one brainstorm card, under the gate: what the brainstorm holds, and the way into its tree. */
export const BRAINSTORM_SPOT = "__brainstorm";

/** The box a layout fills, for fitting it to a window. Null when it shows nothing. */
export function boundsOf(layout: MapLayout): { x0: number; y0: number; x1: number; y1: number } | null {
  const spots = Object.values(layout.spots);
  if (!spots.length) return null;
  return {
    x0: Math.min(...spots.map((s) => s.x)),
    y0: Math.min(...spots.map((s) => s.y)),
    x1: Math.max(...spots.map((s) => s.x + CARD_W)),
    y1: Math.max(...spots.map((s) => s.y + 130)),
  };
}
