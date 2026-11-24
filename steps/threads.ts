import { z, defineStep } from "strut";

async function call(ctx: any, type: string, cfg: any) {
  const def = ctx.registry?.[type];
  if (!def) throw new Error(`stadeum/canvas/threads: step ${type} not in registry`);
  const out = await def.run(def.input.parse(cfg), ctx);
  if (typeof out === "string") throw new Error(`stadeum/canvas/threads: ${type}: ${out}`);
  return out;
}
const pool = async <T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
  return out;
};
const IN_FLIGHT = new Set(["running", "queued", "pending", "paused", "cancelling"]);
/** A settled turn never changes: its session and first words, read once per viewer. */
const seen = new Map<string, { session: string | null; prompt: string; at: string }>();

/**
 * The viewer's conversations with Jamie (the `orchestrator`) that this app holds: every turn of theirs the
 * app's calls may read (run/list as the viewer and the app, the newest `limit`), each read once (run/get),
 * grouped by the session the page named. Nothing is copied anywhere: the turns stay the runs they are, and a
 * page reads a conversation's turns itself (run/get) when it opens one. `hide` leaves sessions out.
 */
export default defineStep({
  type: "stadeum/canvas/threads",
  effect: "read",
  description: "The viewer's Jamie conversations held in this app: their orchestrator turns read in place (run/list + run/get, as the viewer and the app) and grouped by session, newest first. Input { limit?, hide?: [session name; also hides name-…] }. Output { threads: [{ session, title, startedAt, lastAt, turns, runIds (oldest first), running }], scanned, cut }. Read-only; copies nothing.",
  input: z.object({ limit: z.number().int().positive().max(500).default(300), hide: z.array(z.string()).default([]) }),
  output: z.any(),
  async run(cfg, ctx: any) {
    const listed: any = await call(ctx, "run/list", { workflow: "orchestrator", limit: cfg.limit });
    const recent: any[] = Array.isArray(listed) ? listed : listed?.runs ?? [];
    const runs: any[] = recent;
    const who = String(ctx.actor ?? "anon");
    const read = await pool(runs, 8, async (r: any) => {
      const key = `${who}:${r.runId}`;
      const live = IN_FLIGHT.has(String(r.status));
      if (!live && seen.has(key)) return { r, ...seen.get(key)! };
      let g: any = null;
      try { g = await call(ctx, "run/get", { workflow: "orchestrator", runId: r.runId }); } catch { if (!live) seen.set(key, { session: null, prompt: "", at: "" }); return { r, session: null, prompt: "", at: r.startedAt }; }
      // The session as the page named it: a thread the server keeps per app and viewer may come back as app/<app>/<viewer>/<name>.
      const raw = typeof g?.input?.session === "string" ? g.input.session : null;
      const s = raw && raw.startsWith("app/") ? raw.split("/").slice(3).join("/") || raw : raw;
      const v = { session: s, prompt: typeof g?.input?.prompt === "string" ? g.input.prompt : "", at: String(g?.startedAt ?? r.startedAt ?? "") };
      if (!live) seen.set(key, v);
      return { r, ...v };
    });
    // A hidden name hides that session and every session named after it ("name-…").
    const hidden = (s: string) => cfg.hide.some((h) => s === h || s.startsWith(`${h}-`));
    const by = new Map<string, any[]>();
    for (const x of read) {
      if (!x.session || hidden(x.session)) continue;
      (by.get(x.session) ?? by.set(x.session, []).get(x.session)!).push(x);
    }
    const threads = [...by.entries()].map(([session, xs]) => {
      xs.sort((a, b) => a.at.localeCompare(b.at));
      const first = xs.find((x) => x.prompt)?.prompt.replace(/\s+/g, " ").trim() ?? "";
      return {
        session,
        title: first ? (first.length > 80 ? `${first.slice(0, 78)}…` : first) : "Chat",
        startedAt: xs[0].at,
        lastAt: xs[xs.length - 1].at,
        turns: xs.length,
        runIds: xs.map((x) => x.r.runId),
        running: xs.some((x) => IN_FLIGHT.has(String(x.r.status))),
      };
    });
    threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return { threads, scanned: runs.length, cut: recent.length >= cfg.limit };
  },
});
