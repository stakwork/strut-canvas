import { z, defineStep } from "strut";
import { ARCHITECTURE, FEATURE, HAS_ARCHITECTURE, HAS_FEATURE, HAS_MILESTONE, HAS_REQUIREMENT, INITIATIVE, MILESTONE, REQUIREMENT, SATISFIES, STORY, call, getNode, linkedLive, step } from "./_canvas.js";

const WHO = "stadeum/canvas/guard";

export default defineStep({
  type: "stadeum/canvas/guard",
  description:
    "Before a removal: throws `work_started:` when removing any of the given cards (or a plan's deletes) would remove something work has " +
    "started on. Work has started on a feature when a job is on it (`work`); an initiative, milestone, story, requirement or architecture " +
    "is covered through its features. `ignore_job`: the job doing the removal, which names the card only because a person asked from it.",
  effect: "read",
  input: z.object({ ref_ids: z.array(z.string()).default([]), plan: z.any().optional(), ignore_job: z.string().optional() }),
  output: z.any(),
  async run(cfg, ctx) {
    const plan = cfg.plan as { deletes?: unknown[] } | undefined;
    const deletes = Array.isArray(plan?.deletes) ? plan!.deletes.map((d) => (typeof d === "string" ? d : (d as { ref_id?: string })?.ref_id)) : [];
    const refs = [...new Set([...cfg.ref_ids, ...deletes].filter((r): r is string => !!r))];
    if (!refs.length) return { ok: true, checked: [] };
    const covers = new Map<string, Array<{ ref: string; name: string }>>();
    const feats = async (ref: string, edge: string, dir: "forward" | "reverse") => (await linkedLive(ctx, ref, edge, dir, { who: WHO })).map((n) => ({ ref: n.ref_id, name: String(n.properties["name"] ?? n.name ?? n.ref_id) }));
    for (const ref of refs) {
      const n = await getNode(ctx, ref, WHO);
      if (!n) continue;
      const t = n.node_type;
      let fs: Array<{ ref: string; name: string }> = [];
      if (t === FEATURE) fs = [{ ref, name: String(n.properties["name"] ?? ref) }];
      else if (t === ARCHITECTURE) fs = await feats(ref, HAS_ARCHITECTURE, "reverse");
      else if (t === MILESTONE) fs = await feats(ref, HAS_FEATURE, "forward");
      else if (t === INITIATIVE) for (const m of await linkedLive(ctx, ref, HAS_MILESTONE, "forward", { who: WHO })) fs.push(...(await feats(m.ref_id, HAS_FEATURE, "forward")));
      else if (t === REQUIREMENT) fs = await feats(ref, SATISFIES, "reverse");
      else if (t === STORY) for (const r of await linkedLive(ctx, ref, HAS_REQUIREMENT, "forward", { who: WHO })) fs.push(...(await feats(r.ref_id, SATISFIES, "reverse")));
      covers.set(ref, fs);
    }
    const all = [...new Map([...covers.values()].flat().map((f) => [f.ref, f])).values()];
    if (!all.length) return { ok: true, checked: refs };
    const w = await call(ctx, step("work"), { features: all.map((f) => ({ ref_id: f.ref, name: f.name })), ignore_jobs: cfg.ignore_job ? [cfg.ignore_job] : [], detail: false }, WHO);
    for (const [ref, fs] of covers) {
      for (const f of fs) {
        const x = w.work?.[f.ref];
        if (x?.started) throw new Error(`work_started: ${ref} cannot be removed: work has started on the feature "${f.name}" (${x.jobs.length} job(s)). Nothing was changed.`);
      }
    }
    return { ok: true, checked: refs };
  },
});
