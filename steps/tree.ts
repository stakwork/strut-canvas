import { z, defineStep } from "strut";
import { AGAINST, HAS_EFFECT, PARENT_OF, QUESTION, TREE_TYPES, getNode, getNodes, linked, live, type Node } from "./_canvas.js";

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

    // Breadth first along PARENT_OF, reading each level's nodes in one batch so removed ones (and what hangs under them) drop out.
    type Raw = { node: Node; parent: string | null; depth: number };
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
    for (const n of nodes) {
      if (n.kind !== "option") continue;
      const effs = await linked(ctx, n.ref_id, HAS_EFFECT, "forward", { who: WHO });
      if (!effs.length) continue;
      const got = await getNodes(ctx, effs.map((e) => e.ref_id), WHO);
      for (const e of effs) {
        const en = got.get(e.ref_id);
        if (!en || !live(en.properties)) continue;
        const against = (await linked(ctx, e.ref_id, AGAINST, "forward", { who: WHO }))[0];
        const score = num(en.properties["score"]);
        n.effects.push({
          ref_id: e.ref_id,
          name: (en.properties["name"] as string) ?? en.name ?? null,
          description: (en.properties["description"] as string) ?? null,
          score,
          direction: score === null ? null : score > 0 ? "pro" : "con",
          requirement: against?.ref_id ?? null,
        });
      }
    }

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
      const crit = n.kind === "question" && (n.criteria || n.reversibility) ? ` {criteria: ${n.criteria ?? "-"}; ${n.reversibility ?? "-"}}` : "";
      const dup = n.other_parents.length ? ` (also linked under ${n.other_parents.map((id) => byId.get(id)?.label || id).join(", ")})` : "";
      lines.push(`${"  ".repeat(n.depth)}${n.label ? `${n.label}. ` : ""}${n.text} ${tag}${q}${crit}${dup} [${n.ref_id}]`);
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

