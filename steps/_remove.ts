/**
 * Removing a card from the canvas, and putting it back. A removed card stays
 * in the graph with `removed_at` set, and so does everything under it: the
 * links are kept, so a restore brings the whole subtree back as it was. Every
 * reader of the canvas leaves removed cards out (`live`).
 */
import {
  ABOUT,
  CANVAS_TYPES,
  DOWN,
  INITIATIVE,
  NEIGHBOR_CAP,
  PARENT_OF,
  QUESTION,
  TREE_TYPES,
  actorOf,
  call,
  clip,
  getNode,
  getNodes,
  live,
  step,
  type Neighbor,
  type Node,
} from "./_canvas.js";

const REMOVAL = ["removed_at", "removed_by", "removed_reason", "removed_run", "removed_top"];
const nameOf = (p: Record<string, unknown>) => clip(String(p["name"] ?? p["text"] ?? p["title"] ?? ""), 80);

export interface Removed {
  ref_id: string;
  node_type: string;
  name: string;
  /** A person wrote it. */
  human: boolean;
}
const info = (n: Node): Removed => ({
  ref_id: n.ref_id,
  node_type: n.node_type,
  name: nameOf(n.properties),
  human: n.properties["created_by_kind"] === "human" || n.properties["made_by"] === "user",
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function around(ctx: any, ref: string, who: string): Promise<Neighbor[]> {
  const edges = [...DOWN, ABOUT];
  const all = (await call(ctx, "graph/graph-neighbors", { ref_id: ref, edge_type: edges }, who)) as Neighbor[];
  if (all.length < NEIGHBOR_CAP) return all;
  const out: Neighbor[] = [];
  for (const e of edges) {
    const one = (await call(ctx, "graph/graph-neighbors", { ref_id: ref, edge_type: [e] }, who)) as Neighbor[];
    if (one.length >= NEIGHBOR_CAP) throw new Error(`${who}: ${ref} has ${NEIGHBOR_CAP} or more ${e} links; refusing a partial read`);
    out.push(...one);
  }
  return out;
}
/** What hangs under a card: its DOWN links, and the brainstorms ABOUT it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function under(ctx: any, ref: string, who: string): Promise<string[]> {
  return (await around(ctx, ref, who))
    .filter((x) => (x.edge_type === ABOUT ? x.direction === "reverse" && x.node_type === QUESTION : x.direction === "forward"))
    .filter((x) => CANVAS_TYPES.includes(x.node_type))
    .map((x) => x.ref_id);
}
/** What a card hangs under: the reverse of `under`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function over(ctx: any, ref: string, who: string): Promise<string[]> {
  return (await around(ctx, ref, who))
    .filter((x) => (x.edge_type === ABOUT ? x.direction === "forward" : x.direction === "reverse"))
    .filter((x) => CANVAS_TYPES.includes(x.node_type))
    .map((x) => x.ref_id);
}

/** The initiative a card belongs to, through its parents (removed ones too). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initiativeOf(ctx: any, ref: string, who = "canvas"): Promise<string | null> {
  let cur = ref;
  const seen = new Set([ref]);
  for (let i = 0; i < 30; i++) {
    const n = await getNode(ctx, cur, who);
    if (!n) return null;
    if (n.node_type === INITIATIVE) return cur;
    const up = (await over(ctx, cur, who)).filter((p) => !seen.has(p));
    if (!up.length) return null;
    cur = up[0]!;
    seen.add(cur);
  }
  return null;
}

export interface RemoveOpts {
  reason?: string;
  /** Leave the work check out (the caller ran it). */
  skipGuard?: boolean;
  /** The job doing the remove: it names the card because a person asked from it, which is not work on it. */
  ignoreJob?: string;
  dryRun?: boolean;
  who?: string;
}

/** Remove a card and everything under it. Refuses a card work has started on (`work_started:`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function removeCard(ctx: any, ref: string, opts: RemoveOpts = {}) {
  const who = opts.who ?? "canvas";
  const top = await getNode(ctx, ref, who);
  if (!top) throw new Error(`${who}: node ${ref} not found`);
  if (!CANVAS_TYPES.includes(top.node_type)) throw new Error(`${who}: ${ref} is a ${top.node_type}, not a canvas card`);
  if (!live(top.properties)) throw new Error(`${who}: ${top.node_type} "${nameOf(top.properties)}" is already removed`);
  if (!opts.skipGuard) await call(ctx, step("guard"), { ref_ids: [ref], ...(opts.ignoreJob ? { ignore_job: opts.ignoreJob } : {}) }, who);

  const set = new Map<string, Node>([[ref, top]]);
  const queue = [ref];
  while (queue.length) {
    const id = queue.shift()!;
    const kids = (await under(ctx, id, who)).filter((k) => !set.has(k));
    const got = await getNodes(ctx, kids, who);
    for (const k of kids) {
      const n = got.get(k);
      if (!n || !live(n.properties) || set.has(k)) continue;
      set.set(k, n);
      queue.push(k);
    }
    if (set.size > 5000) throw new Error(`${who}: more than 5000 cards under ${ref}; refusing`);
  }
  // A brainstorm card that also hangs under a live card outside what is removed stays.
  const keep = new Set<string>();
  for (const [id, n] of set) {
    if (id === ref || !TREE_TYPES.includes(n.node_type)) continue;
    const parents = (await call(ctx, "graph/graph-neighbors", { ref_id: id, edge_type: [PARENT_OF] }, who)) as Neighbor[];
    const outside = parents.filter((p) => p.direction === "reverse" && !set.has(p.ref_id)).map((p) => p.ref_id);
    if (!outside.length) continue;
    const got = await getNodes(ctx, outside, who);
    if ([...got.values()].some((p) => live(p.properties))) keep.add(id);
  }
  const doomed = [...set.values()].filter((n) => !keep.has(n.ref_id));
  const out = {
    ref_id: ref,
    node_type: top.node_type,
    name: nameOf(top.properties),
    initiative_ref: await initiativeOf(ctx, ref, who),
    removed: doomed.map(info),
    kept_shared: [...keep],
    dry_run: !!opts.dryRun,
  };
  if (opts.dryRun) return out;
  const stamp = {
    removed_at: Date.now(),
    removed_reason: opts.reason?.trim() || "removed from the canvas",
    removed_run: String(ctx.runId ?? ""),
    removed_top: ref,
    ...(actorOf(ctx) ? { removed_by: actorOf(ctx) } : {}),
  };
  for (const n of doomed) await call(ctx, "graph/edit-node", { ref_id: n.ref_id, node_data: stamp }, who);
  return out;
}

/** Put back a removed card and what was removed with it (the same removal). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function restoreCard(ctx: any, ref: string, who = "canvas") {
  const top = await getNode(ctx, ref, who);
  if (!top) throw new Error(`${who}: node ${ref} not found`);
  if (live(top.properties)) throw new Error(`${who}: ${top.node_type} "${nameOf(top.properties)}" is not removed; nothing to restore`);
  const parents = await getNodes(ctx, await over(ctx, ref, who), who);
  if (parents.size && [...parents.values()].every((p) => !live(p.properties))) {
    throw new Error(`${who}: ${top.node_type} "${nameOf(top.properties)}" is under a card that is still removed; restore that one first (${[...parents.values()].map((p) => `${p.node_type} ${p.ref_id}`).join(", ")})`);
  }
  const run = top.properties["removed_run"];
  const set = new Map<string, Node>([[ref, top]]);
  const queue = [ref];
  while (queue.length) {
    const id = queue.shift()!;
    const kids = (await under(ctx, id, who)).filter((k) => !set.has(k));
    const got = await getNodes(ctx, kids, who);
    for (const k of kids) {
      const n = got.get(k);
      if (!n || live(n.properties) || set.has(k)) continue;
      if (run && n.properties["removed_run"] !== run) continue;
      set.set(k, n);
      queue.push(k);
    }
    if (set.size > 5000) throw new Error(`${who}: more than 5000 cards under ${ref}; refusing`);
  }
  for (const n of set.values()) {
    const has = REMOVAL.filter((k) => n.properties[k] !== undefined && n.properties[k] !== null);
    await call(ctx, "graph/edit-node", { ref_id: n.ref_id, properties_to_be_deleted: has }, who);
  }
  return {
    ref_id: ref,
    node_type: top.node_type,
    name: nameOf(top.properties),
    initiative_ref: await initiativeOf(ctx, ref, who),
    restored: [...set.values()].map(info),
  };
}
