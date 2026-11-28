import { z, defineStep } from "strut";

const WHO = "stadeum/canvas/call-facts";

type Source = "voice" | "chat" | "jamie";
interface Line { n: number; at: string; speaker: string; identity?: string; source: Source; text: string }
interface Person { name: string; identity?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(ctx: any, type: string, cfg: Record<string, unknown>): Promise<any> {
  const def = ctx.registry?.[type];
  if (!def) throw new Error(`${WHO}: step ${type} not in registry`);
  const out = await def.run(def.input.parse(cfg), ctx);
  if (typeof out === "string") throw new Error(`${WHO}: ${type}: ${out}`);
  return out;
}

/** A call's facts, counted from its lines: the people who spoke (never Jamie), in the order of their first line. */
function factsOf(lines: Line[]) {
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
  return { people: [...people.values()], ...span, lines: lines.length };
}
/** "Ada Lovelace" → "Ada": how a summary names a person. */
const firstName = (name: string) => name.trim().split(/[\s._]+/)[0] ?? name;
function lengthOf(startedAt: string | undefined, endedAt: string | undefined): string {
  const ms = startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : NaN;
  if (!Number.isFinite(ms)) return "an unknown time";
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "under a minute" : minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}

/**
 * A recorded call as its summary's writer reads it (workflows/summarize.yaml): what was said as text, one thing a
 * line, and what code can count so the model need not: who spoke, from when to when, how long.
 */
export default defineStep({
  type: "stadeum/canvas/call-facts",
  effect: "read",
  description:
    "A recorded call for its summary: { job, lines (how many), text (one line each: n [speaker] text), names (who spoke, first names, never Jamie), " +
    "length (in words), done, facts: { people: [{ name, identity? }], startedAt?, endedAt?, lines } }. Input { job: call-… }.",
  input: z.object({
    job: z.string().describe("The call's scribe job, call-…"),
  }),
  output: z.object({
    job: z.string(),
    lines: z.number().int(),
    text: z.string(),
    names: z.string(),
    length: z.string(),
    done: z.boolean(),
    facts: z.any(),
  }),
  async run(cfg, ctx) {
    const read = await call(ctx, "stadeum/canvas/transcript", { job: cfg.job });
    const lines: Line[] = (Array.isArray(read?.lines) ? read.lines : []).filter((l: Line | null) => l && Number.isInteger(l.n) && typeof l.text === "string" && l.text.trim());
    const facts = factsOf(lines);
    const names = [...new Set(facts.people.map((p) => firstName(p.name)))];
    return {
      job: String(cfg.job).trim().replace(/^app\/.+\/(call-[A-Za-z0-9_-]{1,64})$/, "$1"),
      lines: lines.length,
      // A speaker's name is a label: square brackets in it would read as a second speaker.
      text: lines.map((l) => `${l.n} [${String(l.speaker).replace(/[[\]\n]/g, " ").trim()}] ${l.text.replace(/\s+/g, " ").trim()}`).join("\n"),
      names: names.length ? names.join(", ") : "nobody but Jamie",
      length: lengthOf(facts.startedAt, facts.endedAt),
      done: read?.done === true,
      facts,
    };
  },
});
