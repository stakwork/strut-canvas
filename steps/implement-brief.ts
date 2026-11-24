import { z, defineStep } from "strut";

/** The brief for the job that builds one feature. The title carries the feature's ref, and the `implement` workflow records the job on the card. */
export default defineStep({
  type: "stadeum/canvas/implement-brief",
  effect: "read",
  description: "Builds { title, prompt, feature } for a code job that implements one canvas feature, from `read`'s output. Throws when the feature has no architecture yet.",
  input: z.object({ ctx: z.any(), feature: z.string() }),
  output: z.any(),
  async run(cfg) {
    const ini = cfg.ctx?.initiative;
    const all: any[] = [...(ini?.milestones ?? []).flatMap((m: any) => m.features.map((f: any) => ({ ...f, milestone: m }))), ...(ini?.features ?? [])];
    const f = all.find((x) => x.ref_id === cfg.feature);
    if (!f) throw new Error(`stadeum/canvas/implement-brief: feature ${cfg.feature} is not in the initiative read (wrong ref, or it was deleted)`);
    const a = (f.architecture ?? [])[0];
    if (!a) throw new Error(`stadeum/canvas/implement-brief: "${f.name}" has no architecture yet. Draft it first (ask Jamie), then implement.`);
    const sat = (f.satisfies ?? []).map((id: string) => (cfg.ctx.requirements ?? []).find((r: any) => r.ref_id === id)?.text).filter(Boolean);
    const line = `On the canvas: initiative "${ini.node?.name}" (\`${ini.ref_id}\`), feature "${f.name}" (\`${f.ref_id}\`).`;
    const prompt = [
      `Code Change job. ${line}`,
      `Implement this feature: "${f.name}"${f.milestone ? `, in milestone "${f.milestone.name}"` : ""}.`,
      sat.length ? `It satisfies these requirements:\n${sat.map((t: string) => `- ${t}`).join("\n")}` : "",
      `Its architecture — ${a.name}${a.summary || a.description ? `\n${a.summary ?? a.description}` : ""}${a.diagram ? `\n\nDiagram (mermaid):\n${a.diagram}` : ""}`,
      "Follow the Code Change page. Return each pull request as a `pull_request` artifact, so it shows on the feature's card.",
    ].filter(Boolean).join("\n\n");
    return { title: `Implement: ${f.name} [${f.ref_id}]`, prompt, feature: { ref_id: f.ref_id, name: f.name } };
  },
});
