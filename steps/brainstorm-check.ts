import { z, defineStep } from "strut";
import { norm } from "./_canvas.js";

// stamps are code's: created_at / updated_at / created_by / created_by_kind (and variants) must never come from the model
const STAMP_KEY = /^(created|updated)_?(at|by)$|^created_?by_?kind$|^(created|updated)at$/i;
const scan = (x: any, path: string, out: string[]) => {
  if (Array.isArray(x)) x.forEach((v, i) => scan(v, `${path}[${i}]`, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (STAMP_KEY.test(k)) out.push(`${path}.${k}`); scan(v, `${path}.${k}`, out); }
};

export default defineStep({
  type: "stadeum/canvas/brainstorm-check",
  effect: "read",
  description: "Structural + brainstorm-rule check of a DRAFT (nothing written), in code. The initiative must have requirements that are not dropped: effects are weighed against them. Draft actions are adds only: { tmp, parent (ref | tmp | null), kind question|option, text, made_by, quote?, speaker?, criteria?, reversibility?, state?, makes?: string[], effects?: [{ name, description, score -1..1, requirement (ref_id) }], ratings?: { fast, good, cheap }, recommended? }. Checks parents, IBIS shape, verbatim quotes, criteria+reversibility on questions, every option has effects (score in [-1,1], non-zero, against a live requirement), three ratings in [-1,1], makes ([] at a feature, <=12 unique names), at most one recommended model option per question (open, not the person's), and that the model output carries NO stamp fields (created_at, updated_at, created_by, created_by_kind: code sets them). The '(recommended)' suffix is added by the writer step from the flag; it is shown once in the outline. Output { ok, problems, outline }.",
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
    if (![...reqs.values()].some((r: any) => r.status !== "dropped")) P("the initiative has no requirements that are not dropped: effects are weighed against requirements, so write the stories and their requirements first");
    const stamps: string[] = [];
    scan(cfg.draft, "draft", stamps);
    if (stamps.length) P(`the draft contains stamp fields (${stamps.join(", ")}): created_at, updated_at, created_by and created_by_kind are set by code, never by the model — remove them`);
    if (!actions.length) { if (!cfg.allow_empty) P("the draft adds nothing"); }
    const byTmp = new Map<string, any>();
    const children = new Map<string, any[]>();
    const out: string[] = [];
    const shown = (a: any) => `${String(a.text ?? "").trim()}${a.recommended ? " (recommended)" : ""}`;
    actions.forEach((a, i) => {
      const where = `action ${i + 1} (${a.tmp ?? "?"} "${String(a.text ?? "").slice(0, 50)}")`;
      if (a.op && a.op !== "add") { P(`${where}: only adds are allowed (choosing, rejecting and removing are people's acts on the card)`); return; }
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
