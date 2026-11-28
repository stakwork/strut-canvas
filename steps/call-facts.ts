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
/** The most of the team's words a summary is told. */
const MOST_WORDS = 300;
/**
 * The lines with the team's own words written as the team writes them, and those words: strut's `lingo/correct`, a
 * plain replace of what someone taught ("stadium" → Stadeum), no model. A strut server from before that step leaves
 * the lines as they were heard and gives the words from the vocabulary itself; one that keeps no vocabulary, neither.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function asTheTeamWrites(ctx: any, lines: Line[]): Promise<{ lines: Line[]; words: string[]; corrected: number }> {
  const correct = ctx.registry?.["lingo/correct"];
  if (correct) {
    try {
      const out = await correct.run(correct.input.parse({ lines }), ctx);
      if (Array.isArray(out?.lines) && out.lines.length === lines.length) {
        const words = (Array.isArray(out.words) ? out.words : []).filter((w: unknown): w is string => typeof w === "string" && !!w.trim());
        return { lines: out.lines as Line[], words: words.slice(0, MOST_WORDS), corrected: Array.isArray(out.changes) ? out.changes.length : 0 };
      }
    } catch (e) {
      console.warn(`${WHO}: the lines were not corrected: ${String((e as Error)?.message ?? e)}`);
    }
  }
  try {
    const lexicon = await call(ctx, "memory/lexicon", {});
    const taught = (Array.isArray(lexicon?.entities) ? lexicon.entities : []).filter(
      (e: { name?: unknown; type?: unknown; heard?: unknown; dictation_off?: unknown }) =>
        typeof e?.name === "string" && e.dictation_off !== true && (e.type === lexicon.lingo_type || (Array.isArray(e.heard) && e.heard.length > 0)),
    );
    return { lines, words: [...new Set<string>(taught.map((e: { name: string }) => e.name))].slice(0, MOST_WORDS), corrected: 0 };
  } catch {
    return { lines, words: [], corrected: 0 };
  }
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
 * line, with the team's own words written as the team writes them, those words, and what code can count so the
 * model need not: who spoke, from when to when, how long.
 */
export default defineStep({
  type: "stadeum/canvas/call-facts",
  effect: "read",
  description:
    "A recorded call for its summary: { job, lines (how many), text (one line each: n [speaker] text, the team's own words written as the " +
    "vocabulary has them), words (those words), corrected (how many were put right), names (who spoke, first names, never Jamie), " +
    "length (in words), done, facts: { people: [{ name, identity? }], startedAt?, endedAt?, lines } }. Input { job: call-… }.",
  input: z.object({
    job: z.string().describe("The call's scribe job, call-…"),
  }),
  output: z.object({
    job: z.string(),
    lines: z.number().int(),
    text: z.string(),
    words: z.array(z.string()),
    corrected: z.number().int(),
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
    const said = await asTheTeamWrites(ctx, lines);
    return {
      job: String(cfg.job).trim().replace(/^app\/.+\/(call-[A-Za-z0-9_-]{1,64})$/, "$1"),
      lines: lines.length,
      // A speaker's name is a label: square brackets in it would read as a second speaker.
      text: said.lines.map((l) => `${l.n} [${String(l.speaker).replace(/[[\]\n]/g, " ").trim()}] ${l.text.replace(/\s+/g, " ").trim()}`).join("\n"),
      words: said.words,
      corrected: said.corrected,
      names: names.length ? names.join(", ") : "nobody but Jamie",
      length: lengthOf(facts.startedAt, facts.endedAt),
      done: read?.done === true,
      facts,
    };
  },
});
