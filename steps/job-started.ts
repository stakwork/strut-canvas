import { z, defineStep } from "strut";
import { FEATURE, call, getNode, jobsOf, live } from "./_canvas.js";

const WHO = "stadeum/canvas/job-started";


export default defineStep({
  type: "stadeum/canvas/job-started",
  description: "Record a job started on a feature (the feature's `jobs`), so the card shows what the job built. The `implement` workflow runs it.",
  effect: "write",
  input: z.object({ feature: z.string(), job: z.string() }),
  output: z.any(),
  async run(cfg, ctx) {
    const n = await getNode(ctx, cfg.feature, WHO);
    if (!n || !live(n.properties) || n.node_type !== FEATURE) throw new Error(`${WHO}: ${cfg.feature} is not a feature on the canvas`);
    const jobs = jobsOf(n.properties["jobs"]);
    if (!jobs.includes(cfg.job)) await call(ctx, "graph/edit-node", { ref_id: cfg.feature, node_data: { jobs: JSON.stringify([...jobs, cfg.job]) } }, WHO);
    return { feature: cfg.feature, job: cfg.job, jobs: jobs.includes(cfg.job) ? jobs : [...jobs, cfg.job] };
  },
});
