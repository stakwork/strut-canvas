import { z, defineStep } from "strut";

const WHO = "stadeum/canvas/calls";
const CALL_JOB = /^call-[A-Za-z0-9_-]{1,64}$/;
/** Kept beside a call's transcript: its facts (transcript-append) and its summary (call-summary). */
const FACTS_FILE = "call.json";
const SUMMARY_FILE = "summary.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(ctx: any, type: string, cfg: Record<string, unknown>): Promise<any> {
  const def = ctx.registry?.[type];
  if (!def) throw new Error(`${WHO}: step ${type} not in registry`);
  const out = await def.run(def.input.parse(cfg), ctx);
  if (typeof out === "string") throw new Error(`${WHO}: ${type}: ${out}`);
  return out;
}
/** A JSON file of the job's directory, or null when it has none or it does not parse. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(ctx: any, job: string, path: string): Promise<Record<string, unknown> | null> {
  try {
    const f = await call(ctx, "job/read", { job, path, maxChars: 1024 * 1024 });
    const v: unknown = typeof f?.text === "string" ? JSON.parse(f.text) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const pool = async <T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]!); } }));
  return out;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : []);
interface Person { name: string; identity?: string }
const peopleOf = (v: unknown): Person[] =>
  (Array.isArray(v) ? v : []).flatMap((p) => {
    const name = str((p as Person | null)?.name);
    const identity = str((p as Person | null)?.identity);
    return name ? [{ name, ...(identity ? { identity } : {}) }] : [];
  });
/** What the files say of the call, whichever has it: the facts from the transcript's own file first. */
function factsOf(facts: Record<string, unknown> | null, summary: Record<string, unknown> | null) {
  const from = facts ?? summary ?? {};
  const people = peopleOf(from["people"]);
  const startedAt = str(from["startedAt"]);
  const endedAt = str(from["endedAt"]);
  const lines = typeof from["lines"] === "number" ? from["lines"] : undefined;
  const done = typeof facts?.["done"] === "boolean" ? (facts["done"] as boolean) : summary ? true : undefined;
  return { ...(done !== undefined ? { done } : {}), ...(startedAt ? { startedAt } : {}), ...(endedAt ? { endedAt } : {}), ...(lines !== undefined ? { lines } : {}), ...(people.length ? { people } : {}) };
}
function summaryOf(s: Record<string, unknown> | null) {
  const title = str(s?.["title"]);
  if (!s || !title) return undefined;
  const actions = (Array.isArray(s["actions"]) ? s["actions"] : []).flatMap((a) => {
    const who = str((a as { who?: unknown } | null)?.who);
    const items = strs((a as { items?: unknown } | null)?.items);
    return who && items.length ? [{ who, items }] : [];
  });
  const at = str(s["at"]);
  return { title, discussed: strs(s["discussed"]), decided: strs(s["decided"]), actions, open: strs(s["open"]), ...(at ? { at } : {}) };
}

const PersonOut = z.object({ name: z.string(), identity: z.string().optional() });
const SummaryOut = z.object({
  title: z.string(),
  discussed: z.array(z.string()),
  decided: z.array(z.string()),
  actions: z.array(z.object({ who: z.string(), items: z.array(z.string()) })),
  open: z.array(z.string()),
  at: z.string().optional(),
});

/**
 * The recorded calls, for the canvas's Calls page: each call's scribe job (`call-…`). Read from a page, `job/list`
 * sees only the app's own jobs (`app/<app>/…`); a call's job is the server's, and its transcript is readable by anyone
 * who can open the canvas (plan.md, Decided 3), so the list is too. With each call, what the files beside its
 * transcript say: who spoke and from when to when (call.json), and its summary once one was written (summary.json).
 * What was said is read with `stadeum/canvas/transcript`.
 */
export default defineStep({
  type: "stadeum/canvas/calls",
  effect: "read",
  description:
    "The calls recorded on the canvas: every call-… job here, newest first — { calls: [{ job, title, createdAt?, usedAt?, busy, " +
    "done?, startedAt?, endedAt?, lines?, people?: [{ name, identity? }], summary?: { title, discussed, decided, actions: [{ who, items }], open, at? } }] }. " +
    "title is the summary's once the call has one. done: the recording stopped. people: who spoke, never Jamie.",
  input: z.object({
    limit: z.number().int().min(1).max(500).default(100).describe("At most this many, newest first"),
  }),
  output: z.object({
    calls: z.array(
      z.object({
        job: z.string(),
        title: z.string(),
        createdAt: z.string().optional(),
        usedAt: z.string().optional(),
        busy: z.boolean(),
        done: z.boolean().optional(),
        startedAt: z.string().optional(),
        endedAt: z.string().optional(),
        lines: z.number().optional(),
        people: z.array(PersonOut).optional(),
        summary: SummaryOut.optional(),
      }),
    ),
  }),
  async run(cfg, ctx) {
    const r = await call(ctx, "job/list", { prefix: "call-", limit: cfg.limit });
    const jobs: Array<{ job: string; title?: string; createdAt?: string; usedAt?: string; busy?: unknown }> = Array.isArray(r) ? r : r?.jobs ?? [];
    const listed = jobs
      .filter((j) => CALL_JOB.test(String(j.job)))
      .sort((a, b) => Date.parse(String(b.createdAt ?? b.usedAt ?? "")) - Date.parse(String(a.createdAt ?? a.usedAt ?? "")) || 0);
    const calls = await pool(listed, 8, async (j) => {
      const [facts, kept] = await Promise.all([readJson(ctx, j.job, FACTS_FILE), readJson(ctx, j.job, SUMMARY_FILE)]);
      const summary = summaryOf(kept);
      return {
        job: j.job,
        title: summary?.title ?? ((j.title ?? "").trim() || "A call"),
        ...(j.createdAt ? { createdAt: String(j.createdAt) } : {}),
        ...(j.usedAt ? { usedAt: String(j.usedAt) } : {}),
        busy: !!j.busy,
        ...factsOf(facts, kept),
        ...(summary ? { summary } : {}),
      };
    });
    return { calls };
  },
});
