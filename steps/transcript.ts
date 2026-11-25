import { z, defineStep } from "strut";
import { norm } from "./_canvas.js";

const WHO = "stadeum/canvas/transcript";

// ── inlined from the package's steps/_transcript.ts (a helper module cannot be published here) ──
type Source = "voice" | "chat" | "jamie";
interface Line { n: number; at: string; speaker: string; identity?: string; source: Source; text: string }
const FILE = "transcript.jsonl";
const END_FILE = "transcript.end";
const CALL_JOB = /^call-[A-Za-z0-9_-]{1,64}$/;
function callJob(job: string, who: string): string {
  // Called from an app's page, strut scopes `job` to the app (`app/<app>/<job>`): a call's job is the server's, read
  // by anyone who can open the canvas (plan.md, Decided 3), so the scope is taken off a call job's name.
  const j = String(job ?? "").trim().replace(/^app\/.+\/(call-[A-Za-z0-9_-]{1,64})$/, "$1");
  if (!CALL_JOB.test(j)) throw new Error(`${who}: "${job}" is not a recorded call's job (call-…)`);
  return j;
}
function parseJsonl(text: string): Line[] {
  const byN = new Map<number, Line>();
  for (const raw of String(text ?? "").split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    try {
      const l = JSON.parse(t) as Line;
      if (Number.isInteger(l?.n) && !byN.has(l.n)) byN.set(l.n, l);
    } catch {
      /* a torn last line: skipped */
    }
  }
  return [...byN.values()].sort((a, b) => a.n - b.n);
}
const NUMBERED = /^\s*(\d+)\s+\[(\d{1,2}):(\d{2})\]\s+([^:\n]{1,80}?):\s?(.*)$/;
interface ChunkLine { n: number; hh: number; mm: number; speaker: string; text: string }
function chunkLines(prompt: string): ChunkLine[] {
  const out: ChunkLine[] = [];
  for (const l of String(prompt ?? "").split("\n")) {
    const m = NUMBERED.exec(l);
    if (m) out.push({ n: Number(m[1]), hh: Number(m[2]), mm: Number(m[3]), speaker: m[4]!.trim(), text: m[5]!.trim() });
  }
  return out;
}
const stoppedIn = (prompt: string) => /^\s*Recording stopped\b/m.test(String(prompt ?? ""));
/** A chunk line's moment, to the minute: the turn's day, a day earlier when the time is later than the turn (past midnight). */
function minuteAt(l: ChunkLine, turnAt: string | number | undefined): string {
  const t = turnAt !== undefined ? new Date(turnAt) : new Date();
  const base = Number.isFinite(t.getTime()) ? t : new Date();
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), l.hh, l.mm));
  if (d.getTime() > base.getTime() + 60_000) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
}
const sourceOf = (speaker: string): Source => (norm(speaker) === "jamie" ? "jamie" : "voice");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(ctx: any, type: string, cfg: Record<string, unknown>): Promise<any> {
  const def = ctx.registry?.[type];
  if (!def) throw new Error(`${WHO}: step ${type} not in registry`);
  const out = await def.run(def.input.parse(cfg), ctx);
  if (typeof out === "string") throw new Error(`${WHO}: ${type}: ${out}`);
  return out;
}
/** A file of the job's directory, or null when it has none. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readFile(ctx: any, job: string, path: string): Promise<string | null> {
  try {
    const f = await call(ctx, "job/read", { job, path, maxChars: 256 * 1024 * 1024 });
    return typeof f?.text === "string" ? f.text : null;
  } catch (e) {
    if (/^No file /.test(String((e as Error)?.message ?? e))) return null;
    throw e;
  }
}
const pool = async <T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]!); } }));
  return out;
};
/** A settled turn never changes: its prompt, read once. */
const prompts = new Map<string, { prompt: string; at?: string }>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fromPrompts(ctx: any, job: string): Promise<{ lines: Line[]; stopped: boolean }> {
  const listed = await call(ctx, "run/list", { job, limit: 500 });
  const runs: Array<{ runId: string; workflow: string; startedAt?: string; status?: string }> = Array.isArray(listed) ? listed : listed?.runs ?? [];
  const live = new Set(["running", "queued", "pending", "paused", "cancelling"]);
  const read = await pool(runs, 8, async (r) => {
    const key = `${r.workflow}:${r.runId}`;
    const kept = prompts.get(key);
    if (kept) return kept;
    let g: { input?: { prompt?: unknown }; startedAt?: string } | null = null;
    try { g = await call(ctx, "run/get", { workflow: r.workflow, runId: r.runId }); } catch { return { prompt: "" }; }
    const v = { prompt: typeof g?.input?.prompt === "string" ? g.input.prompt : "", at: g?.startedAt ?? r.startedAt };
    if (!live.has(String(r.status))) prompts.set(key, v);
    return v;
  });
  const byN = new Map<number, Line>();
  let stopped = false;
  for (const { prompt, at } of read) {
    if (!prompt) continue;
    if (stoppedIn(prompt)) stopped = true;
    for (const l of chunkLines(prompt)) {
      if (byN.has(l.n)) continue;
      byN.set(l.n, { n: l.n, at: minuteAt(l, at), speaker: l.speaker, source: sourceOf(l.speaker), text: l.text });
    }
  }
  return { lines: [...byN.values()].sort((a, b) => a.n - b.n), stopped };
}

/**
 * What was said on a recorded call, for the canvas's transcript view: the
 * lines voice stored (`transcript-append`), or, for a call recorded before
 * they were stored, the lines rebuilt from the scribe's turns, to the
 * minute. Anyone who can open the canvas reads it; it lives as long as the
 * call's job.
 */
export default defineStep({
  type: "stadeum/canvas/transcript",
  effect: "read",
  description:
    "A recorded call's transcript: { lines: [{ n, at (ISO), speaker, identity?, source: voice|chat|jamie, text }], done, from, last }. " +
    "`since` returns only the lines after that n. From the call job's transcript.jsonl (from: stored); for a call recorded before " +
    "lines were stored, rebuilt from the scribe turns' prompts, times to the minute (from: prompts). done: the recording stopped. " +
    "Input { job: call-…, since? }.",
  input: z.object({
    job: z.string().describe("The call's scribe job, call-…"),
    since: z.number().int().optional().describe("Only lines after this n"),
  }),
  output: z.object({
    lines: z.array(z.any()),
    done: z.boolean(),
    from: z.enum(["stored", "prompts", "none"]),
    last: z.number().int().nullable(),
  }),
  async run(cfg, ctx) {
    const job = callJob(cfg.job, WHO);
    const after = (ls: Line[]) => (cfg.since === undefined ? ls : ls.filter((l) => l.n > cfg.since!));
    const last = (ls: Line[]) => (ls.length ? ls[ls.length - 1]!.n : null);
    const stored = await readFile(ctx, job, FILE);
    if (stored !== null) {
      const all = parseJsonl(stored);
      const ended = (await readFile(ctx, job, END_FILE)) !== null;
      return { lines: after(all), done: ended, from: "stored" as const, last: last(all) };
    }
    const old = await fromPrompts(ctx, job);
    if (!old.lines.length) return { lines: [], done: old.stopped, from: "none" as const, last: null };
    return { lines: after(old.lines), done: old.stopped, from: "prompts" as const, last: last(old.lines) };
  },
});
