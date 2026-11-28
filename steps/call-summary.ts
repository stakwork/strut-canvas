import { z, defineStep, jobRoot, shellCapability } from "strut";

const WHO = "stadeum/canvas/call-summary";
const SUMMARY_FILE = "summary.json";
const CALL_JOB = /^call-[A-Za-z0-9_-]{1,64}$/;
function callJob(job: string, who: string): string {
  // Launched from the canvas page, strut scopes `job` to the app (`app/<app>/<job>`): a call's job is the server's.
  const j = String(job ?? "").trim().replace(/^app\/.+\/(call-[A-Za-z0-9_-]{1,64})$/, "$1");
  if (!CALL_JOB.test(j)) throw new Error(`${who}: "${job}" is not a recorded call's job (call-…)`);
  return j;
}

/** The most a summary keeps: a model that writes a page per bullet is cut, not stored. */
const MOST = 12;
const LINE_MAX = 400;
const TITLE_MAX = 120;
const one = (v: unknown, max: number): string => {
  const s = String(v ?? "").replace(/\s+/g, " ").replace(/^[-•*]\s+/, "").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};
/** A list's points: trimmed, none empty, none a bare "None" the model wrote for an empty list. */
const points = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => one(x, LINE_MAX))
    .filter((s) => s && !/^(none|n\/a|nothing)\.?$/i.test(s))
    .slice(0, MOST);
interface Person { name: string; identity?: string }

/**
 * Keeps a call's summary beside its transcript (`<job dir>/summary.json`), where the Calls page reads it
 * (`stadeum/canvas/calls`). The summarize workflow's last step: the model wrote the fields, this checks and stores
 * them with the call's facts as they were counted. A second summary of the same call replaces the first.
 */
export default defineStep({
  type: "stadeum/canvas/call-summary",
  effect: "write",
  description:
    "Keep a recorded call's summary with the call (<job dir>/summary.json): { title, discussed, decided, actions: [{ who, items }], open }, " +
    "and `facts` as stadeum/canvas/call-facts counted them. Replaces an earlier one. Refuses a summary with no title. " +
    "Output: what was stored — { job, title, discussed, decided, actions, open, people, startedAt?, endedAt?, lines, at }.",
  input: z.object({
    job: z.string().describe("The call's scribe job, call-…"),
    title: z.string(),
    discussed: z.array(z.any()).default([]),
    decided: z.array(z.any()).default([]),
    actions: z.array(z.any()).default([]).describe("[{ who, items: [...] }], one per person"),
    open: z.array(z.any()).default([]),
    facts: z.any().optional().describe("stadeum/canvas/call-facts' `facts`: people, startedAt, endedAt, lines"),
  }),
  output: z.any(),
  async run(cfg, ctx) {
    const job = callJob(cfg.job, WHO);
    const title = one(cfg.title, TITLE_MAX).replace(/^["'“‘]+|["'”’]+$/g, "");
    if (!title) throw new Error(`${WHO}: the summary has no title`);
    const actions = cfg.actions
      .map((a) => ({ who: one((a as { who?: unknown } | null)?.who, 80), items: points((a as { items?: unknown } | null)?.items) }))
      .filter((a) => a.who && a.items.length)
      .slice(0, MOST);
    const f = (cfg.facts && typeof cfg.facts === "object" ? cfg.facts : {}) as { people?: unknown; startedAt?: unknown; endedAt?: unknown; lines?: unknown };
    const people: Person[] = (Array.isArray(f.people) ? f.people : []).flatMap((p) => {
      const name = one((p as Person | null)?.name, 80);
      const identity = typeof (p as Person | null)?.identity === "string" ? (p as Person).identity : undefined;
      return name ? [{ name, ...(identity ? { identity } : {}) }] : [];
    });
    const when = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined);
    const startedAt = when(f.startedAt);
    const endedAt = when(f.endedAt);
    const summary = {
      title,
      discussed: points(cfg.discussed),
      decided: points(cfg.decided),
      actions,
      open: points(cfg.open),
      people,
      ...(startedAt ? { startedAt } : {}),
      ...(endedAt ? { endedAt } : {}),
      lines: typeof f.lines === "number" && Number.isFinite(f.lines) ? f.lines : 0,
      at: new Date().toISOString(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const services = (ctx as any).services as { dataDir?: string; shell?: (r: any) => Promise<{ code: number | null; stdout: string; stderr?: string }> } | undefined;
    const dataDir = services?.dataDir;
    if (!dataDir) throw new Error(`${WHO}: this server keeps no job directories (no dataDir)`);
    const shell = services?.shell ?? shellCapability();
    const dir = jobRoot(dataDir, job);
    // Written whole, then moved into place: a reader never sees half a file. A call recorded before its lines were
    // stored may have no directory yet (its transcript is rebuilt from the scribe's turns): it is made.
    const r = await shell({
      cmd: "sh",
      args: ["-c", `mkdir -p "$1" && cat > "$1/${SUMMARY_FILE}.tmp" && mv "$1/${SUMMARY_FILE}.tmp" "$1/${SUMMARY_FILE}"`, "sh", dir],
      cwd: dataDir,
      stdin: JSON.stringify(summary, null, 2) + "\n",
      timeoutMs: 30_000,
      maxOutputChars: 64 * 1024,
    });
    if (r.code !== 0) throw new Error(`${WHO}: ${String(r.stderr ?? r.stdout).trim() || `exit ${r.code}`}`);
    return { job, ...summary };
  },
});
