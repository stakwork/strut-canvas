import { z, defineStep } from "strut";
import { norm } from "./_canvas.js";

// ── a call's chunk lines and a card's back-link (inlined from the package's steps/_transcript.ts: a helper module cannot be published here) ──
/** A numbered chunk line: `n [hh:mm] Name: text`. */
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

// stamps are code's: created_at / updated_at / created_by / created_by_kind (and variants) must never come from the model
const STAMP_KEY = /^(created|updated)_?(at|by)$|^created_?by_?kind$|^(created|updated)at$/i;
const scan = (x: any, path: string, out: string[]) => {
  if (Array.isArray(x)) x.forEach((v, i) => scan(v, `${path}[${i}]`, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (STAMP_KEY.test(k)) out.push(`${path}.${k}`); scan(v, `${path}.${k}`, out); }
};

/** A transcript line: `n [hh:mm] Name: text` (a call's chunk), `[hh:mm] Name: text` or `Name: text`. */
const LINE = /^\s*(\d+\s+(?=\[))?(?:\[[^\]]*\]\s*)?([^:\[\]\n]{1,60}):\s*(.*)$/;

/**
 * Did `speaker` say `quote`, on a line of their own in the transcript? A choice is recorded only from a person's own
 * words: in a chat, where there are no speakers' lines, the person chooses on the card.
 */
export function saidOnLine(transcript: string, speaker: string, quote: string, lines?: number[]): boolean {
  const who = norm(speaker), words = norm(quote);
  if (!who || !words) return false;
  const only = lines?.length ? new Set(lines) : null;
  return transcript.split("\n").some((l) => {
    const m = LINE.exec(l);
    if (!m) return false;
    if (only && !(m[1] && only.has(Number(m[1])))) return false;
    return norm(m[2]) === who && norm(m[3]).includes(words);
  });
}

export default defineStep({
  type: "stadeum/canvas/brainstorm-check",
  effect: "read",
  description: "Structural + brainstorm-rule check of a DRAFT (nothing written), in code. The initiative must have requirements that are not dropped: effects are weighed against them. Draft actions are adds: { op: add, tmp, parent (ref | tmp | null), kind question|option, text, made_by, quote?, speaker?, lines?: [n], criteria?, reversibility?, state?, makes?: string[], effects?: [{ name, description, score -1..1, requirement (ref_id) }], ratings?: { fast, good, cheap }, recommended? }, and chooses: { op: choose, option (ref | tmp), speaker, quote, lines?: [n] } — a choice a person said aloud, recorded only when `quote` is in a transcript line of `speaker`'s own ([hh:mm] Name: text) and the question has no chosen option yet. From a call, `lines` are the chunk's line numbers it came from: each must be a numbered line of the prompt (n [hh:mm] Name: text), the speaker one who said them and the quote their words. Checks parents, IBIS shape, verbatim quotes, criteria+reversibility on questions, every option has effects (score in [-1,1], non-zero, against a live requirement), three ratings in [-1,1], makes ([] at a feature, <=12 unique names), at most one recommended model option per question (open, not the person's), and that the model output carries NO stamp fields (created_at, updated_at, created_by, created_by_kind: code sets them). The '(recommended)' suffix is added by the writer step from the flag; it is shown once in the outline. Output { ok, problems, outline }.",
  input: z.object({
    draft: z.any(),
    tree: z.any().optional(),
    prompt: z.string().default(""),
    requirements: z.any(),
    level: z.string().default("initiative"),
    allow_empty: z.boolean().default(false),
  }),
  output: z.any(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(cfg) {
    const actions: any[] = Array.isArray(cfg.draft?.actions) ? cfg.draft.actions : [];
    const tree: any = cfg.tree ?? {};
    const existing = new Map<string, any>((tree.nodes ?? []).map((n: any) => [n.ref_id, n]));
    const hasRoot = !!tree.root && existing.size > 0;
    const reqs = new Map<string, any>((Array.isArray(cfg.requirements) ? cfg.requirements : []).map((r: any) => [r.ref_id, r]));
    const prompt = norm(cfg.prompt);
    const problems: string[] = [];
    const P = (m: string) => problems.push(m);
    const adds = actions.some((a) => !a?.op || a.op === "add");
    if (adds && ![...reqs.values()].some((r: any) => r.status !== "dropped")) P("the initiative has no requirements that are not dropped: effects are weighed against requirements, so write the stories and their requirements first");
    const stamps: string[] = [];
    scan(cfg.draft, "draft", stamps);
    if (stamps.length) P(`the draft contains stamp fields (${stamps.join(", ")}): created_at, updated_at, created_by and created_by_kind are set by code, never by the model — remove them`);
    if (!actions.length) { if (!cfg.allow_empty) P("the draft adds nothing"); }
    const byTmp = new Map<string, any>();
    const children = new Map<string, any[]>();
    const out: string[] = [];
    const chosen = new Set<string>();
    const shown = (a: any) => `${String(a.text ?? "").trim()}${a.recommended ? " (recommended)" : ""}`;
    actions.forEach((a, i) => {
      const where = `action ${i + 1} (${a.tmp ?? "?"} "${String(a.text ?? "").slice(0, 50)}")`;
      if (a.op === "choose") {
        const w = `action ${i + 1} (choose ${a.option ?? "?"})`;
        const o = byTmp.get(a.option) ?? existing.get(a.option);
        const kind = o?.kind ?? (o?.node_type === "Option" ? "option" : o?.node_type === "Question" ? "question" : null);
        if (!o) { P(`${w}: option ${a.option} is neither in the tree nor added earlier in this draft`); return; }
        if (kind !== "option") { P(`${w}: only an option is chosen`); return; }
        if (o.state === "rejected") P(`${w}: "${String(o.text ?? "").slice(0, 50)}" was rejected`);
        const cited = citedLines(a.lines, String(cfg.prompt ?? ""));
        if (cited.problem) P(`${w}: ${cited.problem}`);
        if (!String(a.speaker ?? "").trim() || !String(a.quote ?? "").trim()) P(`${w}: a choice needs the speaker who made it and their words as quote`);
        else if (cited.lines.length && !saidOnLine(String(cfg.prompt ?? ""), a.speaker, a.quote, cited.lines.map((l) => l.n))) P(`${w}: "${String(a.quote).slice(0, 60)}" is not on a line of ${a.speaker}'s among lines ${cited.lines.map((l) => l.n).join(", ")}`);
        else if (!saidOnLine(String(cfg.prompt ?? ""), a.speaker, a.quote)) P(`${w}: "${String(a.quote).slice(0, 60)}" is not on a line of ${a.speaker}'s in the transcript; a choice is recorded only from a person's own words (in a chat, the person chooses on the card)`);
        const q = o.parent;
        const taken = q ? [...(tree.nodes ?? []), ...byTmp.values()].some((n: any) => n.parent === q && n.kind === "option" && n.state === "chosen" && n.ref_id !== a.option)
          || chosen.has(q) : false;
        if (taken) P(`${w}: its question already has a chosen option; a person takes that back on the card`);
        if (q) chosen.add(q);
        out.push(`  CHOOSE ${a.option}: ${String(o.text ?? "").trim()} — ${a.speaker}: "${a.quote}"`);
        return;
      }
      if (a.op && a.op !== "add") { P(`${where}: op must be add or choose (rejecting and removing are people's acts on the card)`); return; }
      if (!a.tmp || byTmp.has(a.tmp)) P(`${where}: tmp id missing or duplicated`);
      if (!String(a.text ?? "").trim()) P(`${where}: empty text`);
      if (a.kind !== "question" && a.kind !== "option") { P(`${where}: kind must be question or option`); return; }
      if (!["user", "model"].includes(a.made_by)) P(`${where}: made_by must be user or model`);
      let parentNode: any = null; let parentKey = "";
      if (a.parent === null || a.parent === undefined || a.parent === "") {
        if (a.kind !== "question") P(`${where}: an option needs a parent question`);
        else if (hasRoot) P(`${where}: the tree already has a root — a new question must hang under an existing node`);
        else if (i !== 0) P(`${where}: the root question must be the first action`);
      } else {
        parentNode = byTmp.get(a.parent) ?? existing.get(a.parent);
        parentKey = a.parent;
        if (!parentNode) P(`${where}: parent ${a.parent} is neither an existing node nor added earlier in this draft`);
        else {
          const pk = parentNode.kind ?? (parentNode.node_type === "Question" ? "question" : "option");
          if (a.kind === "option" && pk !== "question") P(`${where}: an option's parent must be a question (an option never sits directly under another option)`);
        }
      }
      if (a.made_by === "user") {
        if (!String(a.quote ?? "").trim()) P(`${where}: made_by user needs the person's words as quote`);
        else if (prompt && !prompt.includes(norm(a.quote))) P(`${where}: quote is not in the person's message verbatim`);
      }
      if (a.speaker && prompt && !prompt.includes(norm(a.speaker))) P(`${where}: speaker "${a.speaker}" does not appear in the message`);
      // From a call: the chunk's lines it came from; the speaker said one of them, the quote is their words.
      if (a.lines !== undefined && a.lines !== null) {
        try { backLink(a, String(cfg.prompt ?? ""), "check", where); } catch (e) { P(e instanceof Error ? e.message : String(e)); }
      }
      if (a.state && !["open", "simulated"].includes(a.state)) P(`${where}: state must be open or simulated`);
      if (a.kind === "question") {
        if (!String(a.criteria ?? "").trim()) P(`${where}: a question needs criteria (2-4 things that decide it)`);
        if (!["one_way", "two_way"].includes(a.reversibility)) P(`${where}: a question needs reversibility one_way|two_way`);
        if ((a.effects ?? []).length || a.ratings || (a.makes ?? []).length || a.recommended) P(`${where}: effects, ratings, makes and recommended belong on options only`);
      } else {
        if (a.criteria || a.reversibility) P(`${where}: criteria and reversibility belong on questions only`);
        const eff = Array.isArray(a.effects) ? a.effects : [];
        if (!eff.length) P(`${where}: every option needs at least one effect`);
        eff.forEach((e: any, j: number) => {
          const w = `${where} effect ${j + 1}`;
          if (!String(e.name ?? "").trim()) P(`${w}: empty name`);
          if (!String(e.description ?? "").trim()) P(`${w}: empty description`);
          const s = Number(e.score);
          if (!Number.isFinite(s) || s < -1 || s > 1) P(`${w}: score must be a number from -1 to 1`);
          else if (s === 0) P(`${w}: score 0 is neither a pro nor a con — drop the effect or score it`);
          const r = reqs.get(e.requirement);
          if (!r) P(`${w}: requirement "${e.requirement}" is not a requirement of this initiative (use its ref_id)`);
          else if (r.status === "dropped") P(`${w}: requirement "${String(r.text).slice(0, 40)}" is dropped`);
        });
        const rt = a.ratings;
        for (const k of ["fast", "good", "cheap"]) {
          const v = Number(rt?.[k]);
          if (!rt || rt[k] === undefined || !Number.isFinite(v) || v < -1 || v > 1) P(`${where}: rating ${k} must be a number from -1 to 1`);
        }
        const mk = a.makes;
        if (!Array.isArray(mk)) P(`${where}: makes must be a list of names ([] at a feature)`);
        else {
          if (cfg.level === "feature" && mk.length) P(`${where}: at a feature makes must be []`);
          if (mk.length > 12) P(`${where}: makes has ${mk.length} names; at most 12`);
          const seen = new Set<string>();
          mk.forEach((n: any) => { if (!String(n ?? "").trim()) P(`${where}: makes has an empty name`); const k = norm(n); if (seen.has(k)) P(`${where}: makes repeats "${n}"`); seen.add(k); });
        }
        if (a.recommended) {
          if (a.made_by === "user") P(`${where}: a person's own option cannot be marked recommended`);
          if (a.state && a.state !== "open") P(`${where}: a recommended option must stay open`);
        }
        if (parentKey) { const l = children.get(parentKey) ?? []; l.push(a); children.set(parentKey, l); }
      }
      byTmp.set(a.tmp, { ...a, kind: a.kind });
      out.push(`${"  ".repeat(parentKey && byTmp.has(parentKey) ? 2 : 1)}NEW ${a.kind} ${a.tmp}${a.made_by === "user" ? " (person)" : ""} under ${parentKey || "ROOT"}: ${shown(a)}`
        + (a.kind === "question" ? `\n      criteria: ${a.criteria ?? "-"} | reversibility: ${a.reversibility ?? "-"}` : `\n      makes: ${JSON.stringify(a.makes ?? null)} | ratings fast ${a.ratings?.fast} good ${a.ratings?.good} cheap ${a.ratings?.cheap}`
          + (a.effects ?? []).map((e: any) => `\n      effect ${e.score >= 0 ? "pro" : "con"} ${e.score} against ${String(reqs.get(e.requirement)?.text ?? e.requirement).slice(0, 50)} — ${e.name}: ${e.description}`).join("")));
    });
    for (const [pk, list] of children) {
      const newRec = list.filter((o) => o.recommended).length;
      const oldRec = (tree.nodes ?? []).filter((n: any) => n.parent === pk && n.kind === "option" && n.state !== "rejected" && n.recommended).length;
      if (newRec + oldRec > 1) P(`question ${pk} would have ${newRec + oldRec} recommended options (at most one)`);
    }
    return { ok: problems.length === 0, problems, outline: `${tree.outline ?? "(empty tree)"}\n\n${out.join("\n")}` };
  },
});
