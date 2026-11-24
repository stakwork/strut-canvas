/**
 * What every step of stadeum/canvas shares: the canvas's types, links and
 * statuses in one place, and the graph, reached only through strut's own
 * `graph/*` steps so the package runs on any strut (Neo4j or a LadybugDB
 * file) and every write lands in strut's change feed.
 *
 * The contract (what each type holds and how they link) is the Canvas
 * Planning and Brainstorm pages, `concepts/`.
 */
export const PKG = "stadeum/canvas";
/** A step of this package by its name: `step("tree")` → `stadeum/canvas/tree`. */
export const step = (name: string) => `${PKG}/${name}`;

// ── the plan: an initiative, its milestones, their features ─────────────
export const INITIATIVE = "Initiative";
export const MILESTONE = "Milestone";
export const FEATURE = "Feature";
// ── why it exists ───────────────────────────────────────────────────────
export const BRIEF = "Brief";
export const STORY = "UserStory";
export const REQUIREMENT = "Requirement";
export const ARCHITECTURE = "Architecture";
// ── a brainstorm: questions, their options, what an option would cause ──
export const QUESTION = "Question";
export const OPTION = "Option";
export const EFFECT = "Effect";

export const PLAN_TYPES = [INITIATIVE, MILESTONE, FEATURE];
export const TREE_TYPES = [QUESTION, OPTION];
export const CANVAS_TYPES = [INITIATIVE, BRIEF, STORY, REQUIREMENT, MILESTONE, FEATURE, ARCHITECTURE, QUESTION, OPTION, EFFECT];

export const HAS_BRIEF = "HAS_BRIEF";
export const HAS_STORY = "HAS_STORY";
export const HAS_REQUIREMENT = "HAS_REQUIREMENT";
export const HAS_MILESTONE = "HAS_MILESTONE";
export const HAS_FEATURE = "HAS_FEATURE";
export const HAS_ARCHITECTURE = "HAS_ARCHITECTURE";
export const SATISFIES = "SATISFIES";
/** Question → the plan card it is about (the root of a brainstorm). */
export const ABOUT = "ABOUT";
/** Question → Option, Question → sub-question, Option → follow-up question. */
export const PARENT_OF = "PARENT_OF";
export const HAS_EFFECT = "HAS_EFFECT";
/** Effect → the requirement it is weighed against. */
export const AGAINST = "AGAINST";
/** A chosen option → the card it made one level down. */
export const RESULTED_IN = "RESULTED_IN";
/** The links that hang a card under another: what a removal takes with it. */
export const DOWN = [HAS_BRIEF, HAS_STORY, HAS_REQUIREMENT, HAS_MILESTONE, HAS_FEATURE, HAS_ARCHITECTURE, PARENT_OF, HAS_EFFECT];

// ── statuses: one set for the initiative, a milestone and a feature ──────
export const STATUSES = ["planned", "active", "done", "dropped"] as const;
export type Status = (typeof STATUSES)[number];
const STATUS_ALIAS: Record<string, Status> = {
  todo: "planned", draft: "planned", backlog: "planned", not_started: "planned", planned: "planned",
  active: "active", in_progress: "active", progress: "active", started: "active", doing: "active",
  done: "done", complete: "done", completed: "done", finished: "done", shipped: "done",
  dropped: "dropped", cancelled: "dropped", canceled: "dropped",
};
/** A status as people and agents say it, as the canvas writes it; `blocked` is the flag beside the status, not a status. */
export function normStatus(raw: unknown, who = "canvas"): Status | "blocked" {
  const k = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (k === "blocked") return "blocked";
  const v = STATUS_ALIAS[k];
  if (!v) throw new Error(`${who}: "${raw}" is not a status (use ${STATUSES.join(", ")}, or blocked). Nothing was written.`);
  return v;
}

// ── small things ────────────────────────────────────────────────────────
export const uuid = (): string => (globalThis as { crypto: { randomUUID(): string } }).crypto.randomUUID();
export const clip = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
export const isTrue = (x: unknown) => x === true || x === "true";

/** A removed card stays in the graph with `removed_at` set, so it can be put back with everything under it. */
export const live = (props: Record<string, unknown> | undefined | null) => !props?.["removed_at"];

/** The jobs on a card, as it holds them: a JSON list of job ids. */
export const jobsOf = (raw: unknown): string[] => {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

/** A write-order number for a brainstorm card: its labels (A, B, 1, 2) follow it. */
const SEQ: { n: number } = ((globalThis as { __canvasSeq?: { n: number } }).__canvasSeq ??= { n: 0 });
export const nextSeq = () => Date.now() * 1000 + (SEQ.n++ % 1000);

/** The live initiative with this name (case and spacing aside), other than `self`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initiativeNamed(ctx: any, name: string, self: string | null, who = "canvas"): Promise<{ ref_id: string; name: string } | null> {
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await call(ctx, "graph/find", { node_type: INITIATIVE, where: { removed_at: null }, limit: 500, ...(cursor ? { cursor } : {}) }, who);
    for (const n of page?.nodes ?? []) {
      const nm = String(n.name ?? n.properties?.["name"] ?? "");
      if (n.ref_id !== self && norm(nm) === norm(name)) return { ref_id: n.ref_id, name: nm };
    }
    cursor = page?.cursor;
    if (!cursor) break;
  }
  return null;
}

/** Where a feature is built: `repo` (code in a repository, a Code Change job) or `strut` (workflows, steps or an app on this strut server, a builder job). */
export type BuildsIn = "repo" | "strut";
const BUILDS_IN: Record<string, BuildsIn> = {
  repo: "repo", repository: "repo", code: "repo", git: "repo", job: "repo",
  strut: "strut", workflow: "strut", workflows: "strut", app: "strut", step: "strut", builder: "strut",
};
export function normBuildsIn(raw: unknown, who = "canvas"): BuildsIn {
  const v = BUILDS_IN[String(raw ?? "").trim().toLowerCase()];
  if (!v) throw new Error(`${who}: builds_in is repo (code in a repository) or strut (workflows or an app on this strut server), not "${raw}". Nothing was written.`);
  return v;
}
/** A list of repositories' https addresses, as an architecture holds it (JSON text). */
export function reposOf(raw: unknown, who = "canvas"): string[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      list = JSON.parse(t);
    } catch {
      list = t.split(/[\s,]+/);
    }
  }
  if (!Array.isArray(list)) throw new Error(`${who}: repos is a list of repositories' https addresses`);
  const out = list.map((x) => String(x).trim()).filter(Boolean);
  for (const u of out) if (!/^https:\/\/[^\s]+$/.test(u)) throw new Error(`${who}: "${u}" is not a repository's https address`);
  return [...new Set(out)];
}

/** Who launched the run: a person's actor id as strut gives it, never anything from the input or a model. */
export function actorOf(ctx: unknown): string | null {
  const a = (ctx as { actor?: unknown })?.actor;
  return typeof a === "string" && a.trim() ? a.trim() : null;
}

// ── strut's steps ───────────────────────────────────────────────────────
interface StepDef {
  input: { parse(v: unknown): unknown };
  run(cfg: unknown, ctx: unknown): Promise<unknown>;
}
/**
 * Run a step through the registry, as the calling run. A graph step answers
 * a problem as a string: that throws here, named after the caller.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call(ctx: any, type: string, cfg: Record<string, unknown>, who = "canvas"): Promise<any> {
  const def = (ctx?.registry as Record<string, StepDef | undefined> | undefined)?.[type];
  if (!def) throw new Error(`${who}: the step ${type} is not on this strut server`);
  const out = await def.run(def.input.parse(cfg), ctx);
  if (typeof out === "string") throw new Error(`${who}: ${type}: ${out}`);
  return out;
}

export interface Node {
  ref_id: string;
  node_type: string;
  name?: string;
  properties: Record<string, unknown>;
}
export interface Neighbor {
  ref_id: string;
  node_type: string;
  name?: string;
  edge_type: string;
  direction: "forward" | "reverse";
}

/** One node, or null when there is none (or it is gone from the graph). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getNode(ctx: any, ref: string, who = "canvas"): Promise<Node | null> {
  const r = await call(ctx, "graph/graph-get-batched", { ref_ids: [ref] }, who);
  const n = (r?.nodes ?? [])[0];
  if (!n || n.error) return null;
  return { ref_id: n.ref_id, node_type: n.node_type, name: n.name, properties: n.properties ?? {} };
}

/** Many nodes by ref, fifty at a time. A ref the graph does not have is left out. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getNodes(ctx: any, refs: string[], who = "canvas"): Promise<Map<string, Node>> {
  const out = new Map<string, Node>();
  const ids = [...new Set(refs)];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await call(ctx, "graph/graph-get-batched", { ref_ids: ids.slice(i, i + 50) }, who);
    for (const n of r?.nodes ?? []) if (!n.error) out.set(n.ref_id, { ref_id: n.ref_id, node_type: n.node_type, name: n.name, properties: n.properties ?? {} });
  }
  return out;
}

/** graph/graph-neighbors answers at most this many. */
export const NEIGHBOR_CAP = 50;

/** A node's links of one type, one way. Refuses a list that may be cut short. */
export async function linked(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  ref: string,
  edge: string,
  dir: "forward" | "reverse",
  opts: { types?: string[]; who?: string } = {},
): Promise<Neighbor[]> {
  const who = opts.who ?? "canvas";
  const r = (await call(ctx, "graph/graph-neighbors", { ref_id: ref, edge_type: [edge], ...(opts.types ? { node_type: opts.types } : {}) }, who)) as Neighbor[];
  if (r.length >= NEIGHBOR_CAP) throw new Error(`${who}: ${ref} has ${NEIGHBOR_CAP} or more ${edge} links, so the read may be cut short; refusing a partial read`);
  return r.filter((x) => x.edge_type === edge && x.direction === dir);
}

/** A node's links of one type, one way, to cards that are not removed. */
export async function linkedLive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  ref: string,
  edge: string,
  dir: "forward" | "reverse",
  opts: { types?: string[]; who?: string } = {},
): Promise<Node[]> {
  const nb = await linked(ctx, ref, edge, dir, opts);
  if (!nb.length) return [];
  const got = await getNodes(ctx, nb.map((n) => n.ref_id), opts.who);
  return nb.map((n) => got.get(n.ref_id)).filter((n): n is Node => !!n && live(n.properties));
}
