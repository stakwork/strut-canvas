import { z, defineStep } from "strut";

const WHO = "stadeum/canvas/calls";
const CALL_JOB = /^call-[A-Za-z0-9_-]{1,64}$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(ctx: any, type: string, cfg: Record<string, unknown>): Promise<any> {
  const def = ctx.registry?.[type];
  if (!def) throw new Error(`${WHO}: step ${type} not in registry`);
  const out = await def.run(def.input.parse(cfg), ctx);
  if (typeof out === "string") throw new Error(`${WHO}: ${type}: ${out}`);
  return out;
}

/**
 * The recorded calls, for the canvas's Calls list: each call's scribe job (`call-…`). Read from a page, `job/list`
 * sees only the app's own jobs (`app/<app>/…`); a call's job is the server's, and its transcript is readable by anyone
 * who can open the canvas (plan.md, Decided 3), so the list is too. Names and times only: what was said is read with
 * `stadeum/canvas/transcript`.
 */
export default defineStep({
  type: "stadeum/canvas/calls",
  effect: "read",
  description:
    "The calls recorded on the canvas: every call-… job here, newest first — { calls: [{ job, title, createdAt?, usedAt?, busy }] }.",
  input: z.object({
    limit: z.number().int().min(1).max(500).default(100).describe("At most this many, newest first"),
  }),
  output: z.object({
    calls: z.array(z.object({ job: z.string(), title: z.string(), createdAt: z.string().optional(), usedAt: z.string().optional(), busy: z.boolean() })),
  }),
  async run(cfg, ctx) {
    const r = await call(ctx, "job/list", { prefix: "call-", limit: cfg.limit });
    const jobs: Array<{ job: string; title?: string; createdAt?: string; usedAt?: string; busy?: unknown }> = Array.isArray(r) ? r : r?.jobs ?? [];
    const calls = jobs
      .filter((j) => CALL_JOB.test(String(j.job)))
      .map((j) => ({
        job: j.job,
        title: (j.title ?? "").trim() || "A call",
        ...(j.createdAt ? { createdAt: String(j.createdAt) } : {}),
        ...(j.usedAt ? { usedAt: String(j.usedAt) } : {}),
        busy: !!j.busy,
      }))
      .sort((a, b) => Date.parse(b.createdAt ?? b.usedAt ?? "") - Date.parse(a.createdAt ?? a.usedAt ?? "") || 0);
    return { calls };
  },
});
