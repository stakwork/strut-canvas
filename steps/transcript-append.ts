import { z, defineStep, jobRoot, shellCapability } from "strut";

const WHO = "stadeum/canvas/transcript-append";

// ── inlined from the package's steps/_transcript.ts (a helper module cannot be published here) ──
const SOURCES = ["voice", "chat", "jamie"] as const;
type Source = (typeof SOURCES)[number];
interface Line { n: number; at: string; speaker: string; identity?: string; source: Source; text: string }
const FILE = "transcript.jsonl";
/** Written when voice says the recording stopped (`transcript-append { end: true }`). */
const END_FILE = "transcript.end";
/** What the Calls page lists a call by, rewritten with each batch: who spoke, from when to when, how many lines. */
const FACTS_FILE = "call.json";
/** The workflow that writes a call's summary, started when its recording stops. */
const SUMMARIZE = "stadeum/canvas/summarize";
interface Person { name: string; identity?: string }
/** A call's facts, counted from its lines: the people who spoke (never Jamie), in the order of their first line. */
function factsOf(lines: Line[], done: boolean) {
  const people = new Map<string, Person>();
  let first = Infinity;
  let last = -Infinity;
  for (const l of lines) {
    const t = Date.parse(l.at);
    if (Number.isFinite(t)) { first = Math.min(first, t); last = Math.max(last, t); }
    if (l.source === "jamie") continue;
    const key = l.identity ?? l.speaker;
    if (!people.has(key)) people.set(key, { name: l.speaker, ...(l.identity ? { identity: l.identity } : {}) });
  }
  const span = Number.isFinite(first) ? { startedAt: new Date(first).toISOString(), endedAt: new Date(last).toISOString() } : {};
  return { people: [...people.values()], ...span, lines: lines.length, done };
}
/** Starts the call's summary. Never fails the append: the Calls page can run it again. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function summarize(ctx: any, job: string): Promise<string | undefined> {
  try {
    const def = ctx?.registry?.["run/launch"];
    if (!def) return undefined;
    const out = await def.run(def.input.parse({ workflow: SUMMARIZE, input: { job }, key: `call-summary:${job}` }), ctx);
    return typeof out?.runId === "string" ? out.runId : undefined;
  } catch (e) {
    console.warn(`${WHO}: the summary of ${job} did not start: ${String((e as Error)?.message ?? e)}`);
    return undefined;
  }
}
/** A call's scribe job: `call-<hex>` as the box names it. Also what keeps a path out of any other job. */
const CALL_JOB = /^call-[A-Za-z0-9_-]{1,64}$/;
function callJob(job: string, who: string): string {
  const j = String(job ?? "").trim();
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

const LineIn = z.object({
  n: z.number().int().nonnegative(),
  at: z.union([z.string(), z.number()]).describe("When voice received the line: ISO, or epoch ms"),
  speaker: z.string().min(1),
  identity: z.string().optional().nullable(),
  source: z.enum(SOURCES),
  text: z.string(),
});

/** One append at a time per job in this process, so a retry racing its first try never writes an n twice. */
const queues = new Map<string, Promise<unknown>>();
function serial<T>(job: string, f: () => Promise<T>): Promise<T> {
  const prev = queues.get(job) ?? Promise.resolve();
  const next = prev.then(f, f);
  const tail = next.catch(() => {});
  queues.set(job, tail);
  void tail.then(() => { if (queues.get(job) === tail) queues.delete(job); });
  return next;
}

/**
 * The call's settled lines, kept in its scribe job's directory
 * (`<job dir>/transcript.jsonl`) so the canvas shows the transcript on open,
 * after the channel's last 256 are gone, and for a past call. Voice calls it
 * (`POST /steps/stadeum/canvas/transcript-append/run`, the deployment key,
 * `x-strut-actor` the recorder) with each batch of settled lines; an `n` the
 * file already has is skipped, so a retry is safe. `end: true` when the
 * recording stopped: `transcript` then answers `done`, and the call's
 * summary is started (workflows/summarize.yaml), once.
 *
 * Each batch also rewrites `<job dir>/call.json`: who spoke, from when to
 * when and how many lines, so the Calls list reads a small file per call
 * instead of every transcript.
 */
export default defineStep({
  type: "stadeum/canvas/transcript-append",
  effect: "write",
  description:
    "Append a recorded call's settled lines to its scribe job's transcript (<job dir>/transcript.jsonl, one JSON object a line: " +
    "{ n, at (ISO), speaker, identity?, source: voice|chat|jamie, text }). An n already stored is skipped, so a retry is safe. " +
    "`end: true` marks the recording stopped and, the first time, starts the call's summary. " +
    "Input { job: call-…, lines: [...], end? }. Output { count, skipped, last, summarizing? } — count: the lines written now; summarizing: the summary's run.",
  input: z.object({
    job: z.string().describe("The call's scribe job, call-…"),
    lines: z.array(LineIn).default([]),
    end: z.boolean().default(false).describe("The recording stopped: nothing more will come"),
  }),
  output: z.object({ count: z.number().int(), skipped: z.number().int(), last: z.number().int().nullable(), summarizing: z.string().optional() }),
  async run(cfg, ctx) {
    const job = callJob(cfg.job, WHO);
    const lines: Line[] = cfg.lines.map((l) => {
      const at = new Date(typeof l.at === "number" || /^\d+$/.test(String(l.at)) ? Number(l.at) : String(l.at));
      if (!Number.isFinite(at.getTime())) throw new Error(`${WHO}: line ${l.n}: "${l.at}" is not a time`);
      return { n: l.n, at: at.toISOString(), speaker: l.speaker.trim(), ...(l.identity ? { identity: l.identity } : {}), source: l.source, text: l.text.replace(/\s+/g, " ").trim() };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const services = (ctx as any).services as { dataDir?: string; shell?: (r: any) => Promise<{ code: number | null; stdout: string; stderr?: string }> } | undefined;
    const dataDir = services?.dataDir;
    if (!dataDir) throw new Error(`${WHO}: this server keeps no job directories (no dataDir)`);
    const shell = services?.shell ?? shellCapability();
    const dir = jobRoot(dataDir, job);
    const sh = async (script: string, stdin?: string) => {
      const r = await shell({ cmd: "sh", args: ["-c", script, "sh", dir], cwd: dataDir, ...(stdin !== undefined ? { stdin } : {}), timeoutMs: 30_000, maxOutputChars: 64 * 1024 * 1024 });
      if (r.code !== 0) throw new Error(`${WHO}: ${String(r.stderr ?? r.stdout).trim() || `exit ${r.code}`}`);
      return r.stdout;
    };
    return serial(job, async () => {
      // The first line out says whether the recording had already stopped; the rest is the file.
      const read = await sh(`mkdir -p "$1" && touch "$1/${FILE}" && { [ -e "$1/${END_FILE}" ] && echo ended || echo open; } && cat "$1/${FILE}"`);
      const cut = read.indexOf("\n");
      const endedBefore = read.slice(0, cut) === "ended";
      const stored = read.slice(cut + 1);
      const kept = parseJsonl(stored);
      const have = new Set(kept.map((l) => l.n));
      // A line torn by a crash ends without a newline: the next one starts on a line of its own.
      const lead = stored && !stored.endsWith("\n") ? "\n" : "";
      const fresh: Line[] = [];
      for (const l of [...lines].sort((a, b) => a.n - b.n)) {
        if (have.has(l.n)) continue;
        have.add(l.n);
        fresh.push(l);
      }
      if (fresh.length) await sh(`cat >> "$1/${FILE}"`, lead + fresh.map((l) => JSON.stringify(l)).join("\n") + "\n");
      if (cfg.end) await sh(`date -u +%Y-%m-%dT%H:%M:%SZ > "$1/${END_FILE}"`);
      const all = [...kept, ...fresh];
      if (fresh.length || cfg.end) {
        const facts = factsOf(all, cfg.end || endedBefore);
        await sh(`cat > "$1/${FACTS_FILE}.tmp" && mv "$1/${FACTS_FILE}.tmp" "$1/${FACTS_FILE}"`, JSON.stringify(facts) + "\n");
      }
      const summarizing = cfg.end && !endedBefore && all.length ? await summarize(ctx, job) : undefined;
      return { count: fresh.length, skipped: lines.length - fresh.length, last: have.size ? Math.max(...have) : null, ...(summarizing ? { summarizing } : {}) };
    });
  },
});
