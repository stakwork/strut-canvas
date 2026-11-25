import { z, defineStep } from "strut";
import { ABOUT, AGAINST, EFFECT, HAS_EFFECT, OPTION, PARENT_OF, QUESTION, actorOf, call, clip, getNode, live, nextSeq } from "./_canvas.js";
import { choose, unchoose } from "./_brainstorm.js";
import { norm } from "./_canvas.js";

// ── a call's chunk lines and a card's back-link (inlined from the package's steps/_transcript.ts: a helper module cannot be published here) ──
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
function citedLines(raw: unknown, prompt: string): { lines: ChunkLine[]; problem?: string } {
  if (raw === undefined || raw === null) return { lines: [] };
  const list = Array.isArray(raw) ? raw : [raw];
  if (!list.length) return { lines: [] };
  const bad = list.filter((x) => !Number.isInteger(Number(x)) || Number(x) < 0 || x === "" || typeof x === "boolean");
  if (bad.length) return { lines: [], problem: `lines must be line numbers from the chunk (got ${JSON.stringify(bad[0])})` };
  const chunk = new Map(chunkLines(prompt).map((l) => [l.n, l]));
  if (!chunk.size) return { lines: [], problem: "lines cite line numbers, but the prompt has no numbered lines (n [hh:mm] Name: text): pass the call's chunk unchanged as prompt" };
  const ns = [...new Set(list.map(Number))].sort((a, b) => a - b);
  const missing = ns.filter((n) => !chunk.has(n));
  if (missing.length) return { lines: [], problem: `line${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not in this turn's chunk (it has ${[...chunk.keys()][0]}–${[...chunk.keys()].pop()})` };
  return { lines: ns.map((n) => chunk.get(n)!) };
}
function backLink(a: { lines?: unknown; speaker?: unknown; quote?: unknown }, prompt: string, job: string | undefined, where: string): Record<string, string> {
  const { lines, problem } = citedLines(a.lines, prompt);
  if (problem) throw new Error(`${where}: ${problem}`);
  const speaker = String(a.speaker ?? "").trim();
  const quote = String(a.quote ?? "").trim();
  const out: Record<string, string> = {};
  if (lines.length) {
    if (!job) throw new Error(`${where}: lines cite the call, but the run names no job`);
    out["call_job"] = job;
    out["call_lines"] = JSON.stringify(lines.map((l) => l.n));
    if (speaker && !lines.some((l) => norm(l.speaker) === norm(speaker))) throw new Error(`${where}: "${speaker}" said none of lines ${lines.map((l) => l.n).join(", ")}`);
    if (quote && !norm(lines.map((l) => l.text).join(" ")).includes(norm(quote))) throw new Error(`${where}: "${quote.slice(0, 60)}" is not in lines ${lines.map((l) => l.n).join(", ")}`);
  } else if (quote && prompt && !norm(prompt).includes(norm(quote))) throw new Error(`${where}: "${quote.slice(0, 60)}" is not in the prompt verbatim`);
  if (speaker) out["speaker"] = speaker;
  if (quote) out["quote"] = quote;
  return out;
}
/** A choice's call back-link, which the installed `_brainstorm` helper does not write: set after `choose`, taken off after `unchoose`. */
const CALL_ALOUD = ["state_call_job", "state_call_lines"];

const WHO = "stadeum/canvas/brainstorm-write";

export default defineStep({
  type: "stadeum/canvas/brainstorm-write",
  description:
    "Write a CHECKED brainstorm draft (`brainstorm-check` first) in order: each Question and Option linked PARENT_OF under its " +
    "parent (an existing ref or an earlier action's tmp), an Option's `makes`, `recommended` and fast/good/cheap ratings, and each effect " +
    "as Option -HAS_EFFECT-> Effect { name, description, score } -AGAINST-> Requirement. A new tree's root question is linked ABOUT the " +
    "card it is about. Then each choose: the option chosen, with the speaker and their words. From a call, a card (and a choice) carries call_job and call_lines, the chunk's line numbers it came from. The job, run and turn are stamped from the run. On a failure the nodes this turn wrote are taken back. " +
    "Output { root, turn, written: [{ ref_id, node_type, tmp?, text?, parent?, option?, against?, score? }] }.",
  effect: "write",
  input: z.object({
    draft: z.any(),
    tree: z.any().optional().describe("`tree`'s output for the brainstorm, before this turn"),
    root: z.string().optional(),
    about: z.string().optional().describe("A new brainstorm: the card it is about"),
    job: z.string(),
    prompt: z.string().default("").describe("The turn's prompt: a call's chunk, whose line numbers `lines` cite"),
  }),
  output: z.any(),
  async run(cfg, ctx) {
    const actions: Array<Record<string, any>> = cfg.draft?.actions ?? [];
    if (!actions.length) throw new Error(`${WHO}: the draft has no actions`);
    const run_id = String(ctx.runId);
    const by = actorOf(ctx);
    const tree = cfg.tree ?? {};
    const turn = (tree.nodes ?? []).reduce((m: number, n: { turn?: unknown }) => Math.max(m, Number(n.turn ?? 0)), 0) + 1;
    const created: string[] = [];
    const chosen: string[] = [];
    const written: Array<Record<string, unknown>> = [];
    const refs: Record<string, string> = {};
    let root = cfg.root ?? "";
    const mk = async (type: string, data: Record<string, unknown>) => {
      const r = await call(ctx, "graph/create-node", { node_type: type, node_data: data }, WHO);
      created.push(r.ref_id);
      return r.ref_id as string;
    };
    const link = (from: string, edge: string, to: string) => call(ctx, "graph/create-triplet", { source_ref_id: from, edge_type: edge, target_ref_id: to }, WHO);
    try {
      if (cfg.about && !cfg.root) {
        const a = await getNode(ctx, cfg.about, WHO);
        if (!a || !live(a.properties)) throw new Error(`${WHO}: ${cfg.about}, the card the brainstorm is about, is not there`);
      }
      for (const a of actions) {
        if (a["op"] === "choose") continue;
        const isQ = a["kind"] === "question";
        const parent = a["parent"] ? (refs[a["parent"]] ?? a["parent"]) : null;
        const text = String(a["text"]).trim();
        const data: Record<string, unknown> = { name: clip(text), text, made_by: a["made_by"], state: isQ ? "open" : (a["state"] ?? "open"), job: cfg.job, run_id, turn, seq: nextSeq() };
        if (a["made_by"] === "user" && by) data["by"] = by;
        if (String(a["quote"] ?? "").trim()) data["quote"] = String(a["quote"]).trim();
        if (String(a["speaker"] ?? "").trim()) data["speaker"] = String(a["speaker"]).trim();
        // From a call: the job and the chunk's lines it came from (brainstorm-check has checked them against the chunk).
        const from = backLink({ lines: a["lines"] }, cfg.prompt, cfg.job, WHO);
        if (from["call_job"]) Object.assign(data, { call_job: from["call_job"], call_lines: from["call_lines"] });
        if (isQ) {
          data["criteria"] = String(a["criteria"]).trim();
          data["reversibility"] = a["reversibility"];
        } else {
          data["makes"] = JSON.stringify((a["makes"] ?? []).map((x: unknown) => String(x).trim()));
          if (a["recommended"]) data["recommended"] = true;
          for (const k of ["fast", "good", "cheap"]) data[k] = Number(a["ratings"]?.[k]);
        }
        const ref = await mk(isQ ? QUESTION : OPTION, data);
        refs[a["tmp"]] = ref;
        if (parent) await link(parent, PARENT_OF, ref);
        else root = ref;
        written.push({ ref_id: ref, node_type: isQ ? QUESTION : OPTION, tmp: a["tmp"], text, parent });
        if (!isQ) {
          for (const e of a["effects"] ?? []) {
            const score = Number(e.score);
            const eref = await mk(EFFECT, { name: String(e.name).trim(), description: String(e.description).trim(), score, made_by: "model", job: cfg.job, run_id, turn });
            await link(ref, HAS_EFFECT, eref);
            await link(eref, AGAINST, e.requirement);
            written.push({ ref_id: eref, node_type: EFFECT, option: ref, against: e.requirement, score });
          }
        }
      }
      if (!cfg.root && root && cfg.about) await link(root, ABOUT, cfg.about);
      // A choice a person said aloud: after the adds, since it may choose an option this draft added.
      for (const a of actions) {
        if (a["op"] !== "choose") continue;
        const ref = refs[a["option"]] ?? a["option"];
        const from = backLink({ lines: a["lines"] }, cfg.prompt, cfg.job, WHO);
        const said = { speaker: String(a["speaker"]).trim(), quote: String(a["quote"]).trim() };
        await choose(ctx, ref, `${said.speaker}: "${clip(said.quote, 200)}"`, WHO, said);
        chosen.push(ref);
        if (from["call_job"]) await call(ctx, "graph/edit-node", { ref_id: ref, node_data: { state_call_job: from["call_job"], state_call_lines: from["call_lines"] ?? "[]" } }, WHO);
        written.push({ ref_id: ref, node_type: OPTION, chosen: true, speaker: said.speaker });
      }
    } catch (e) {
      for (const ref of chosen) {
        await unchoose(ctx, ref, "the brainstorm turn that chose it failed", WHO).catch(() => {});
        await call(ctx, "graph/edit-node", { ref_id: ref, properties_to_be_deleted: CALL_ALOUD }, WHO).catch(() => {});
      }
      let undone = 0;
      for (const ref of [...created].reverse()) {
        try {
          await call(ctx, "graph/delete-node", { ref_id: ref, reason: "the brainstorm turn that wrote it failed" }, WHO);
          undone++;
        } catch {
          /* best effort */
        }
      }
      throw new Error(`${e instanceof Error ? e.message : String(e)} Took back ${undone} of ${created.length} node(s) this turn wrote.`);
    }
    return { root, turn, written, job: cfg.job, run_id };
  },
});
