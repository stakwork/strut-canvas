import { z, defineStep, jobRoot, shellCapability } from "strut";

const WHO = "stadeum/canvas/transcript-append";

// ── inlined from the package's steps/_transcript.ts (a helper module cannot be published here) ──
const SOURCES = ["voice", "chat", "jamie"] as const;
type Source = (typeof SOURCES)[number];
interface Line { n: number; at: string; speaker: string; identity?: string; source: Source; text: string }
const FILE = "transcript.jsonl";
/** Written when voice says the recording stopped (`transcript-append { end: true }`). */
const END_FILE = "transcript.end";
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
 * recording stopped: `transcript` then answers `done`.
 */
export default defineStep({
  type: "stadeum/canvas/transcript-append",
  effect: "write",
  description:
    "Append a recorded call's settled lines to its scribe job's transcript (<job dir>/transcript.jsonl, one JSON object a line: " +
    "{ n, at (ISO), speaker, identity?, source: voice|chat|jamie, text }). An n already stored is skipped, so a retry is safe. " +
    "`end: true` marks the recording stopped. Input { job: call-…, lines: [...], end? }. Output { count, skipped, last } — count: the lines written now.",
  input: z.object({
    job: z.string().describe("The call's scribe job, call-…"),
    lines: z.array(LineIn).default([]),
    end: z.boolean().default(false).describe("The recording stopped: nothing more will come"),
  }),
  output: z.object({ count: z.number().int(), skipped: z.number().int(), last: z.number().int().nullable() }),
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
      const stored = await sh(`mkdir -p "$1" && touch "$1/${FILE}" && cat "$1/${FILE}"`);
      const have = new Set(parseJsonl(stored).map((l) => l.n));
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
      return { count: fresh.length, skipped: lines.length - fresh.length, last: have.size ? Math.max(...have) : null };
    });
  },
});
