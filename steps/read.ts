import { z, defineStep } from "strut";
import { live } from "./_canvas.js";

async function call(ctx: any, type: string, cfg: any) {
  const def = ctx.registry?.[type];
  if (!def) throw new Error(`stadeum/canvas/read: step ${type} not in registry`);
  return def.run(def.input.parse(cfg), ctx);
}
const PROPS = ["text", "title", "status", "blocked", "blocked_reason", "description", "sequence", "created_by_kind", "author", "made_by", "state", "diagram", "builds_in", "repos", "target_date", "due_date"];

export default defineStep({
  type: "stadeum/canvas/read",
  effect: "read",
  description: "Read a canvas card and its initiative: the brief, stories with their requirements, milestones (by sequence) with their features (each with what it SATISFIES and its architecture), and the brainstorms about the initiative, milestone or feature. Removed cards are left out. `about` is optional: with none the level is 'top' (a new initiative may be created).",
  input: z.object({
    about: z.string().optional(),
    prompt: z.string().optional(),
    job: z.string().optional(),
    root: z.string().optional(),
  }),
  output: z.any(),
  async run(cfg, ctx) {
    if (!cfg.about) {
      return {
        about: { ref_id: null, type: "none", name: "(no card: the top level, nothing selected)" }, level: "top", anchor: null, chain: [],
        initiative_ref: null, milestone_ref: null, feature_ref: null,
        initiative: { ref_id: null, briefs: [], stories: [], milestones: [], features: [], node: null },
        requirements: [], brainstorms: [], index: {}, bs_input: { prompt: cfg.prompt ?? "", job: cfg.job ?? "" },
      };
    }
    const nb = async (ref: string, edge: string, dir?: "forward" | "reverse", nodeType?: string) => {
      const r = await call(ctx, "graph/graph-neighbors", { ref_id: ref, edge_type: [edge], ...(nodeType ? { node_type: [nodeType] } : {}) });
      if (typeof r === "string") throw new Error(`stadeum/canvas/read: could not read ${edge} of ${ref}: ${r}`);
      return (r as any[]).filter((x) => x.edge_type === edge && (!dir || x.direction === dir));
    };
    const getNode = async (ref: string) => {
      const r = await call(ctx, "graph/graph-get", { ref_id: ref });
      if (typeof r === "string" || !r?.ref_id) throw new Error(`stadeum/canvas/read: node ${ref} not found in the graph (${typeof r === "string" ? r : "no node"}). Wrong ref, or it was deleted.`);
      if (!live(r.properties)) throw new Error(`stadeum/canvas/read: ${r.node_type} "${r.name}" (${ref}) was removed from the canvas.`);
      return r;
    };
    const slim = (n: any) => {
      const o: any = { ref_id: n.ref_id, type: n.node_type, name: n.name };
      for (const k of PROPS) if (n.properties?.[k] !== undefined) o[k] = n.properties[k];
      return o;
    };

    const about = await getNode(cfg.about);
    const chain: { ref: string; type: string }[] = [{ ref: about.ref_id, type: about.node_type }];
    let rootQuestion: string | null = null;
        const cur = about;
    const up = async (n: any, depth: number): Promise<void> => {
      if (depth > 12) return;
      const t = n.node_type;
      let parentEdge: string | null = null;
      if (t === "Milestone") parentEdge = "HAS_MILESTONE";
      else if (t === "Feature") parentEdge = "HAS_FEATURE";
      else if (t === "Brief") parentEdge = "HAS_BRIEF";
      else if (t === "UserStory") parentEdge = "HAS_STORY";
      else if (t === "Requirement") parentEdge = "HAS_REQUIREMENT";
      else if (t === "Architecture") parentEdge = "HAS_ARCHITECTURE";
      if (parentEdge) {
        const p = (await nb(n.ref_id, parentEdge, "reverse"))[0];
        if (!p) return;
        chain.push({ ref: p.ref_id, type: p.node_type });
        return up(await getNode(p.ref_id), depth + 1);
      }
      if (t === "Question" || t === "Option" || t === "Effect") {
        let q = n; let guard = 0;
        while (guard++ < 30) {
          const pe = t === "Effect" && q === n ? "HAS_EFFECT" : "PARENT_OF";
          const par = (await nb(q.ref_id, pe, "reverse"))[0];
          if (!par) break;
          q = await getNode(par.ref_id);
        }
        rootQuestion = q.node_type === "Question" ? q.ref_id : null;
        const ab = rootQuestion ? (await nb(rootQuestion, "ABOUT", "forward"))[0] : null;
        if (ab) { chain.push({ ref: ab.ref_id, type: ab.node_type }); return up(await getNode(ab.ref_id), depth + 1); }
      }
    };
    await up(cur, 0);
    const initRef = chain.find((c) => c.type === "Initiative")?.ref;
    const msRef = chain.find((c) => c.type === "Milestone")?.ref;
    const featRef = chain.find((c) => c.type === "Feature")?.ref;
    if (!initRef) throw new Error(`stadeum/canvas/read: ${about.node_type} "${about.name}" (${about.ref_id}) does not lead to an Initiative (chain: ${chain.map((c) => c.type).join(" <- ")}). Pass the ref_id of an initiative, milestone, feature, brief, story, requirement or brainstorm card.`);
    const level = featRef ? "feature" : msRef ? "milestone" : "initiative";
    const anchor = featRef ?? msRef ?? initRef;

    const names = new Map<string, any>();
    const need = new Set<string>();
    const initiative: any = { ref_id: initRef, briefs: [], stories: [], milestones: [], features: [] };
    const briefs = await nb(initRef, "HAS_BRIEF", "forward");
    const stories = await nb(initRef, "HAS_STORY", "forward");
    const storyReqs: Record<string, any[]> = {};
    for (const s of stories) storyReqs[s.ref_id] = await nb(s.ref_id, "HAS_REQUIREMENT", "forward");
    const milestones = await nb(initRef, "HAS_MILESTONE", "forward");
    const msFeatures: Record<string, any[]> = {};
    for (const m of milestones) msFeatures[m.ref_id] = await nb(m.ref_id, "HAS_FEATURE", "forward");
    const loose = await nb(initRef, "HAS_FEATURE", "forward");
    const allFeatures = [...Object.values(msFeatures).flat(), ...loose];
    const featSat: Record<string, any[]> = {};
    const featArch: Record<string, any[]> = {};
    for (const f of allFeatures) {
      featSat[f.ref_id] = await nb(f.ref_id, "SATISFIES", "forward");
      featArch[f.ref_id] = await nb(f.ref_id, "HAS_ARCHITECTURE", "forward");
    }
    const brainstormRoots: Record<string, any[]> = {};
    for (const [lab, ref] of [["initiative", initRef], ["milestone", msRef], ["feature", featRef]] as [string, string | undefined][]) {
      if (ref) brainstormRoots[lab] = await nb(ref, "ABOUT", "reverse", "Question");
    }
    [initRef, ...briefs.map((x) => x.ref_id), ...stories.map((x) => x.ref_id), ...Object.values(storyReqs).flat().map((x) => x.ref_id),
      ...milestones.map((x) => x.ref_id), ...allFeatures.map((x) => x.ref_id), ...Object.values(featArch).flat().map((x) => x.ref_id),
      ...Object.values(brainstormRoots).flat().map((x) => x.ref_id)].forEach((r) => need.add(r));
    const refs = [...need];
    for (let i = 0; i < refs.length; i += 50) {
      const b = await call(ctx, "graph/graph-get-batched", { ref_ids: refs.slice(i, i + 50) });
      if (typeof b === "string") throw new Error(`stadeum/canvas/read: batch read failed: ${b}`);
      for (const n of (b as any).nodes ?? []) { if (n.error) throw new Error(`stadeum/canvas/read: could not read ${n.ref_id}: ${n.error}`); if (live(n.properties)) names.set(n.ref_id, slim(n)); }
    }
    const g = (r: string) => names.get(r);
    // Removed cards (and what hangs only under them) are not on the canvas.
    const on = (x: { ref_id: string }) => names.has(x.ref_id);
    initiative.node = g(initRef);
    initiative.briefs = briefs.filter(on).map((b) => g(b.ref_id));
    initiative.stories = stories.filter(on).map((s) => ({ ...g(s.ref_id), requirements: storyReqs[s.ref_id].filter(on).map((r) => g(r.ref_id)) }));
    const feat = (f: any) => ({ ...g(f.ref_id), satisfies: featSat[f.ref_id].map((r) => r.ref_id), architecture: featArch[f.ref_id].filter(on).map((a) => g(a.ref_id)) });
    initiative.milestones = milestones.filter(on).map((m) => ({ ...g(m.ref_id), features: msFeatures[m.ref_id].filter(on).map(feat) }))
      .sort((a, b) => (a.sequence ?? 1e9) - (b.sequence ?? 1e9));
    initiative.features = loose.filter(on).map(feat);
    const brainstorms = Object.entries(brainstormRoots).flatMap(([lab, qs]) => qs.filter(on).map((q) => ({ about_level: lab, ...g(q.ref_id) })));
    const requirements = initiative.stories.flatMap((s: any) => s.requirements.map((r: any) => ({ ...r, story: s.ref_id })));
    const index: Record<string, any> = {};
    const put = (n: any, children: string[] = []) => { index[n.ref_id] = { type: n.type, name: n.name, created_by_kind: n.created_by_kind ?? null, made_by: n.made_by ?? null, children }; };
    initiative.briefs.forEach((b: any) => put(b));
    initiative.stories.forEach((s: any) => { put(s, s.requirements.map((r: any) => r.ref_id)); s.requirements.forEach((r: any) => put(r)); });
    const putFeat = (f: any) => { put(f, f.architecture.map((a: any) => a.ref_id)); f.architecture.forEach((a: any) => put(a)); };
    initiative.milestones.forEach((m: any) => { put(m, m.features.map((f: any) => f.ref_id)); m.features.forEach(putFeat); });
    initiative.features.forEach(putFeat);

    const root = cfg.root ?? rootQuestion ?? undefined;
    const bs_input: any = { prompt: cfg.prompt ?? "", job: cfg.job ?? "" };
    if (root) bs_input.root = root;
    else bs_input.about = anchor;
    return {
      about: slim(about), level, anchor, chain,
      initiative_ref: initRef,
      milestone_ref: msRef ?? null, feature_ref: featRef ?? null,
      initiative, requirements, brainstorms, index, bs_input,
    };
  },
});
