import { z, defineStep } from "strut";
import { call, step } from "./_canvas.js";

const WHO = "stadeum/canvas/brainstorm-tree";

export default defineStep({
  type: "stadeum/canvas/brainstorm-tree",
  description:
    "One brainstorm's tree for the canvas's side panel: { root, state, nodes: [{ ref_id, depth, kind, label, text, made_by, state, " +
    "recommended, ratings: { fast, good, cheap } | null, effects: [{ name, description, score, direction }] }] }.",
  effect: "read",
  input: z.object({ root: z.string() }),
  output: z.any(),
  async run(cfg, ctx) {
    const t = await call(ctx, step("tree"), { root: cfg.root }, WHO);
    const raw: Array<Record<string, any>> = t.nodes ?? [];
    if (!raw.length) throw new Error(`${WHO}: no brainstorm under ${cfg.root}`);
    const nodes = raw.map((n) => ({
      ref_id: n["ref_id"],
      depth: n["depth"],
      kind: n["kind"],
      label: n["label"] ?? "",
      text: n["text"],
      made_by: n["made_by"] ?? null,
      state: n["state"] ?? "open",
      recommended: !!n["recommended"],
      ratings: n["ratings"] ?? null,
      effects: (n["effects"] ?? []).map((e: Record<string, unknown>) => ({ name: e["name"], description: e["description"], score: e["score"], direction: e["direction"] })),
    }));
    return { root: cfg.root, state: nodes[0]?.state ?? "open", nodes };
  },
});
