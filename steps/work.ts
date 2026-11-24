import { z, defineStep } from "strut";
import { getNodes, jobsOf } from "./_canvas.js";

async function call(ctx: any, type: string, cfg: any) {
  const def = ctx.registry?.[type];
  if (!def) throw new Error(`stadeum/canvas/work: step ${type} not in registry`);
  return def.run(def.input.parse(cfg), ctx);
}
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : one + "s"}`;
const pool = async <T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
  return out;
};
const jobState = (busy: boolean, newest: string | null) => (busy || ["running", "paused", "queued", "pending"].includes(String(newest)) ? "running" : ["error", "failed", "failure", "cancelled", "canceled"].includes(String(newest)) ? "failed" : "done");

/**
 * Where a feature's build is, from its strut jobs and their pull requests (a port of Hive's build.ts).
 * A job belongs to a card when its first run's input names the card's ref ("On the canvas: … (`ref`)", read in ONE graph
 * query), or its title carries the ref, or — the old rule, kept as a fallback — its title names the feature.
 * `ignore_jobs` (the delete guard passes the job that is doing the delete) leaves those jobs out.
 */
export default defineStep({
  type: "stadeum/canvas/work",
  effect: "read",
  description: "Work state of canvas cards from their jobs and the jobs' pull requests. Input { features: [{ref_id,name}], also: [refs of milestones or the initiative], ignore_jobs?, detail? }. A card's jobs are the ones it records (`jobs`, written by the `implement` workflow) and any job whose title carries its ref. Output { work: { <feature ref>: { state, line, started, jobs, prs, repos, artifacts } }, jobs_by_ref }.",
  input: z.object({ features: z.array(z.object({ ref_id: z.string(), name: z.string().optional() })), also: z.array(z.string()).default([]), ignore_jobs: z.array(z.string()).default([]), detail: z.boolean().default(true).describe("false: no job/get — each job's state from job/list only, no PRs or artifacts (fast, for a whole map)") }),
  output: z.any(),
  async run(cfg, ctx: any) {
    const empty = (): any => ({ state: "not_started", line: "Not built yet", started: false, jobs: [], prs: [], repos: [], artifacts: [] });
    const work: Record<string, any> = Object.fromEntries(cfg.features.map((f) => [f.ref_id, empty()]));
    const jobsByRef: Record<string, any[]> = {};
    const refs = [...cfg.features.map((f) => f.ref_id), ...cfg.also];
    if (!refs.length) return { work, jobs_by_ref: jobsByRef, jobs_matched: 0 };
    const listed: any = await call(ctx, "job/list", { limit: 500 });
    const ignore = new Set(cfg.ignore_jobs);
    const jobs: any[] = listed?.jobs ?? [];
    const matches = new Map<string, Set<string>>(); // job -> card refs
    const add = (job: string, ref: string) => { if (job) (matches.get(job) ?? matches.set(job, new Set()).get(job)!).add(ref); };
    // 1. the jobs a card records
    const linkedJobs = new Map<string, Set<string>>(); // ref -> job ids it records
    const cards = await getNodes(ctx, refs, "stadeum/canvas/work");
    for (const ref of refs) {
      const ids = jobsOf(cards.get(ref)?.properties["jobs"]);
      if (ids.length) linkedJobs.set(ref, new Set(ids));
      for (const id of ids) add(id, ref);
    }
    // 2. the title carries the ref
    for (const j of jobs) {
      const raw = String(j.title ?? "");
      for (const ref of refs) if (raw.includes(ref)) add(j.job, ref);
    }
    const byId = new Map(jobs.map((j) => [j.job, j]));
    // A linked job counts even when it is older than the listing; a link to a job that is gone is skipped.
    const linkedAny = new Set([...linkedJobs.values()].flatMap((s) => [...s]));
    const ids = [...matches.keys()].filter((id) => (byId.has(id) || linkedAny.has(id)) && !ignore.has(id)).slice(0, 80);
    if (!cfg.detail) {
      // The quick read, for a whole map: which jobs are on which card and whether they are working now (job/list's busy), no job/get.
      for (const id of ids) {
        const li = byId.get(id) ?? {};
                const base = { job: id, title: li.title ?? id, state: li.busy ? "running" : "done" };
        for (const ref of matches.get(id) ?? []) {
          const mine = { ...base, via: linkedJobs.get(ref)?.has(id) ? "card" : "title" };
          (jobsByRef[ref] ??= []).push(mine);
          if (work[ref]) { work[ref].jobs.push(mine); work[ref].started = true; }
        }
      }
      return { work, jobs_by_ref: jobsByRef, jobs_matched: ids.length, detail: false };
    }
    const got = await pool(ids, 8, async (id) => { try { return { id, d: (await call(ctx, "job/get", { job: id })) as any }; } catch { return { id, d: null }; } });
    for (const { id, d } of got) {
      if (!d) continue;
      const li = byId.get(id) ?? {};
      const runs: any[] = (d?.runs ?? []).filter((r: any) => !r.parentRunId);
      const newest = runs[0];
      const state = jobState(!!li.busy, newest?.status ?? null);
      const by = String(li.createdBy ?? "") || undefined;
            const job = { job: id, title: li.title ?? id, state, ...(state === "failed" && newest?.error ? { error: String(newest.error?.message ?? newest.error) } : {}), ...(by ? { by } : {}) };
      const prs: any[] = [], arts: any[] = [];
      for (const a of d?.artifacts ?? []) {
        if (a.kind === "pull_request") {
          let c: any = {};
          try { c = typeof a.content === "string" ? JSON.parse(a.content) : a.content ?? {}; } catch { /* keep the url */ }
          const failing = ["open", "draft"].includes(String(c.state ?? "open").toLowerCase()) ? (Array.isArray(c.checks) ? c.checks : []).filter((x: any) => x?.status === "failure").map((x: any) => String(x.name)) : [];
          prs.push({ url: c.url ?? a.url, repo: c.repo ?? null, number: c.number ?? null, state: String(c.state ?? "open").toLowerCase(), failing, title: a.title });
        } else arts.push({ id: a.id, kind: a.kind, title: a.title, url: a.url, path: a.path ?? null, job: id });
      }
      for (const ref of matches.get(id) ?? []) {
        const mine = { ...job, via: linkedJobs.get(ref)?.has(id) ? "card" : "title" };
        (jobsByRef[ref] ??= []).push(mine);
        const w = work[ref];
        if (!w) continue;
        w.jobs.push(mine);
        w.prs.push(...prs);
        w.artifacts.push(...arts);
        for (const r of d?.repos ?? []) if (!w.repos.includes(r)) w.repos.push(r);
      }
    }
    for (const w of Object.values(work)) {
      w.started = w.jobs.length > 0;
      for (const p of w.prs) if (p.repo && !w.repos.includes(p.repo)) w.repos.push(p.repo);
      w.repos = w.repos.filter((r: string) => r.includes("/") || !w.repos.some((o: string) => o.endsWith("/" + r))); // "app" is "team/app"
      if (!w.started && !w.prs.length) continue;
      const failed = w.jobs[0]?.state === "failed" ? w.jobs[0] : null;
      const red = w.prs.find((p: any) => p.failing.length);
      const live = w.prs.filter((p: any) => p.state !== "closed");
      const merged = live.filter((p: any) => p.state === "merged").length;
      const running = w.jobs.filter((j: any) => j.state === "running").length;
      if (failed) { w.state = "blocked"; w.reason = `${failed.title} failed${failed.error ? `: ${failed.error}` : ""}`; w.line = w.reason; }
      else if (red) { w.state = "blocked"; w.reason = `CI failing on ${red.title ?? red.repo}: ${red.failing.join(", ")}`; w.line = w.reason; }
      else {
        w.line = live.length ? `${merged} of ${plural(live.length, "pull request")} merged` : running ? `${plural(running, "job")} running` : "No pull requests yet";
        w.state = live.length && merged === live.length && !running ? "done" : "in_progress";
      }
    }
    return { work, jobs_by_ref: jobsByRef, jobs_matched: ids.length };
  },
});
