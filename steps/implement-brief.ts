import { z, defineStep } from "strut";
import { normBuildsIn, reposOf } from "./_canvas.js";

const WHO = "stadeum/canvas/implement-brief";

/**
 * The brief for the job that builds one feature, and which job it is: where
 * the feature's architecture says it is built. Code in a repository is a
 * Code Change job (`job`, with the repositories); workflows, steps or an app
 * on this strut server is a `builder` job. The title carries the feature's
 * ref, and the `implement` workflow records the job on the card.
 */
export default defineStep({
  type: "stadeum/canvas/implement-brief",
  effect: "read",
  description:
    "Builds { title, prompt, feature, builds_in, workflow, kind, repos } for the job that implements one canvas feature, from `read`'s output. " +
    "builds_in is the architecture's (repo, the default, or strut) unless the input names one: repo is a Code Change `job` with the " +
    "architecture's repositories, strut a `builder` job. Throws when the feature has no architecture yet.",
  input: z.object({
    ctx: z.any(),
    feature: z.string(),
    builds_in: z.string().optional().describe("repo or strut: overrides the architecture's"),
    repos: z.any().optional().describe("Repositories' https addresses: override the architecture's (repo only)"),
  }),
  output: z.any(),
  async run(cfg) {
    const ini = cfg.ctx?.initiative;
    const all: any[] = [...(ini?.milestones ?? []).flatMap((m: any) => m.features.map((f: any) => ({ ...f, milestone: m }))), ...(ini?.features ?? [])];
    const f = all.find((x) => x.ref_id === cfg.feature);
    if (!f) throw new Error(`${WHO}: feature ${cfg.feature} is not in the initiative read (wrong ref, or it was removed)`);
    const a = (f.architecture ?? [])[0];
    if (!a) throw new Error(`${WHO}: "${f.name}" has no architecture yet. Draft it first (ask Jamie), then implement.`);
    const builds_in = normBuildsIn(cfg.builds_in || a.builds_in || "repo", WHO);
    const given = cfg.repos !== undefined && cfg.repos !== null && cfg.repos !== "" && !(Array.isArray(cfg.repos) && !cfg.repos.length);
    const repos = builds_in === "strut" ? [] : reposOf(given ? cfg.repos : (a.repos ?? []), WHO);
    const sat = (f.satisfies ?? []).map((id: string) => (cfg.ctx.requirements ?? []).find((r: any) => r.ref_id === id)?.text).filter(Boolean);
    const line = `On the Infinite Canvas: initiative "${ini.node?.name}" (ref_id ${ini.ref_id}), feature "${f.name}" (ref_id ${f.ref_id}).`;
    const how =
      builds_in === "strut"
        ? "Build it on this strut server, as workflows, steps or an app. Return what you published (each workflow, step or app, and its version) as artifacts, so it shows on the feature's card."
        : `Follow the Code Change page${repos.length ? `, in ${repos.join(", ")}` : ""}. Return each pull request as a \`pull_request\` artifact, so it shows on the feature's card.`;
    const prompt = [
      line,
      `Implement this feature: "${f.name}"${f.milestone ? `, in milestone "${f.milestone.name}"` : ""}.`,
      sat.length ? `It satisfies these requirements:\n${sat.map((t: string) => `- ${t}`).join("\n")}` : "",
      `Its architecture: ${a.name}${a.description ? `\n${a.description}` : ""}${a.diagram ? `\n\nDiagram (mermaid):\n${a.diagram}` : ""}`,
      how,
    ].filter(Boolean).join("\n\n");
    return {
      title: `Implement: ${f.name} [${f.ref_id}]`,
      prompt,
      feature: { ref_id: f.ref_id, name: f.name },
      builds_in,
      workflow: builds_in === "strut" ? "builder" : "job",
      kind: builds_in === "strut" ? "" : "Code Change",
      repos,
    };
  },
});
