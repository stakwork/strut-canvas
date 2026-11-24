// The plan the canvas draws: goals, the groups under each, the work under each
// group. Built from typed graph nodes and the edges among them, with no
// knowledge of which types those are — `Roles` says which type plays which
// part, which statuses it has, where its date and description live, and how a
// new card of it is asked for. Pure: no React, no client.

export type Role = "goal" | "group" | "work";
/** What a card's status means on the canvas, whatever the type calls it. */
export type State = "idle" | "prog" | "done" | "block";

/** Which node types play which role, and everything else about them that is data. */
export interface Roles {
  goal: string;
  group: string;
  work: string;
  contains: string[];
  /** Each role's statuses in the type's own words, in the order work moves through them. */
  statuses: Record<Role, string[]>;
  /** The property that holds each role's date to be done by, where it has one. */
  due: Partial<Record<Role, string>>;
  /** The property that holds a card's longer words. */
  description: string;
  /** The flag and its reason that say a card is blocked (they sit beside the status). */
  blocked: string;
  blockedReason: string;
  /** How a person adds a card of each role: the kind the write path (the `ops` workflow's `add`) takes. */
  make: Record<Role, { kind: string }>;
}

/** The plan the canvas writes: an initiative's milestones and their features. */
export const PLAN: Roles = {
  goal: "Initiative",
  group: "Milestone",
  work: "Feature",
  contains: ["HAS_MILESTONE", "HAS_FEATURE"],
  statuses: {
    goal: ["planned", "active", "done", "dropped"],
    group: ["planned", "active", "done", "dropped"],
    work: ["planned", "active", "done", "dropped"],
  },
  due: { goal: "target_date", group: "due_date" },
  description: "description",
  blocked: "blocked",
  blockedReason: "blocked_reason",
  make: { goal: { kind: "initiative" }, group: { kind: "milestone" }, work: { kind: "feature" } },
};

export interface RawNode {
  ref_id: string;
  name?: string;
  properties?: Record<string, unknown>;
}
export interface RawEdge {
  source: string;
  target: string;
  edge_type: string;
}

/** A change waiting on a person's yes or no, drawn in pencil where it would land. */
export interface Pencil {
  proposalId: string;
  title: string;
  rationale?: string;
}

export interface Card {
  id: string;
  role: Role;
  title: string;
  state: State;
  /** The type's own word for its status, lower case ("planned", "active"); "" when it has none. */
  status: string;
  /** Its place among its siblings; cards without one sort after those with. */
  seq: number;
  /** When it was written (epoch ms), 0 when unknown. */
  at: number;
  /** Who wrote it, when the graph says. */
  by: "person" | "agent" | null;
  /** Everything the graph holds on it, as written: what its details show and a person edits. */
  props: Record<string, unknown>;
  /** A proposed card nobody has accepted yet: not in the graph, drawn in pencil. */
  pencil?: Pencil;
  /** A proposed new title for this card, waiting on a yes or no. */
  pencilEdit?: Pencil & { name: string };
}

export interface Plan {
  cards: Record<string, Card>;
  /** A card's children, in order. */
  kids: Record<string, string[]>;
  parent: Record<string, string>;
  /** Every goal: the ones in progress first, then the fullest, then the newest. */
  goals: string[];
}

const DONE = new Set(["completed", "complete", "done"]);
const PROG = new Set(["in_progress", "active", "started"]);

/** A status in the type's own words, as the canvas's four states. `blocked` wins over the status. */
export function stateOf(status: string, blocked = false): State {
  if (blocked || status === "blocked") return "block";
  if (DONE.has(status)) return "done";
  if (PROG.has(status)) return "prog";
  return "idle";
}

/** A removed card stays in the graph (so it can be restored); the canvas never draws it. */
export function isLive(props: Record<string, unknown> | undefined): boolean {
  return !props?.["removed_at"];
}

const AGENTS = new Set(["jamie", "strut", "model", "agent"]);
const PEOPLE = new Set(["person", "user", "human"]);

export function byOf(p: Record<string, unknown>): "person" | "agent" | null {
  const kind = String(p["created_by_kind"] ?? p["made_by"] ?? "").toLowerCase();
  return AGENTS.has(kind) ? "agent" : PEOPLE.has(kind) ? "person" : null;
}

export function cardOf(role: Role, n: RawNode, roles: Roles = PLAN): Card {
  const p = n.properties ?? {};
  const status = typeof p["status"] === "string" ? p["status"].toLowerCase() : "";
  const added = p["date_added_to_graph"];
  return {
    id: n.ref_id,
    role,
    title: (n.name || (typeof p["name"] === "string" ? p["name"] : "") || n.ref_id.slice(0, 8)).trim(),
    state: stateOf(status, p[roles.blocked] === true || p[roles.blocked] === "true"),
    status,
    seq: typeof p["sequence"] === "number" ? p["sequence"] : Number.MAX_SAFE_INTEGER,
    at: typeof added === "number" ? added : 0,
    by: byOf(p),
    props: p,
  };
}

/** What may sit under what: a goal holds groups (and work with no group), a group holds work. */
const HOLDS: Record<Role, Role[]> = { goal: ["group", "work"], group: ["work"], work: [] };

const orderOf = (cards: Record<string, Card>) => (x: string, y: string) => cards[x]!.seq - cards[y]!.seq || cards[x]!.title.localeCompare(cards[y]!.title);

function goalsOf(cards: Record<string, Card>, kids: Record<string, string[]>): string[] {
  return Object.values(cards)
    .filter((c) => c.role === "goal")
    .sort((x, y) => Number(y.state === "prog") - Number(x.state === "prog") || (kids[y.id]?.length ?? 0) - (kids[x.id]?.length ?? 0) || y.at - x.at || x.title.localeCompare(y.title))
    .map((c) => c.id);
}

export function buildPlan(nodes: Record<Role, RawNode[]>, edges: RawEdge[], roles: Roles = PLAN): Plan {
  const cards: Record<string, Card> = {};
  for (const role of ["goal", "group", "work"] as const) {
    for (const n of nodes[role] ?? []) if (isLive(n.properties) && !cards[n.ref_id]) cards[n.ref_id] = cardOf(role, n, roles);
  }
  const contains = new Set(roles.contains);
  const kids: Record<string, string[]> = {};
  const parent: Record<string, string> = {};
  for (const e of edges) {
    const a = cards[e.source];
    const b = cards[e.target];
    // The first parent wins: a card is drawn once.
    if (!a || !b || !contains.has(e.edge_type) || !HOLDS[a.role].includes(b.role) || parent[b.id]) continue;
    parent[b.id] = a.id;
    (kids[a.id] ??= []).push(b.id);
  }
  for (const id of Object.keys(kids)) kids[id]!.sort(orderOf(cards));
  return { cards, kids, parent, goals: goalsOf(cards, kids) };
}

/** The plan with proposed cards drawn in (in pencil, after their siblings) and proposed renames on their cards. */
export function withPencils(plan: Plan, made: Array<{ id: string; role: Role; title: string; parent?: string; pencil: Pencil }>, edits: Record<string, Pencil & { name: string }>): Plan {
  if (!made.length && !Object.keys(edits).length) return plan;
  const cards = { ...plan.cards };
  const kids: Record<string, string[]> = { ...plan.kids };
  const parent = { ...plan.parent };
  for (const [id, e] of Object.entries(edits)) if (cards[id]) cards[id] = { ...cards[id]!, pencilEdit: e };
  for (const m of made) {
    if (m.parent && !cards[m.parent]) continue;
    if (m.role !== "goal" && !m.parent) continue;
    cards[m.id] = { id: m.id, role: m.role, title: m.title, state: "idle", status: "proposed", seq: Number.MAX_SAFE_INTEGER, at: Date.now(), by: "agent", props: {}, pencil: m.pencil };
    if (m.parent) {
      parent[m.id] = m.parent;
      kids[m.parent] = [...(kids[m.parent] ?? []), m.id];
    }
  }
  return { cards, kids, parent, goals: goalsOf(cards, kids) };
}

/** The goal a card belongs to (itself, for a goal); null for a card under no goal. */
export function goalOf(plan: Plan, id: string): string | null {
  let at: string | undefined = id;
  for (let i = 0; at && i < 8; i++) {
    if (plan.cards[at]?.role === "goal") return at;
    at = plan.parent[at];
  }
  return null;
}

/** How much of a card's children is done. */
export function progress(plan: Plan, id: string): { done: number; total: number } {
  const ks = (plan.kids[id] ?? []).filter((k) => !plan.cards[k]?.pencil);
  return { done: ks.filter((k) => plan.cards[k]?.state === "done").length, total: ks.length };
}

/** A time as the graph writes it: epoch ms or seconds, or an ISO string. 0 when it is none of those. */
export function timeOf(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v > 0 && v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return timeOf(n);
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

/** The fields a card's times are kept in: added to the graph, written, changed, done. */
const TIME_FIELDS = ["date_added_to_graph", "created_at", "updated_at", "completed_at"];

/** When a card last moved: the latest of its own times. */
export function cardTime(c: Card): number {
  return Math.max(c.at, ...TIME_FIELDS.map((k) => timeOf(c.props[k])));
}

/** When anything in a goal last moved: the latest time of the goal and every card under it. */
export function lastActivity(plan: Plan, goal: string): number {
  let latest = 0;
  const walk = (id: string, depth: number) => {
    const c = plan.cards[id];
    if (!c || depth > 8) return;
    latest = Math.max(latest, cardTime(c));
    for (const k of plan.kids[id] ?? []) walk(k, depth + 1);
  };
  walk(goal, 0);
  return latest;
}

/** A goal kept out of the home map: a test made by a check, named as checks name theirs. Data, not a rule about one plan. */
export const TEST_GOAL = /\(safe to delete\)/i;

/** The goals the home map is about: every goal but the tests. */
export function mapGoals(plan: Plan, isTest: (c: Card) => boolean = (c) => TEST_GOAL.test(c.title)): string[] {
  return plan.goals.filter((g) => !isTest(plan.cards[g]!));
}

/** The goals the canvas opens on: the `most` most recently active, drafts included (soft-deleted ones are never in
 *  the plan), the newest first. A handful, so the centre of the map can be read at a glance. */
export function openingGoals(plan: Plan, most = 5, isTest?: (c: Card) => boolean): string[] {
  const goals = mapGoals(plan, isTest);
  const when = new Map(goals.map((g) => [g, lastActivity(plan, g)]));
  return [...goals].sort((x, y) => when.get(y)! - when.get(x)! || plan.cards[x]!.title.localeCompare(plan.cards[y]!.title)).slice(0, most);
}

/** One write through the `ops` workflow: the run's input. */
export type OpsInput = Record<string, string>;

/** A new card of `role` (under `under`, unless it is a goal): what `ops` `add` is given. */
export function addRequest(roles: Roles, role: Role, title: string, under?: Card): OpsInput {
  return { op: "add", kind: roles.make[role].kind, text: title, ...(under ? { parent: under.id } : {}) };
}

/** A person's change to one of a card's facts, as the `ops` call that makes it. */
export type Fact = { name: string } | { status: string } | { description: string } | { due: string } | { blocked: boolean; reason?: string };

export function editRequest(roles: Roles, card: Card, fact: Fact): OpsInput {
  if ("name" in fact) return { op: "edit", ref_id: card.id, field: "name", value: fact.name };
  if ("description" in fact) return { op: "edit", ref_id: card.id, field: roles.description, value: fact.description };
  if ("due" in fact) {
    const field = roles.due[card.role];
    if (!field) throw new Error(`A ${card.role} has no date to set`);
    return { op: "edit", ref_id: card.id, field, value: fact.due };
  }
  if ("status" in fact) return { op: "set_status", ref_id: card.id, value: fact.status };
  // Blocked sits beside the status: setting it keeps the status; clearing it sets the status it already has.
  if (fact.blocked) return { op: "set_status", ref_id: card.id, value: "BLOCKED", ...(fact.reason ? { reason: fact.reason } : {}) };
  const current = String(card.props["status"] ?? "") || roles.statuses[card.role][0]!;
  return { op: "set_status", ref_id: card.id, value: current };
}
