import { z, defineStep } from "strut";
import { ABOUT, AGAINST, EFFECT, HAS_EFFECT, OPTION, PARENT_OF, QUESTION, actorOf, call, clip, getNode, live, nextSeq } from "./_canvas.js";

const WHO = "stadeum/canvas/brainstorm-write";

export default defineStep({
  type: "stadeum/canvas/brainstorm-write",
  description:
    "Write a CHECKED brainstorm draft (adds only, `brainstorm-check` first) in order: each Question and Option linked PARENT_OF under its " +
    "parent (an existing ref or an earlier action's tmp), an Option's `makes`, `recommended` and fast/good/cheap ratings, and each effect " +
    "as Option -HAS_EFFECT-> Effect { name, description, score } -AGAINST-> Requirement. A new tree's root question is linked ABOUT the " +
    "card it is about. The job, run and turn are stamped from the run. On a failure the nodes this turn wrote are taken back. " +
    "Output { root, turn, written: [{ ref_id, node_type, tmp?, text?, parent?, option?, against?, score? }] }.",
  effect: "write",
  input: z.object({
    draft: z.any(),
    tree: z.any().optional().describe("`tree`'s output for the brainstorm, before this turn"),
    root: z.string().optional(),
    about: z.string().optional().describe("A new brainstorm: the card it is about"),
    job: z.string(),
  }),
  output: z.any(),
  async run(cfg, ctx) {
    const actions: Array<Record<string, any>> = cfg.draft?.actions ?? [];
    if (!actions.length) throw new Error(`${WHO}: the draft has no actions`);
    const run_id = String(ctx.runId);
    const by = actorOf(ctx);
    const tree = cfg.tree ?? {};
    const turn = (tree.nodes ?? []).reduce((m: number, n: { turn?: unknown }) => Math.max(m, Number(n.turn ?? 0)), 0) + 1;
    const created: string[] = [];
    const written: Array<Record<string, unknown>> = [];
    const refs: Record<string, string> = {};
    let root = cfg.root ?? "";
    const mk = async (type: string, data: Record<string, unknown>) => {
      const r = await call(ctx, "graph/create-node", { node_type: type, node_data: data }, WHO);
      created.push(r.ref_id);
      return r.ref_id as string;
    };
    const link = (from: string, edge: string, to: string) => call(ctx, "graph/create-triplet", { source_ref_id: from, edge_type: edge, target_ref_id: to }, WHO);
    try {
      if (cfg.about && !cfg.root) {
        const a = await getNode(ctx, cfg.about, WHO);
        if (!a || !live(a.properties)) throw new Error(`${WHO}: ${cfg.about}, the card the brainstorm is about, is not there`);
      }
      for (const a of actions) {
        const isQ = a["kind"] === "question";
        const parent = a["parent"] ? (refs[a["parent"]] ?? a["parent"]) : null;
        const text = String(a["text"]).trim();
        const data: Record<string, unknown> = { name: clip(text), text, made_by: a["made_by"], state: isQ ? "open" : (a["state"] ?? "open"), job: cfg.job, run_id, turn, seq: nextSeq() };
        if (a["made_by"] === "user" && by) data["by"] = by;
        if (String(a["quote"] ?? "").trim()) data["quote"] = String(a["quote"]).trim();
        if (String(a["speaker"] ?? "").trim()) data["speaker"] = String(a["speaker"]).trim();
        if (isQ) {
          data["criteria"] = String(a["criteria"]).trim();
          data["reversibility"] = a["reversibility"];
        } else {
          data["makes"] = JSON.stringify((a["makes"] ?? []).map((x: unknown) => String(x).trim()));
          if (a["recommended"]) data["recommended"] = true;
          for (const k of ["fast", "good", "cheap"]) data[k] = Number(a["ratings"]?.[k]);
        }
        const ref = await mk(isQ ? QUESTION : OPTION, data);
        refs[a["tmp"]] = ref;
        if (parent) await link(parent, PARENT_OF, ref);
        else root = ref;
        written.push({ ref_id: ref, node_type: isQ ? QUESTION : OPTION, tmp: a["tmp"], text, parent });
        if (!isQ) {
          for (const e of a["effects"] ?? []) {
            const score = Number(e.score);
            const eref = await mk(EFFECT, { name: String(e.name).trim(), description: String(e.description).trim(), score, made_by: "model", job: cfg.job, run_id, turn });
            await link(ref, HAS_EFFECT, eref);
            await link(eref, AGAINST, e.requirement);
            written.push({ ref_id: eref, node_type: EFFECT, option: ref, against: e.requirement, score });
          }
        }
      }
      if (!cfg.root && root && cfg.about) await link(root, ABOUT, cfg.about);
    } catch (e) {
      let undone = 0;
      for (const ref of [...created].reverse()) {
        try {
          await call(ctx, "graph/delete-node", { ref_id: ref, reason: "the brainstorm turn that wrote it failed" }, WHO);
          undone++;
        } catch {
          /* best effort */
        }
      }
      throw new Error(`${e instanceof Error ? e.message : String(e)} Took back ${undone} of ${created.length} node(s) this turn wrote.`);
    }
    return { root, turn, written, job: cfg.job, run_id };
  },
});
