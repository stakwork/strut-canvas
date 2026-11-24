import { z, defineStep } from "strut";
import { AGAINST, EFFECT, HAS_EFFECT, OPTION, PARENT_OF, QUESTION, REQUIREMENT, TREE_TYPES, call, getNode, getNodes, linked, live, type Node } from "./_canvas.js";

const WHO = "stadeum/canvas/tree";
const letters = (i: number) => {
  let s = "";
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
};
const num = (x: unknown) => (x === undefined || x === null || x === "" ? null : Number(x));
/** Write order: the card's `seq`, else when strut stamped it. */
const stampOf = (p: Record<string, unknown>) => (p["seq"] !== undefined && p["seq"] !== null ? String(p["seq"]).padStart(20, "0") : String(p["created_at"] ?? p["date_added_to_graph"] ?? ""));
function makesOf(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = list.split("\n");
    }
  }
  return Array.isArray(list) ? list.map((x) => String((x as { name?: unknown })?.name ?? x).trim()).filter(Boolean) : [];
}

export interface TreeNode {
  ref_id: string;
  node_type: string;
  kind: "question" | "option";
  parent: string | null;
  depth: number;
  label: string;
  role: "root" | "sub_question" | "follow_up" | "option" | "";
  text: string | null;
  made_by: string | null;
  by: string | null;
  speaker: string | null;
  quote: string | null;
  state: string | null;
  /** Who chose it aloud on a call, and their words. */
  state_speaker: string | null;
  state_quote: string | null;
  criteria: string | null;
  reversibility: string | null;
  recommended: boolean;
  makes: string[];
  ratings: { fast: number | null; good: number | null; cheap: number | null } | null;
  job: string | null;
  run_id: string | null;
  turn: number | null;
  effects: Array<{ ref_id: string; name: string | null; description: string | null; score: number | null; direction: "pro" | "con" | null; requirement: string | null }>;
  other_parents: string[];
}

type Raw = { node: Node; parent: string | null; depth: number };
type Eff = { ref_id: string; name: string | null; description: string | null; score: number | null; requirement: string | null };
/** What the tree is read into: its nodes breadth first, the extra parents a node is linked under, each option's effects. */
interface Read {
  order: Raw[];
  extra: Map<string, string[]>;
  effects: Map<string, Eff[]>;
}

/** graph/find's page, and graph-edges' limits: ids per call, and the others an edge may lead to. */
const PAGE = 500;
const EDGE_IDS = 1000;
const EDGE_AMONG = 5000;

/** Every node of a type (live ones unless `all`), or null past 20 pages: too many to read whole. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findAll(ctx: any, type: string, all = false): Promise<Node[] | null> {
  const out: Node[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await call(ctx, "graph/find", { node_type: type, ...(all ? {} : { where: { removed_at: null } }), limit: PAGE, ...(cursor ? { cursor } : {}) }, WHO);
    for (const n of page?.nodes ?? []) out.push({ ref_id: n.ref_id, node_type: n.node_type ?? type, name: n.name, properties: n.properties ?? {} });
    cursor = page?.cursor;
    if (!cursor) return out;
  }
  return null;
}

/** The edges among `ids`, and from them to `among`, a thousand ids a call; null when they do not fit graph-edges. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function edgesAmong(ctx: any, ids: string[], among: string[]): Promise<Array<{ source: string; target: string; edge_type: string }> | null> {
  const out: Array<{ source: string; target: string; edge_type: string }> = [];
  for (let i = 0; i < ids.length; i += EDGE_IDS) {
    const rest = ids.length > EDGE_IDS ? [...ids.slice(0, i), ...ids.slice(i + EDGE_IDS)] : [];
    const others = [...among, ...rest];
    if (others.length > EDGE_AMONG) return null;
    const r = await call(ctx, "graph/graph-edges", { ref_ids: ids.slice(i, i + EDGE_IDS), among: others }, WHO);
    if (r?.truncated) return null;
    out.push(...(r?.edges ?? []));
  }
  return out;
}

/**
 * The tree read whole: every live question and option, their PARENT_OF links in one call, then the effects and what
 * they are weighed against the same way. A few calls whatever the tree's size (on a LadybugDB file each graph call
 * is tens of milliseconds, and the read card by card took 25 s for 85 cards). Null when the graph holds too many
 * brainstorm cards to read whole: then it is read card by card.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readWhole(ctx: any, r0: Node): Promise<Read | null> {
  const [qs, os] = await Promise.all([findAll(ctx, QUESTION), findAll(ctx, OPTION)]);
  if (!qs || !os) return null;
  const byId = new Map<string, Node>([...qs, ...os].map((n) => [n.ref_id, n]));
  byId.set(r0.ref_id, r0);
  const links = await edgesAmong(ctx, [...byId.keys()], []);
  if (!links) return null;
  const kids = new Map<string, string[]>();
  for (const e of links) if (e.edge_type === PARENT_OF && byId.has(e.source) && byId.has(e.target)) (kids.get(e.source) ?? kids.set(e.source, []).get(e.source)!).push(e.target);
  const order: Raw[] = [{ node: r0, parent: null, depth: 0 }];
  const seen = new Set([r0.ref_id]);
  const extra = new Map<string, string[]>();
  for (let i = 0; i < order.length; i++) {
    const n = order[i]!;
    for (const k of kids.get(n.node.ref_id) ?? []) {
      if (seen.has(k)) {
        if (k !== r0.ref_id) (extra.get(k) ?? extra.set(k, []).get(k)!).push(n.node.ref_id);
        continue;
      }
      seen.add(k);
      order.push({ node: byId.get(k)!, parent: n.node.ref_id, depth: n.depth + 1 });
    }
  }
  const options = order.filter((o) => o.node.node_type !== QUESTION).map((o) => o.node.ref_id);
  const effects = new Map<string, Eff[]>();
  if (!options.length) return { order, extra, effects };
  const [effs, reqs] = await Promise.all([findAll(ctx, EFFECT), findAll(ctx, REQUIREMENT, true)]);
  if (!effs || !reqs) return null;
  const effById = new Map(effs.map((n) => [n.ref_id, n]));
  const has = await edgesAmong(ctx, options, [...effById.keys()]);
  if (!has) return null;
  const mine = has.filter((e) => e.edge_type === HAS_EFFECT && effById.has(e.target));
  const against = new Map<string, string>();
  if (mine.length) {
    const ag = await edgesAmong(ctx, [...new Set(mine.map((e) => e.target))], reqs.map((r) => r.ref_id));
    if (!ag) return null;
    for (const e of ag) if (e.edge_type === AGAINST && !against.has(e.source)) against.set(e.source, e.target);
  }
  for (const e of mine) {
    const en = effById.get(e.target)!;
    (effects.get(e.source) ?? effects.set(e.source, []).get(e.source)!).push({ ref_id: en.ref_id, name: (en.properties["name"] as string) ?? en.name ?? null, description: (en.properties["description"] as string) ?? null, score: num(en.properties["score"]), requirement: against.get(en.ref_id) ?? null });
  }
  return { order, extra, effects };
}

/** The tree read card by card, along PARENT_OF a level at a time: for a graph too big to read whole. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readByCard(ctx: any, r0: Node): Promise<Read> {
  const root = r0.ref_id;
  const order: Raw[] = [{ node: r0, parent: null, depth: 0 }];
  const seen = new Set([root]);
  const extra = new Map<string, string[]>();
  for (let i = 0; i < order.length; i++) {
    const n = order[i]!;
    const kids = await linked(ctx, n.node.ref_id, PARENT_OF, "forward", { types: TREE_TYPES, who: WHO });
    const fresh = kids.filter((k) => {
      if (!seen.has(k.ref_id)) return true;
      if (k.ref_id !== root) (extra.get(k.ref_id) ?? extra.set(k.ref_id, []).get(k.ref_id)!).push(n.node.ref_id);
      return false;
    });
    const got = await getNodes(ctx, fresh.map((k) => k.ref_id), WHO);
    for (const k of fresh) {
      const node = got.get(k.ref_id);
      if (!node || !live(node.properties)) continue;
      seen.add(k.ref_id);
      order.push({ node, parent: n.node.ref_id, depth: n.depth + 1 });
    }
  }
  const effects = new Map<string, Eff[]>();
  for (const { node } of order) {
    if (node.node_type === QUESTION) continue;
    const effs = await linked(ctx, node.ref_id, HAS_EFFECT, "forward", { who: WHO });
    if (!effs.length) continue;
    const got = await getNodes(ctx, effs.map((e) => e.ref_id), WHO);
    for (const e of effs) {
      const en = got.get(e.ref_id);
      if (!en || !live(en.properties)) continue;
      const against = (await linked(ctx, e.ref_id, AGAINST, "forward", { who: WHO }))[0];
      (effects.get(node.ref_id) ?? effects.set(node.ref_id, []).get(node.ref_id)!).push({ ref_id: e.ref_id, name: (en.properties["name"] as string) ?? en.name ?? null, description: (en.properties["description"] as string) ?? null, score: num(en.properties["score"]), requirement: against?.ref_id ?? null });
    }
  }
  return { order, extra, effects };
}

export default defineStep({
  type: "stadeum/canvas/tree",
  description:
    "Read a whole brainstorm under its root question: Questions and Options along PARENT_OF (removed cards left out), each option with its " +
    "effects (Option -HAS_EFFECT-> Effect -AGAINST-> Requirement, score -1..1), its fast/good/cheap ratings, `makes` and `recommended`. " +
    "Output { root, count, nodes: [{ ref_id, kind, parent, depth, label, role, text, made_by, by, speaker, quote, state, criteria, " +
    "reversibility, recommended, makes, ratings, job, run_id, turn, effects }], outline, next_open, next_open_line }. Labels: a " +
    "sub-question is numbered (1, 2; 1.1), an option gets a letter after its question's label (A, 1A), a follow-up question passes its " +
    "option's label down; the root has none. next_open is the first open question (depth first) with no chosen option.",
  effect: "read",
  input: z.object({
    root: z.string().optional().describe("The root question's ref_id. Left out: an empty tree (a first turn)."),
  }),
  output: z.any(),
  async run(cfg, ctx) {
    const root = cfg.root;
    if (!root) return { root: null, count: 0, nodes: [], outline: "(no tree yet: first turn)", next_open: null, next_open_line: "No open question left." };
    const r0 = await getNode(ctx, root, WHO);
    if (!r0) throw new Error(`${WHO}: root ${root} not found. Pass the ref_id of the brainstorm's root question.`);
    if (r0.node_type !== QUESTION) throw new Error(`${WHO}: root ${root} is a ${r0.node_type}, not a Question`);
    if (!live(r0.properties)) throw new Error(`${WHO}: the brainstorm ${root} was removed`);

    // Breadth first along PARENT_OF; removed cards (and what hangs only under them) drop out.
    const { order, extra, effects } = (await readWhole(ctx, r0)) ?? (await readByCard(ctx, r0));

    const nodes: TreeNode[] = order.map(({ node, parent, depth }) => {
      const p = node.properties;
      const isQ = node.node_type === QUESTION;
      const fast = num(p["fast"]), good = num(p["good"]), cheap = num(p["cheap"]);
      return {
        ref_id: node.ref_id,
        node_type: node.node_type,
        kind: isQ ? "question" : "option",
        parent,
        depth,
        label: "",
        role: "",
        text: (p["text"] as string) ?? null,
        made_by: (p["made_by"] as string) ?? null,
        by: (p["by"] as string) ?? null,
        speaker: (p["speaker"] as string) ?? null,
        quote: (p["quote"] as string) ?? null,
        state: (p["state"] as string) ?? null,
        state_speaker: (p["state_speaker"] as string) ?? null,
        state_quote: (p["state_quote"] as string) ?? null,
        criteria: (p["criteria"] as string) ?? null,
        reversibility: (p["reversibility"] as string) ?? null,
        recommended: !isQ && (p["recommended"] === true || p["recommended"] === "true"),
        makes: isQ ? [] : makesOf(p["makes"]),
        ratings: isQ || (fast === null && good === null && cheap === null) ? null : { fast, good, cheap },
        job: (p["job"] as string) ?? null,
        run_id: (p["run_id"] as string) ?? null,
        turn: num(p["turn"]),
        effects: [],
        other_parents: extra.get(node.ref_id) ?? [],
        __stamp: stampOf(p),
      } as TreeNode & { __stamp: string };
    });

    // Each option's effects, and the requirement each is weighed against.
    for (const n of nodes) for (const e of effects.get(n.ref_id) ?? []) n.effects.push({ ...e, direction: e.score === null ? null : e.score > 0 ? "pro" : "con" });

    const byId = new Map(nodes.map((n) => [n.ref_id, n]));
    const kids = new Map<string, TreeNode[]>();
    for (const n of nodes) if (n.parent) (kids.get(n.parent) ?? kids.set(n.parent, []).get(n.parent)!).push(n);
    const stamp = (n: TreeNode) => (n as TreeNode & { __stamp: string }).__stamp;
    for (const list of kids.values()) list.sort((a, b) => stamp(a).localeCompare(stamp(b)) || a.ref_id.localeCompare(b.ref_id));

    const subLabel = (base: string, n: number) => (/[0-9]$/.test(base) ? `${base}.${n}` : `${base}${n}`);
    const label = (n: TreeNode, base: string) => {
      const list = kids.get(n.ref_id) ?? [];
      let qi = 0, oi = 0;
      for (const k of list) {
        if (k.kind === "question") {
          if (n.kind === "question") {
            k.label = subLabel(base, ++qi);
            k.role = "sub_question";
            label(k, k.label);
          } else {
            k.label = "";
            k.role = "follow_up";
            label(k, base);
          }
        } else {
          k.label = `${base}${letters(oi++)}`;
          k.role = "option";
          label(k, k.label);
        }
      }
    };
    const top = nodes[0]!;
    top.role = "root";
    label(top, "");

    let next_open: { ref_id: string; label: string; text: string | null } | null = null;
    const findOpen = (n: TreeNode) => {
      if (next_open) return;
      if (n.kind === "question" && n.state !== "decided") {
        const list = kids.get(n.ref_id) ?? [];
        const opts = list.filter((k) => k.kind === "option");
        const hasSubs = list.some((k) => k.kind === "question");
        // a topic root with only sub-questions is not itself a decision
        if (!opts.some((o) => o.state === "chosen") && (opts.length || !hasSubs)) {
          next_open = { ref_id: n.ref_id, label: n.label, text: n.text };
          return;
        }
      }
      for (const k of kids.get(n.ref_id) ?? []) findOpen(k);
    };
    findOpen(top);

    const lines: string[] = [];
    const ordered: TreeNode[] = [];
    const walk = (n: TreeNode) => {
      ordered.push(n);
      const tag = `[${n.made_by}, ${n.state}${n.speaker ? `, ${n.speaker}` : ""}${n.recommended ? ", recommended" : ""}]`;
      const q = n.quote ? ` — "${n.quote}"` : "";
      const chose = n.state_quote ? ` (chosen by ${n.state_speaker ?? "?"}: "${n.state_quote}")` : "";
      const crit = n.kind === "question" && (n.criteria || n.reversibility) ? ` {criteria: ${n.criteria ?? "-"}; ${n.reversibility ?? "-"}}` : "";
      const dup = n.other_parents.length ? ` (also linked under ${n.other_parents.map((id) => byId.get(id)?.label || id).join(", ")})` : "";
      lines.push(`${"  ".repeat(n.depth)}${n.label ? `${n.label}. ` : ""}${n.text} ${tag}${q}${chose}${crit}${dup} [${n.ref_id}]`);
      if (n.ratings) lines.push(`${"  ".repeat(n.depth + 1)}fast ${n.ratings.fast ?? "?"} · good ${n.ratings.good ?? "?"} · cheap ${n.ratings.cheap ?? "?"}`);
      for (const e of n.effects) lines.push(`${"  ".repeat(n.depth + 1)}effect ${e.score ?? "?"} — ${e.name ?? "(no name)"}: ${e.description ?? ""}`);
      for (const k of kids.get(n.ref_id) ?? []) walk(k);
    };
    walk(top);
    for (const n of ordered) delete (n as Partial<TreeNode & { __stamp: string }>).__stamp;
    // A ready-made sentence: a template evaluates both sides of `a ? b : c`.
    const nextOpen = next_open as { label: string; text: string | null } | null;
    const next_open_line = nextOpen ? `Next open question: ${nextOpen.label ? nextOpen.label + " " : ""}${nextOpen.text}` : "No open question left.";
    return { root, count: ordered.length, nodes: ordered, outline: lines.join("\n"), next_open, next_open_line };
  },
});

