import { z, defineStep } from "strut";
import { initiativeNamed, live, normStatus as canvasStatus } from "./_canvas.js";
import { removeCard } from "./_remove.js";

async function call(ctx: any, type: string, cfg: any) {
  const def = ctx.registry?.[type];
  if (!def) throw new Error(`stadeum/canvas/write: step ${type} not in registry`);
  return def.run(def.input.parse(cfg), ctx);
}
const norm = (s: any) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const clip = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const arr = (x: any): any[] => (Array.isArray(x) ? x : []);
const rowsOf = (res: any): any[] => (Array.isArray(res) ? res : res?.records ?? res?.rows ?? []);

// STAMPS ARE CODE'S, NEVER THE MODEL'S.
//  created_by / created_by_kind : the created_by_kind input (strut | jamie). created_at and updated_at are strut's own.
// A new initiative, milestone or feature starts planned. Milestone sequence runs 1..n.
const STAMP_KEY = /^(created|updated)_?(at|by)$|^created_?by_?kind$|^(created|updated)at$/i;
const findStampKeys = (x: any, path = "plan", out: string[] = []): string[] => {
  if (Array.isArray(x)) x.forEach((v, i) => findStampKeys(v, `${path}[${i}]`, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (STAMP_KEY.test(k)) out.push(`${path}.${k}`); findStampKeys(v, `${path}.${k}`, out); }
  return out;
};
const IMMUTABLE_ON_UPDATE = ["created_at", "created_by", "author", "created_by_kind"];
const FLAGS = ["status", "blocked", "blocked_reason"];
const EDITABLE: Record<string, string[]> = {
  Initiative: ["name", "description", ...FLAGS],
  Brief: ["text", "name"], UserStory: ["text", "name"], Requirement: ["text", "name"],
  Milestone: ["name", "description", "sequence", ...FLAGS], Feature: ["name", "description", ...FLAGS], Architecture: ["name", "description", "diagram"],
};
/** A status as the canvas writes it (planned, active, done, dropped). BLOCKED is the `blocked` flag, never a status. */
function normStatus(_type: string, raw: any): string {
  const v = canvasStatus(raw, "canvas");
  if (v === "blocked") throw new Error(`canvas: blocked is not a status: set the flag instead, with field "blocked" (true/false) and optionally "blocked_reason". Nothing was written.`);
  return v;
}
/** blocked is a real boolean: only true/false (or yes/no) are taken */
function normBool(raw: any): boolean {
  if (typeof raw === "boolean") return raw;
  const s = String(raw ?? "").trim().toLowerCase();
  if (["true", "yes", "1", "blocked"].includes(s)) return true;
  if (["false", "no", "0", "unblocked", "clear"].includes(s)) return false;
  throw new Error(`canvas: "${raw}" is not valid for blocked (use true or false). Nothing was written.`);
}
const FIELD_ALIAS: Record<string, string> = { summary: "description" };
const STAMPED_TYPES = new Set(["Brief", "UserStory", "Requirement", "Milestone", "Feature", "Initiative"]);
const ONLY: Record<string, string> = { brief: "brief", stories: "stories", milestones: "milestones", features: "features", architecture: "architectures", edit: "edits", delete: "deletes" };

export default defineStep({
  type: "stadeum/canvas/write",
  description: "Apply a canvas BATCH plan (typed, from the job agent) to the graph, validated entirely before anything is written. deletes remove a card and what is under it, kept so a person can restore it. edits may set `status` on the initiative, a milestone or a feature (planned, active, done, dropped; 'in progress' and 'done' are taken) and the `blocked` flag (+ `blocked_reason`). A person's cards are left alone unless allow_human.",
  input: z.object({
    plan: z.any(),
    context: z.any(),
    job: z.string().optional(),
    created_by_kind: z.enum(["strut", "jamie"]).default("jamie"),
    allow_human: z.boolean().default(false),
    expected_action: z.string().optional(),
    fail_on_model_stamps: z.boolean().default(false),
  }),
  output: z.any(),
  async run(cfg, ctx) {
    const plan = cfg.plan ?? {};
    const c = cfg.context;
    const sendUpdated = false;
    const notes: string[] = [];
    if (plan.action === "ask") return { action: "ask", written: [], touched: [], skipped: [], ignored_stamp_fields: [], dropped_attrs: [], artifacts: [], notes: [], text: String(plan.ask || plan.reason || "I need one more detail before I can write this."), next: null };
    if (plan.action === "brainstorm") throw new Error("canvas/write: brainstorm is not written here (it runs the brainstorm path).");

    const ignoredStamps = [...new Set([...findStampKeys(plan), ...arr(plan.ignored_stamp_fields)])];
    if (ignoredStamps.length && cfg.fail_on_model_stamps) throw new Error(`canvas: the plan contains stamp fields (${ignoredStamps.join(", ")}). created_at, updated_at, created_by and created_by_kind are set by code, never by the caller. Nothing was written.`);

    const now = () => new Date().toISOString();
    const by = cfg.created_by_kind;
    const tol = new Set<string>();
    const stamp = () => ({ author: by, created_by_kind: by });
    const nonEmpty = (v: any, what: string) => { const s = String(v ?? "").trim(); if (!s) throw new Error(`canvas: ${what} is empty. Names and texts must not be empty; nothing was written.`); return s; };

    const dupInitiative = async (name: string, self: string | null): Promise<{ id: string; name: string } | null> => {
      const hit = await initiativeNamed(ctx, name, self, "canvas");
      return hit ? { id: hit.ref_id, name: hit.name } : null;
    };
    const P = {
      new_initiative: plan.new_initiative && String(plan.new_initiative.name ?? "").trim() ? plan.new_initiative : null,
      brief: plan.brief && String(plan.brief.text ?? "").trim() ? plan.brief : null,
      stories: arr(plan.stories), milestones: arr(plan.milestones), features: arr(plan.features),
      architectures: arr(plan.architectures), edits: arr(plan.edits), deletes: arr(plan.deletes), moves: arr(plan.moves),
    };
    const present = (k: string) => (k === "brief" ? !!P.brief : k === "new_initiative" ? !!P.new_initiative : (P as any)[k].length > 0);
    const keys = ["new_initiative", "brief", "stories", "milestones", "features", "architectures", "edits", "deletes", "moves"];
    if (cfg.expected_action && ONLY[cfg.expected_action]) {
      const stray = keys.filter((k) => k !== ONLY[cfg.expected_action!] && present(k));
      if (stray.length) throw new Error(`canvas: the action was fixed to "${cfg.expected_action}" but the plan also has ${stray.join(", ")}. Nothing was written.`);
    }
    if (!keys.some(present)) throw new Error("canvas: the plan has nothing to write (expected any of: new_initiative, brief, stories, milestones, features, architectures, edits, deletes, moves). Nothing was written.");

    const newInit = !!P.new_initiative;
    if (!newInit && !c.initiative_ref) throw new Error("canvas: no initiative to write under — there is no `about` node and the plan does not create an initiative (new_initiative). Nothing was written.");
    let ph = 0;
    const newPh = () => `$${++ph}`;
    const cmds: any[] = [];
    const skipped: any[] = [];
    const model: any = newInit
      ? { ref: newPh(), name: String(P.new_initiative.name).trim(), briefs: [], stories: [], milestones: [], features: [] }
      : (() => {
          const i = c.initiative;
          const feat = (f: any) => ({ ref: f.ref_id, name: f.name, satisfies: [...(f.satisfies ?? [])], architecture: (f.architecture ?? []).map((a: any) => ({ ref: a.ref_id, name: a.name })) });
          return {
            ref: c.initiative_ref, name: i.node?.name,
            briefs: i.briefs.map((b: any) => ({ ref: b.ref_id, name: b.name, text: b.text, created_by_kind: b.created_by_kind })),
            stories: i.stories.map((s: any) => ({ ref: s.ref_id, text: s.text, requirements: s.requirements.map((r: any) => ({ ref: r.ref_id, text: r.text, status: r.status })) })),
            milestones: i.milestones.map((m: any) => ({ ref: m.ref_id, name: m.name, sequence: m.sequence, features: m.features.map(feat) })),
            features: i.features.map(feat),
          };
        })();
    const allFeatures = () => [...model.milestones.flatMap((m: any) => m.features), ...model.features];
    const allReqs = () => model.stories.flatMap((s: any) => s.requirements);
    const need = new Set<string>();
    const mk = (parent: string | null, edge: string | null, type: string, data: Record<string, any>) => { const p = newPh(); cmds.push({ k: "create", ph: p, parent, edge, type, data, label: data.name ?? data.text }); return p; };

    if (newInit) {
      need.add("initiative");
      const name = nonEmpty(P.new_initiative.name, "the initiative name");
      const dup = await dupInitiative(name, null);
      if (dup) throw new Error(`canvas: DUPLICATE_INITIATIVE: an initiative named "${dup.name}" already exists (ref ${dup.id}). Nothing was written. Do not rename it or add a number yourself: ask the person whether they mean that one, or what to call the new one.`);
      cmds.push({ k: "create", ph: model.ref, parent: null, edge: null, type: "Initiative", data: { name, status: "planned", ...stamp() }, label: name });
    }
    const initRef = model.ref;

    if (P.brief) {
      need.add("brief");
      const text = nonEmpty(P.brief.text, "the brief text");
      const title = String(P.brief.title ?? "").trim();
      const name = clip(title || text, 80);
      const ex = model.briefs.find((b: any) => b.created_by_kind !== "human");
      const human = model.briefs.find((b: any) => b.created_by_kind === "human");
      if (ex) {
        if (norm(ex.text) === norm(text)) skipped.push({ what: "brief", reason: "already says exactly this" });
        else cmds.push({ k: "patch", ref: ex.ref, type: "Brief", data: { text, ...(title ? { name: clip(title, 80) } : {}) }, label: ex.name });
      } else if (human && !cfg.allow_human) throw new Error(`canvas: the initiative's brief was written by a person ("${clip(String(human.text ?? human.name), 60)}"). I will not rewrite or duplicate it unless the person asks (allow_human). Nothing was written.`);
      else if (human) cmds.push({ k: "patch", ref: human.ref, type: "Brief", data: { text, ...(title ? { name: clip(title, 80) } : {}) }, label: human.name });
      else { const p = mk(initRef, "HAS_BRIEF", "Brief", { name, text, ...stamp() }); model.briefs.push({ ref: p, name, text, created_by_kind: by }); }
    }

    if (P.stories.length) {
      need.add("stories");
      for (const s of P.stories) {
        nonEmpty(s.text, "a story's text");
        const reqs = arr(s.requirements).map((r) => String(r ?? "").trim()).filter(Boolean);
        if (!reqs.length) throw new Error(`canvas: the story "${clip(String(s.text), 60)}" has no requirements. Every story needs at least one requirement; nothing was written.`);
      }
      for (const s of P.stories) {
        const text = String(s.text).trim();
        let story = model.stories.find((x: any) => norm(x.text) === norm(text));
        if (story) skipped.push({ what: `story "${clip(text, 60)}"`, reason: "already exists (kept; missing requirements are added)" });
        else {
          const p = mk(initRef, "HAS_STORY", "UserStory", { name: clip(text), text, status: "proposed", ...stamp() });
          story = { ref: p, text, requirements: [] }; model.stories.push(story);
        }
        for (const rt of arr(s.requirements).map((r) => String(r).trim()).filter(Boolean)) {
          if (story.requirements.some((r: any) => norm(r.text) === norm(rt))) { skipped.push({ what: `requirement "${clip(rt, 60)}"`, reason: "already exists" }); continue; }
          const rp = mk(story.ref, "HAS_REQUIREMENT", "Requirement", { name: clip(rt), text: rt, status: "proposed", ...stamp() });
          story.requirements.push({ ref: rp, text: rt, status: "proposed" });
        }
      }
    }

    if (P.milestones.length) {
      need.add("milestones");
      const names = P.milestones.map((m: any) => nonEmpty(typeof m === "string" ? m : m?.name, "a milestone name"));
      // 1-based: the first is 1, new ones go at the end (the whole set is renumbered 1..n below)
      let seq = model.milestones.length ? model.milestones.reduce((mx: number, m: any) => Math.max(mx, Number(m.sequence) || 0), 0) + 1 : 1;
      for (const name of names) {
        if (model.milestones.some((m: any) => norm(m.name) === norm(name))) { skipped.push({ what: `milestone "${name}"`, reason: "already exists" }); continue; }
        const p = mk(initRef, "HAS_MILESTONE", "Milestone", { name, sequence: seq, status: "planned", ...stamp() });
        model.milestones.push({ ref: p, name, sequence: seq, features: [] });
        seq += 1;
      }
    }

    // ---- MOVES: re-parent EXISTING nodes (they keep their ref_id and everything under them). Validated whole here; written (after milestones, before features) in the cmds loop.
    const movedDone: any[] = [];
    const msLists = new Map<string, any[]>();
    const touchedInits = new Set<string>();
    const movedSet = new Set<string>();
    const editSeq = new Map<string, number>(P.edits.filter((e: any) => String(e?.field ?? "").trim() === "sequence" && Number.isFinite(Number(e.value))).map((e: any): [string, number] => [String(e.ref_id), Number(e.value)]));
    const gget = async (ref: string): Promise<any> => { try { const r: any = await call(ctx, "graph/graph-get", { ref_id: ref }); return r && typeof r === "object" && r.ref_id ? r : null; } catch { return null; } };
    const isDel = (n: any) => !live(n?.properties);
    const nbr = async (ref: string, edge: string, dir: "forward" | "reverse"): Promise<any[]> => {
      const r: any = await call(ctx, "graph/graph-neighbors", { ref_id: ref, edge_type: [edge] });
      if (typeof r === "string") throw new Error(`canvas: could not read ${edge} of ${ref}: ${r}`);
      return (r as any[]).filter((x: any) => x.edge_type === edge && x.direction === dir);
    };
    const liveNbrs = async (ref: string, edge: string, dir: "forward" | "reverse"): Promise<any[]> => {
      const out: any[] = [];
      for (const x of await nbr(ref, edge, dir)) { const n = await gget(x.ref_id); if (n && !isDel(n)) out.push(n); }
      return out;
    };
    const kindOfN = (n: any) => n?.properties?.created_by_kind ?? null;
    const loadFeats = async (msRef: string): Promise<any[]> => {
      const out: any[] = [];
      for (const f of await liveNbrs(msRef, "HAS_FEATURE", "forward")) {
        out.push({ ref: f.ref_id, name: f.name, satisfies: (await nbr(f.ref_id, "SATISFIES", "forward")).map((x: any) => x.ref_id), architecture: (await liveNbrs(f.ref_id, "HAS_ARCHITECTURE", "forward")).map((a: any) => ({ ref: a.ref_id, name: a.name })) });
      }
      return out;
    };
    const listFor = async (X: string): Promise<any[]> => {
      if (X === model.ref) return model.milestones;
      const got = msLists.get(X); if (got) return got;
      let l: any[] = [];
      if (X === c.initiative_ref) {
        l = arr(c.initiative?.milestones).map((m: any) => ({ ref: m.ref_id, name: m.name, sequence: m.sequence, kind: m.created_by_kind ?? null, features: arr(m.features).map((f: any) => ({ ref: f.ref_id, name: f.name, satisfies: [...(f.satisfies ?? [])], architecture: arr(f.architecture).map((a: any) => ({ ref: a.ref_id, name: a.name })) })) }));
      } else {
        for (const n of await liveNbrs(X, "HAS_MILESTONE", "forward")) l.push({ ref: n.ref_id, name: n.name, sequence: Number(n.properties?.sequence) || 0, kind: kindOfN(n), features: [] });
      }
      msLists.set(X, l);
      return l;
    };
    const initOfMilestone = async (msRef: string): Promise<string | null> => (msRef.startsWith("$") ? model.ref : (await liveNbrs(msRef, "HAS_MILESTONE", "reverse"))[0]?.ref_id ?? null);
    const initOfNode = async (n: any): Promise<string | null> => {
      if (n.node_type === "Initiative") return n.ref_id;
      if (n.node_type === "Milestone") return initOfMilestone(n.ref_id);
      if (n.node_type === "Feature") {
        const p = (await liveNbrs(n.ref_id, "HAS_FEATURE", "reverse"))[0];
        return p ? (p.node_type === "Initiative" ? p.ref_id : initOfMilestone(p.ref_id)) : null;
      }
      return null;
    };
    const resolveInit = async (to: string) => {
      const s = String(to).trim();
      if (newInit && (s === "new_initiative" || s === "$new" || norm(s) === norm(model.name))) return { ref: model.ref as string, name: model.name as string };
      const n = await gget(s);
      if (!n || n.node_type !== "Initiative" || isDel(n)) throw new Error(`canvas: move target "${clip(s, 80)}" is not a live Initiative (pass its ref_id, or "new_initiative" for the one this plan creates). Nothing was written.`);
      return { ref: n.ref_id as string, name: String(n.name) };
    };
    for (const mv of P.moves) {
      const ref = nonEmpty(mv?.ref_id, "a move's ref_id");
      const to = nonEmpty(mv?.to, `the \`to\` of the move of ${ref}`);
      if (movedSet.has(ref)) throw new Error(`canvas: ${ref} is moved twice in this plan. Nothing was written.`);
      const n = await gget(ref);
      if (!n) throw new Error(`canvas: cannot move ${ref}: no such node. Nothing was written.`);
      if (isDel(n)) throw new Error(`canvas: cannot move "${clip(String(n.name), 60)}" (${ref}): it is soft-deleted (restore it first). Nothing was written.`);
      const t = n.node_type; const p = n.properties ?? {};
      const nm = String(n.name ?? ref);
      const human = p.created_by_kind === "human" || p.made_by === "user";
      const ours = p.created_by_kind === "strut" || p.created_by_kind === "jamie";
      if (!cfg.allow_human && (human || (!ours && t !== "Question"))) throw new Error(`canvas: "${clip(nm, 60)}" (${t}) was ${human ? "written by a person" : "not made by strut or jamie"}. I only move what strut/jamie made, unless the person asks for it (allow_human). Nothing was written.`);
      if (t === "Milestone") {
        const from = (await liveNbrs(ref, "HAS_MILESTONE", "reverse"))[0];
        if (!from) throw new Error(`canvas: milestone "${clip(nm, 60)}" is not under a live initiative. Nothing was written.`);
        const dest = await resolveInit(to);
        if (from.ref_id === dest.ref) { skipped.push({ what: `move of milestone "${clip(nm, 60)}"`, reason: "already under that initiative" }); continue; }
        const src = await listFor(from.ref_id); const dst = await listFor(dest.ref);
        const i = src.findIndex((m: any) => m.ref === ref);
        const entry: any = i >= 0 ? src.splice(i, 1)[0] : { ref, name: nm, sequence: Number(p.sequence) || 0, kind: kindOfN(n), features: [] };
        entry.kind = entry.kind ?? kindOfN(n);
        if (dst === model.milestones && !entry.features?.length) entry.features = await loadFeats(ref);
        entry.ord = Math.max(0, ...dst.map((m: any) => Number(m.ord ?? m.sequence) || 0)) + 1;
        dst.push(entry);
        cmds.push({ k: "move", ref, type: t, edge: "HAS_MILESTONE", reverse: false, from: from.ref_id, fromName: String(from.name), to: dest.ref, toName: dest.name, patch: null, undo: null, label: nm });
        touchedInits.add(from.ref_id); touchedInits.add(dest.ref);
      } else if (t === "Feature") {
        const from = (await liveNbrs(ref, "HAS_FEATURE", "reverse"))[0];
        if (!from) throw new Error(`canvas: feature "${clip(nm, 60)}" is not under a live milestone. Nothing was written.`);
        const s = String(to).trim();
        let tgt: { ref: string; name: string } | null = null;
        const g = await gget(s);
        if (g && g.node_type === "Milestone" && !isDel(g)) tgt = { ref: g.ref_id, name: String(g.name) };
        else {
          const hits = model.milestones.filter((m: any) => m.ref === s || norm(m.name) === norm(s));
          if (hits.length > 1) throw new Error(`canvas: move target milestone "${clip(s, 60)}" is ambiguous in this plan; pass its ref_id. Nothing was written.`);
          if (hits.length === 1) tgt = { ref: hits[0].ref, name: hits[0].name };
        }
        if (!tgt) throw new Error(`canvas: move target "${clip(s, 80)}" is not a live Milestone (pass its ref_id, or the name of a milestone this plan creates). Nothing was written.`);
        if (from.ref_id === tgt.ref) { skipped.push({ what: `move of feature "${clip(nm, 60)}"`, reason: "already under that milestone" }); continue; }
        let fe: any = null;
        const all: any[][] = [model.milestones, ...msLists.values()];
        for (const l of all) for (const m of l) { const j = arr(m.features).findIndex((f: any) => f.ref === ref); if (j >= 0) fe = m.features.splice(j, 1)[0]; }
        const lj = model.features.findIndex((f: any) => f.ref === ref); if (lj >= 0) fe = model.features.splice(lj, 1)[0];
        fe = fe ?? { ref, name: nm, satisfies: [], architecture: [] };
        for (const l of all) for (const m of l) if (m.ref === tgt.ref) { m.features = arr(m.features); m.features.push(fe); }
        cmds.push({ k: "move", ref, type: t, edge: "HAS_FEATURE", reverse: false, from: from.ref_id, fromName: String(from.name), to: tgt.ref, toName: tgt.name, patch: null, undo: null, label: nm });
      } else if (t === "UserStory") {
        const from = (await liveNbrs(ref, "HAS_STORY", "reverse"))[0];
        if (!from) throw new Error(`canvas: story "${clip(nm, 60)}" is not under a live initiative. Nothing was written.`);
        const dest = await resolveInit(to);
        if (from.ref_id === dest.ref) { skipped.push({ what: `move of story "${clip(nm, 60)}"`, reason: "already under that initiative" }); continue; }
        let entry: any = null;
        if (from.ref_id === model.ref) { const j = model.stories.findIndex((s: any) => s.ref === ref); if (j >= 0) entry = model.stories.splice(j, 1)[0]; }
        if (dest.ref === model.ref) {
          if (!entry) entry = { ref, text: p.text ?? nm, requirements: (await liveNbrs(ref, "HAS_REQUIREMENT", "forward")).map((r: any) => ({ ref: r.ref_id, text: r.properties?.text, status: r.properties?.status })) };
          model.stories.push(entry);
        }
        cmds.push({ k: "move", ref, type: t, edge: "HAS_STORY", reverse: false, from: from.ref_id, fromName: String(from.name), to: dest.ref, toName: dest.name, patch: null, undo: null, label: nm });
      } else if (t === "Question") {
        if ((await nbr(ref, "PARENT_OF", "reverse")).length) throw new Error(`canvas: "${clip(nm, 60)}" is not a brainstorm ROOT question (it hangs under another card); only a root can be re-parented. Nothing was written.`);
        const olds = await liveNbrs(ref, "ABOUT", "forward");
        if (!olds.length) throw new Error(`canvas: the brainstorm "${clip(nm, 60)}" has no ABOUT edge, so there is nothing to swap; refusing to guess what it hangs on. Nothing was written.`);
        if (olds.length > 1) throw new Error(`canvas: the brainstorm "${clip(nm, 60)}" is ABOUT several nodes; refusing to move it. Nothing was written.`);
        const old = olds[0];
        const s = String(to).trim();
        let tgt: { ref: string; name: string; node: any } | null = null;
        if (newInit && (s === "new_initiative" || s === "$new" || norm(s) === norm(model.name))) tgt = { ref: model.ref, name: model.name, node: { node_type: "Initiative", ref_id: model.ref } };
        else { const g = await gget(s); if (g && ["Initiative", "Milestone", "Feature"].includes(g.node_type) && !isDel(g)) tgt = { ref: g.ref_id, name: String(g.name), node: g }; }
        if (!tgt) throw new Error(`canvas: a brainstorm can only be moved to a live initiative, milestone or feature (got "${clip(s, 80)}"). Nothing was written.`);
        if (old.ref_id === tgt.ref) { skipped.push({ what: `move of brainstorm "${clip(nm, 60)}"`, reason: "already about that node" }); continue; }
        cmds.push({ k: "move", ref, type: t, edge: "ABOUT", reverse: true, from: old.ref_id, fromName: String(old.name), to: tgt.ref, toName: tgt.name, patch: null, undo: null, label: nm });
      } else throw new Error(`canvas: a ${t} cannot be moved (movable: Milestone, Feature, UserStory, brainstorm root Question). Nothing was written.`);
      movedSet.add(ref);
    }
    for (const r0 of [...movedSet]) { const stack = [r0]; while (stack.length) { const x = stack.pop()!; for (const ch of arr(c.index?.[x]?.children)) if (!movedSet.has(ch)) { movedSet.add(ch); stack.push(ch); } } }
    const moveEdge = (cmd: any, parent: string) => (cmd.reverse ? { source_ref_id: cmd.ref, edge_type: cmd.edge, target_ref_id: parent } : { source_ref_id: parent, edge_type: cmd.edge, target_ref_id: cmd.ref });

    const resolveReq = (spec: string, fname: string) => {
      const s = String(spec ?? "").trim();
      const reqs = allReqs();
      let r = reqs.find((x: any) => x.ref === s) ?? reqs.find((x: any) => norm(x.text) === norm(s));
      if (!r) { const hits = reqs.filter((x: any) => norm(x.text).includes(norm(s)) || norm(s).includes(norm(x.text))); if (hits.length === 1 && s) r = hits[0]; }
      if (!r) throw new Error(`canvas: feature "${fname}" satisfies "${clip(s, 80)}", which matches no requirement of this initiative (known: ${reqs.map((x: any) => `"${clip(String(x.text), 40)}"`).join(", ") || "none"}). Nothing was written.`);
      if (r.status === "dropped") throw new Error(`canvas: feature "${fname}" satisfies the dropped requirement "${clip(String(r.text), 60)}". Nothing was written.`);
      return r.ref as string;
    };
    if (P.features.length) {
      need.add("features");
      for (const f of P.features) {
        const name = nonEmpty(f.name, "a feature name");
        const spec = String(f.milestone ?? "").trim();
        let ms = spec ? model.milestones.find((m: any) => m.ref === spec || norm(m.name) === norm(spec)) : null;
        if (!ms && !spec) ms = model.milestones.find((m: any) => m.ref === c.milestone_ref) ?? (model.milestones.length === 1 ? model.milestones[0] : null);
        if (!ms) throw new Error(`canvas: feature "${name}" has no milestone: ${spec ? `"${spec}" is not one of` : "say which one of"} ${model.milestones.map((m: any) => `"${m.name}"`).join(", ") || "(none yet — add milestones first)"}. Nothing was written.`);
        f._ms = ms;
        f._sat = [...new Set<string>(arr(f.satisfies).map((s: any) => resolveReq(s, name)))];
        if (f._sat.length) need.add("satisfies");
      }
      for (const f of P.features) {
        const ms = f._ms; const name = String(f.name).trim();
        let ex = ms.features.find((x: any) => norm(x.name) === norm(name));
        let fref: string;
        if (!ex) { fref = mk(ms.ref, "HAS_FEATURE", "Feature", { name, status: "planned", ...stamp() }); ex = { ref: fref, name, satisfies: [], architecture: [] }; ms.features.push(ex); }
        else { fref = ex.ref; }
        let added = 0;
        for (const rr of f._sat) if (!ex.satisfies.includes(rr)) { cmds.push({ k: "link", from: fref, edge: "SATISFIES", to: rr, label: name }); ex.satisfies.push(rr); added++; }
        if (!added && !fref.startsWith("$")) skipped.push({ what: `feature "${name}"`, reason: "already exists with these requirements" });
        if (!ex.satisfies.length) skipped.push({ what: `feature "${name}"`, reason: "satisfies no requirement yet (say which it meets)" });
      }
    }

    if (P.architectures.length) {
      need.add("architecture");
      for (const a of P.architectures) {
        const name = clip(nonEmpty(a.name || a.summary, "the architecture's one-line summary").split("\n")[0], 200);
        const longer = String(a.summary ?? "").trim();
        const description = longer && norm(longer) !== norm(name) ? longer : "";
        const diagram = String(a.diagram ?? "").trim();
        const spec = String(a.feature ?? "").trim();
        const feats = allFeatures();
        const f = spec ? feats.find((x: any) => x.ref === spec || norm(x.name) === norm(spec)) : feats.find((x: any) => x.ref === c.feature_ref);
        if (!f) throw new Error(`canvas: architecture "${name}" has no feature: ${spec ? `"${spec}" is not one of` : "say which one of"} ${feats.map((x: any) => `"${x.name}"`).join(", ") || "(none yet)"}. Nothing was written.`);
        if (f.architecture[0]) cmds.push({ k: "patch", ref: f.architecture[0].ref, type: "Architecture", data: { name, ...(description ? { description } : {}), ...(diagram ? { diagram } : {}) }, label: name });
        else { const p = mk(f.ref, "HAS_ARCHITECTURE", "Architecture", { name, ...(description ? { description } : {}), ...(diagram ? { diagram } : {}) }); f.architecture.push({ ref: p, name }); }
      }
    }

    // a node of this initiative's canvas: its subtree (c.index) or the initiative itself (status / blocked only)
    const nodeOf = (ref: string): any => (ref === c.initiative_ref ? { type: "Initiative", name: c.initiative?.node?.name ?? model.name, created_by_kind: c.initiative?.node?.created_by_kind ?? null, made_by: c.initiative?.node?.made_by ?? null } : c.index?.[ref]);
    const mine = (ref: string, anyAuthor = false) => {
      const n = nodeOf(ref);
      if (!n) throw new Error(`canvas: ${ref} is not part of this initiative's canvas subtree (initiative, brief, stories, requirements, milestones, features, architecture). I only edit those. Nothing was written.`);
      const human = n.created_by_kind === "human" || n.made_by === "user";
      const ours = n.created_by_kind === "strut" || n.created_by_kind === "jamie";
      const unstamped = n.type === "Architecture";
      if (!anyAuthor && (human || (!ours && !unstamped)) && !cfg.allow_human) throw new Error(`canvas: "${clip(String(n.name), 60)}" (${n.type}) was ${human ? "written by a person" : "not made by strut or jamie"}. I only edit or delete what strut/jamie made, unless the person asks for it (allow_human). Nothing was written.`);
      return n;
    };
    if (P.edits.length) {
      const byRef: Record<string, Record<string, any>> = {};
      for (const e of P.edits) {
        const ref = nonEmpty(e.ref_id, "an edit's ref_id");
        const k0 = String(e.field ?? "").trim();
        const isFlag = FLAGS.includes(k0.toLowerCase());
        const n = mine(ref, isFlag); // status / blocked are workflow state, so they may be set on a person's node too
        const allowed = EDITABLE[n.type];
        if (!allowed) throw new Error(`canvas: ${n.type} cannot be edited here. Nothing was written.`);
        if (STAMP_KEY.test(k0)) throw new Error(`canvas: "${k0}" is a stamp field; created_at, updated_at, created_by and created_by_kind are set by code/system only. Nothing was written.`);
        const k = n.type === "Architecture" ? (FIELD_ALIAS[k0] ?? k0) : n.type === "Brief" && k0 === "title" ? "name" : isFlag ? k0.toLowerCase() : k0;
        if (!allowed.includes(k)) throw new Error(`canvas: field "${k0}" cannot be edited on ${n.type} (allowed: ${allowed.join(", ")}). Requirement status is a person's act (accept/drop). Nothing was written.`);
        if (k === "sequence" && !Number.isFinite(Number(e.value))) throw new Error(`canvas: sequence must be a number, got "${e.value}". Nothing was written.`);
        (byRef[ref] ??= {})[k] = k === "status" ? normStatus(n.type, e.value) : k === "blocked" ? normBool(e.value) : k === "blocked_reason" ? String(e.value ?? "").trim() : k === "sequence" ? Number(e.value) : (k === "diagram" || k === "description" ? String(e.value ?? "") : nonEmpty(e.value, `field ${k}`));
      }
      for (const [ref, fields] of Object.entries(byRef)) {
        const n = nodeOf(ref);
        if (n.type === "Initiative" && fields.name !== undefined) {
          const dup = (await dupInitiative(String(fields.name), ref)) ?? (newInit && norm(P.new_initiative.name) === norm(fields.name) ? { id: "(this plan)", name: P.new_initiative.name } : null);
          if (dup) throw new Error(`canvas: DUPLICATE_INITIATIVE: an initiative named "${dup.name}" already exists (ref ${dup.id}; canvas link ?canvas=${dup.id}&node=${dup.id}). Nothing was written. Do not rename it or add a number yourself: ask the person which name to use.`);
        }
        if (fields.blocked === false && fields.blocked_reason === undefined) fields.blocked_reason = ""; // unblocking clears the reason
        if (fields.blocked_reason && fields.blocked === undefined) throw new Error(`canvas: a blocked_reason needs blocked: true in the same edit. Nothing was written.`);
        if (fields.blocked === false && fields.blocked_reason) throw new Error(`canvas: an unblocked node has no blocked_reason. Nothing was written.`);
        if ((n.type === "UserStory" || n.type === "Requirement") && fields.text !== undefined && fields.name === undefined) fields.name = clip(String(fields.text));
        cmds.push({ k: "patch", ref, type: n.type, data: { ...fields }, label: String(fields.name ?? n.name) });
      }
    }
    if (P.deletes.length) {
      // Removals: any canvas card of THIS initiative (the initiative itself, plan nodes, brainstorm questions/options/effects).
      // The dry run runs the work_started guard, lists the whole subtree and flags a person's nodes (protected).
      const seen = new Set<string>();
      for (const d of P.deletes) {
        const ref = nonEmpty(typeof d === "string" ? d : d?.ref_id, "a delete's ref_id");
        if (seen.has(ref)) continue;
        const r: any = await removeCard(ctx, ref, { dryRun: true, skipGuard: true, who: "canvas" });
        if (!r.initiative_ref || r.initiative_ref !== c.initiative_ref) throw new Error(`canvas: ${r.node_type} "${clip(String(r.name), 60)}" (${ref}) is not part of this initiative's canvas (initiative, brief, stories, requirements, milestones, features, architecture, brainstorm questions and options). I only delete those. Nothing was written.`);
        r.removed = r.removed.filter((x: any) => !movedSet.has(x.ref_id)); // what this plan moves out first is not removed with its old parent
        const prot = r.removed.filter((x: any) => x.human);
        if (prot.length && !cfg.allow_human) {
          const p0 = prot[0];
          throw new Error(`canvas: "${clip(String(p0.name), 60)}" (${p0.node_type}) ${p0.ref_id === ref ? "" : `under "${clip(String(r.name), 40)}" `}was ${p0.human ? "written by a person" : "not made by strut or jamie"}, and deleting ${r.node_type} "${clip(String(r.name), 40)}" would remove it. I only delete what strut/jamie made, unless the person asks for it (allow_human). Nothing was written.`);
        }
        r.removed.forEach((x: any) => seen.add(x.ref_id));
        cmds.push({ k: "delete", ref, type: r.node_type, label: r.name, covered: r.removed.map((x: any) => x.ref_id), count: r.removed.length });
      }
    }

    // MILESTONE SEQUENCE: 1..n, no gaps. When milestones were added or deleted, number the whole set again in its order.
    // A milestone that is not strut/jamie's (a person's) is never renumbered: then nothing is, and a note says so.
    const delAll = new Set<string>(cmds.filter((x) => x.k === "delete").flatMap((x) => x.covered ?? [x.ref]));
    {
      const delRefs = delAll;
      const msDeleted = model.milestones.some((m: any) => delRefs.has(m.ref));
      if (false && (P.milestones.length || msDeleted)) { // superseded by the per-initiative renumber below
        const ordered = model.milestones.filter((m: any) => !delRefs.has(m.ref)).map((m: any, i: number) => ({ m, i }))
          .sort((a: any, b: any) => ((Number(a.m.sequence) || 0) - (Number(b.m.sequence) || 0)) || a.i - b.i).map((x: any) => x.m);
        const changes: { m: any; want: number }[] = [];
        ordered.forEach((m: any, i: number) => { if (Number(m.sequence) !== i + 1) changes.push({ m, want: i + 1 }); });
        const blocked = changes.filter((x) => !x.m.ref.startsWith("$")).filter((x) => {
          const n = c.index?.[x.m.ref];
          const ours = n && (n.created_by_kind === "strut" || n.created_by_kind === "jamie");
          return !ours && !cfg.allow_human;
        });
        if (blocked.length) notes.push(`Milestone sequence not renumbered 1..n: ${blocked.map((x) => `"${x.m.name}"`).join(", ")} ${blocked.length > 1 ? "were" : "was"} not made by strut/jamie (allow_human is off), so the set was left as it is.`);
        else for (const { m, want } of changes) {
          if (m.ref.startsWith("$")) { const cmd = cmds.find((x) => x.k === "create" && x.ph === m.ref); if (cmd) cmd.data.sequence = want; }
          else cmds.push({ k: "patch", ref: m.ref, type: "Milestone", data: { sequence: want }, label: m.name });
          m.sequence = want;
        }
      }
    }

    // SEQUENCE 1..n in EVERY initiative this plan touched (new milestones, deletes, milestones moved out or in); order is preserved, moved-in ones go last unless an edit sets sequence.
    {
      const lists = new Map<string, any[]>([[model.ref, model.milestones]]);
      for (const [k, l] of msLists) lists.set(k, l);
      if (newInit && c.initiative_ref && !lists.has(c.initiative_ref)) lists.set(c.initiative_ref, await listFor(c.initiative_ref));
      const key = (m: any) => editSeq.get(m.ref) ?? Number(m.ord ?? m.sequence) ?? 0;
      for (const [X, list] of lists) {
        const affected = (X === model.ref && P.milestones.length > 0) || touchedInits.has(X) || list.some((m: any) => delAll.has(m.ref));
        if (!affected) continue;
        const ordered = list.filter((m: any) => !delAll.has(m.ref)).map((m: any, i: number) => ({ m, i }))
          .sort((a: any, b: any) => ((key(a.m) || 0) - (key(b.m) || 0)) || a.i - b.i).map((x: any) => x.m);
        const changes: { m: any; want: number }[] = [];
        ordered.forEach((m: any, i: number) => { if (Number(m.sequence) !== i + 1 || editSeq.has(m.ref)) changes.push({ m, want: i + 1 }); });
        const blocked = changes.filter((x: any) => !String(x.m.ref).startsWith("$")).filter((x: any) => {
          const k = x.m.kind ?? c.index?.[x.m.ref]?.created_by_kind;
          return !(k === "strut" || k === "jamie") && !cfg.allow_human;
        });
        if (blocked.length) notes.push(`Milestone sequence not renumbered 1..n: ${blocked.map((x: any) => `"${x.m.name}"`).join(", ")} ${blocked.length > 1 ? "were" : "was"} not made by strut/jamie (allow_human is off), so the set was left as it is.`);
        else for (const { m, want } of changes) {
          if (String(m.ref).startsWith("$")) { const cmd = cmds.find((x: any) => x.k === "create" && x.ph === m.ref); if (cmd) cmd.data.sequence = want; }
          else cmds.push({ k: "patch", ref: m.ref, type: "Milestone", data: { sequence: want }, label: m.name });
          m.sequence = want; delete m.ord;
        }
      }
    }

    // touches need updated_at, which is system-owned and not sent by default
    const typeOfRef = (r: string) => (r === c.initiative_ref ? "Initiative" : c.index?.[r]?.type ?? null);
    const touch = new Map<string, string>();
    if (sendUpdated) {
      const patched = new Set(cmds.filter((x) => x.k === "patch").map((x) => x.ref));
      const deleting = delAll;
      const consider = (r: string | null | undefined) => {
        if (!r || r.startsWith("$") || patched.has(r) || deleting.has(r)) return;
        const t = typeOfRef(r);
        if (t && STAMPED_TYPES.has(t)) touch.set(r, t);
      };
      for (const x of cmds) { if (x.k === "create") consider(x.parent); else if (x.k === "link") consider(x.from); }
      if (!newInit && cmds.length) consider(c.initiative_ref);
    }
    const touches = [...touch.entries()].map(([ref, type]) => ({ k: "touch", ref, type }));

    const written: any[] = [];
    const touched: any[] = [];
    const artifacts: any[] = [];
    const dropped: string[] = [];
    const refs: Record<string, string> = {};
    const created: string[] = [];
    const stampLog: any[] = [];
    const R = (x: string | null) => (x && x.startsWith("$") ? refs[x] : x);
    let firstStamp: string | null = null;
    const addArtifact = (ref: string, type: string, name: string, op: string) => {
      written.push({ ref_id: ref, node_type: type, name, op });
      artifacts.push({ id: `canvas-${type}-${ref}`, kind: "graph", title: `${type}: ${clip(String(name), 80)}`, content: { focus: ref, layout: "tree", node_type: type, op } });
    };
    const gapError = (type: string, attr: string) => new Error(`canvas: the graph refused ${type}.${attr}: "attribute is not declared on the schema". The write path of this strut does not accept ${type}.${attr}. Nothing was dropped silently. Fix the ontology/write schema, then re-run.`);
    const finalCreate = (type: string, data: Record<string, any>) => {
      const d = { ...data };
      for (const k of ["created_at", "updated_at", "created_by", "author", "created_by_kind"]) delete d[k];
      if (STAMPED_TYPES.has(type)) {
        const t = now(); firstStamp ??= t;
        d.author = by; d.created_by_kind = by;
        if (sendUpdated) d.updated_at = t;
      }
      stampLog.push({ op: "create", type, name: d.name, sent: Object.fromEntries(["created_at", "updated_at", "created_by", "created_by_kind"].filter((k) => k in d).map((k) => [k, d[k]])) });
      return d;
    };
    const finalUpdate = (ref: string, type: string, data: Record<string, any>, op: string) => {
      const d = { ...data };
      for (const k of IMMUTABLE_ON_UPDATE) delete d[k];
      delete d.updated_at;
      if (sendUpdated && STAMPED_TYPES.has(type)) { const t = now(); firstStamp ??= t; d.updated_at = t; }
      stampLog.push({ op, ref, type, sent: Object.fromEntries(["created_at", "updated_at", "created_by", "created_by_kind"].filter((k) => k in d).map((k) => [k, d[k]])) });
      return d;
    };
    const writeNode = async (parent: string | null, edge: string | null, type: string, data: Record<string, any>) => {
      const d = finalCreate(type, data);
      for (let i = 0; i < 12; i++) {
        const r = parent
          ? await call(ctx, "graph/create-triplet", { source_ref_id: parent, edge_type: edge, target_type: type, target_data: d })
          : await call(ctx, "graph/create-node", { node_type: type, node_data: d });
        const ref = r && typeof r === "object" ? (r.target_ref_id ?? r.ref_id) : null;
        if (ref && (!parent || r.edge_ref_id) && r.status === "Success") return ref as string;
        const msg = String(r && typeof r === "object" ? JSON.stringify(r) : r);
        const m = msg.match(/(\w+)\.(\w+): attribute is not declared/);
        if (m) {
          if (tol.has(m[2]) && m[2] in d) { delete d[m[2]]; dropped.push(`${type}.${m[2]}`); continue; }
          throw gapError(m[1], m[2]);
        }
        const t = msg.match(/target=([0-9a-f-]{36})\)/);
        if (/edge write failed/.test(msg) && t) {
          await call(ctx, "graph/delete-node", { ref_id: t[1] });
          throw new Error(`canvas: the graph has no edge schema for ${edge} here (${msg.split("—").pop()?.trim()}). The ${type} was removed again. The ontology on this swarm is missing this edge.`);
        }
        throw new Error(`canvas: writing ${type} failed: ${msg}`);
      }
      throw new Error(`canvas: writing ${type} kept failing on undeclared attributes`);
    };
    const patchNode = async (ref: string, type: string, data: Record<string, any>, op: string): Promise<boolean> => {
      const d = finalUpdate(ref, type, data, op);
      for (let i = 0; i < 12; i++) {
        if (!Object.keys(d).length) return false;
        const r = await call(ctx, "graph/edit-node", { ref_id: ref, node_data: d });
        if (r && typeof r === "object" && r.status === "Success") return true;
        const msg = String(r);
        const m = msg.match(/(\w+)\.(\w+): attribute is not declared/);
        if (m) {
          if (tol.has(m[2]) && m[2] in d) { delete d[m[2]]; dropped.push(`${type}.${m[2]}`); continue; }
          throw gapError(m[1], m[2]);
        }
        throw new Error(`canvas: updating ${type} ${ref} failed: ${msg}`);
      }
      return false;
    };
    try {
      for (const cmd of [...cmds, ...touches]) {
        if (cmd.k === "create") {
          const ref = await writeNode(R(cmd.parent), cmd.edge, cmd.type, cmd.data);
          refs[cmd.ph] = ref; created.push(ref);
          addArtifact(ref, cmd.type, cmd.label, "created");
        } else if (cmd.k === "link") {
          const r = await call(ctx, "graph/create-triplet", { source_ref_id: R(cmd.from), edge_type: cmd.edge, target_ref_id: R(cmd.to) });
          if (!(r && typeof r === "object" && r.edge_ref_id)) throw new Error(`canvas: could not link ${cmd.label} -[${cmd.edge}]-> ${cmd.to}: ${String(r)}`);
        } else if (cmd.k === "patch") {
          await patchNode(cmd.ref, cmd.type, cmd.data, "update");
          if (cmd.data.blocked !== undefined || cmd.data.status !== undefined) {
            // read back: a status or blocked write that did not stick is an error, not a success
            const back: any = await call(ctx, "graph/graph-get", { ref_id: cmd.ref });
            if (cmd.data.blocked !== undefined && Boolean(back?.properties?.blocked) !== cmd.data.blocked) throw new Error(`canvas: read-back of ${cmd.type} ${cmd.ref} shows blocked=${back?.properties?.blocked}, expected ${cmd.data.blocked}.`);
            if (cmd.data.status !== undefined && back?.properties?.status !== cmd.data.status) throw new Error(`canvas: read-back of ${cmd.type} ${cmd.ref} shows status=${back?.properties?.status}, expected ${cmd.data.status}.`);
          }
          addArtifact(cmd.ref, cmd.type, cmd.label, "updated");
        } else if (cmd.k === "move") {
          const dest = R(cmd.to) as string;
          const d: any = await call(ctx, "graph/delete-edge", moveEdge(cmd, cmd.from));
          if (typeof d === "string") throw new Error(`canvas: could not detach ${cmd.type} "${cmd.label}" from "${cmd.fromName}": ${d}`);
          const r: any = await call(ctx, "graph/create-triplet", moveEdge(cmd, dest)).catch((e: any) => String(e?.message ?? e));
          if (!(r && typeof r === "object" && r.edge_ref_id)) {
            await call(ctx, "graph/create-triplet", moveEdge(cmd, cmd.from)).catch(() => null);
            throw new Error(`canvas: could not attach ${cmd.type} "${cmd.label}" under "${cmd.toName}" (${String(typeof r === "string" ? r : JSON.stringify(r))}); the old edge was restored.`);
          }
          movedDone.push({ cmd, dest });
          if (cmd.patch) await patchNode(cmd.ref, cmd.type, cmd.patch, "move");
          addArtifact(cmd.ref, cmd.type, cmd.label, "moved");
          const w = written[written.length - 1]; w.from = { ref_id: cmd.from, name: cmd.fromName }; w.to = { ref_id: dest, name: cmd.toName };
        } else if (cmd.k === "touch") {
          if (await patchNode(cmd.ref, cmd.type, {}, "touch")) touched.push({ ref_id: cmd.ref, node_type: cmd.type });
        } else if (cmd.k === "delete") {
          const r: any = await removeCard(ctx, cmd.ref, { reason: "removed by the planning job (restorable)", skipGuard: true, who: "canvas" });
          written.push({ ref_id: cmd.ref, node_type: cmd.type, name: cmd.label, op: "deleted", soft: true, removed: r.removed.length });
          artifacts.push({ id: `canvas-${cmd.type}-${cmd.ref}`, kind: "graph", title: `Deleted ${cmd.type}: ${clip(String(cmd.label), 80)}${r.removed.length > 1 ? ` (+${r.removed.length - 1} under it)` : ""}`, content: { focus: cmd.type === "Initiative" ? null : (c.anchor ?? R(initRef)), layout: "tree", op: "deleted" } });
        }
      }
    } catch (e: any) {
      const nMoved = movedDone.length;
      for (const m of movedDone.reverse()) { try { await call(ctx, "graph/delete-edge", moveEdge(m.cmd, m.dest)); await call(ctx, "graph/create-triplet", moveEdge(m.cmd, m.cmd.from)); if (m.cmd.undo) await call(ctx, "graph/edit-node", { ref_id: m.cmd.ref, node_data: m.cmd.undo }); } catch { /* best effort */ } }
      let undone = 0;
      for (const ref of created.reverse()) { try { await call(ctx, "graph/delete-node", { ref_id: ref }); undone++; } catch { /* best effort */ } }
      throw new Error(`${e.message}${created.length ? ` Rolled back ${undone} of ${created.length} node(s) created by this run.` : ""}${written.some((w) => w.op !== "created") || touched.length ? " Edits/deletes/touches already applied in this run were not undone (deletes are soft: restore them with canvas-ops op restore)." : ""}`);
    }

    const finalInit = R(initRef);
    const bt: Record<string, number> = {};
    for (const w of written) bt[`${w.op} ${w.node_type}`] = (bt[`${w.op} ${w.node_type}`] ?? 0) + 1;
    const gone = delAll;
    model.milestones = model.milestones.filter((m: any) => !gone.has(m.ref));
    model.milestones.forEach((m: any) => { m.features = m.features.filter((f: any) => !gone.has(f.ref)); });
    const renamed = new Map(cmds.filter((x) => x.k === "patch" && x.data.name).map((x) => [x.ref, x.data.name]));
    model.milestones.forEach((m: any) => { if (renamed.has(m.ref)) m.name = renamed.get(m.ref); m.features.forEach((f: any) => { if (renamed.has(f.ref)) f.name = renamed.get(f.ref); }); });
    let next = "";
    const noBrief = !model.briefs.length;
    const noStories = !model.stories.length;
    const emptyMs = model.milestones.find((m: any) => !m.features.length);
    const noArch = allFeatures().find((f: any) => !f.architecture.length);
    if (written.some((w) => w.op === "deleted" && w.node_type === "Initiative")) next = "The initiative was removed from the canvas (soft delete; restorable).";
    else if (noBrief) next = "Next: write the brief (why this initiative exists).";
    else if (noStories) next = "Next: user stories and their requirements.";
    else if (!model.milestones.length) next = "Next: milestones (or brainstorm how to stage it).";
    else if (emptyMs) next = `Next: features for milestone "${emptyMs.name}" (or brainstorm how to meet the requirements).`;
    else if (noArch) next = `Next: the architecture of feature "${noArch.name}" (follow a decided brainstorm if there is one).`;
    else next = "Next: implement a feature with code jobs that return pull requests.";
    const summary = Object.entries(bt).map(([k, v]) => `${v} ${k}`).join(", ");
    const lines = written.map((w) => `- ${w.op}${w.soft ? " (soft)" : ""} ${w.node_type}: ${w.name}${w.from ? ` (${w.from.name} → ${w.to.name})` : ""}${w.removed > 1 ? ` (+${w.removed - 1} under it)` : ""}`);
    const statusLines = cmds.filter((x) => x.k === "patch" && (x.data.status !== undefined || x.data.blocked !== undefined)).map((x) => [
      x.data.status !== undefined ? `- status of ${x.type} "${clip(String(x.label), 60)}" is now ${x.data.status}` : "",
      x.data.blocked !== undefined ? `- ${x.type} "${clip(String(x.label), 60)}" is ${x.data.blocked ? `now blocked${x.data.blocked_reason ? `: ${x.data.blocked_reason}` : ""}` : "no longer blocked"}` : "",
    ].filter(Boolean).join("\n"));
    const sk = skipped.map((s) => `- skipped ${s.what}: ${s.reason}`);
    const text = [
      `canvas: ${summary || "nothing written"}.`, ...lines, ...statusLines, ...sk,
      touched.length ? `- touched (updated_at refreshed): ${touched.length} existing node(s)` : "",
      ...notes.filter((n) => /^Milestone sequence/.test(n)).map((n) => `NOTE ${n}`),
      ignoredStamps.length ? `WARNING ignored caller-provided stamp fields (code sets them): ${ignoredStamps.join(", ")}` : "",
      dropped.length ? `WARNING dropped attributes (override): ${[...new Set(dropped)].join(", ")}` : "",
      next,
    ].filter(Boolean).join("\n");
    return {
      action: "write", initiative_ref: finalInit, written, touched, skipped, dropped_attrs: dropped,
      ignored_stamp_fields: ignoredStamps, notes,
      stamped: { by_kind: by, created_at: "ISO-8601 UTC ms from the step clock at write time", updated_at: sendUpdated ? "sent (send_updated_at: true)" : "not sent (system-owned)", first_stamp: firstStamp },
      stamp_log: stampLog, artifacts, text, summary, next,
    };
  },
});
