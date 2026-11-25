import { z, defineStep } from "strut";
import {
  ARCHITECTURE,
  BRIEF,
  FEATURE,
  HAS_ARCHITECTURE,
  HAS_BRIEF,
  HAS_FEATURE,
  HAS_MILESTONE,
  HAS_REQUIREMENT,
  HAS_STORY,
  INITIATIVE,
  MILESTONE,
  OPTION,
  PLAN_TYPES,
  QUESTION,
  REQUIREMENT,
  STORY,
  actorOf,
  call,
  clip,
  getNode,
  getNodes,
  isTrue,
  linked,
  live,
  normStatus,
  initiativeNamed,
  normBuildsIn,
  reposOf,
} from "./_canvas.js";
import { addByPerson, choose, unchoose } from "./_brainstorm.js";
import { removeCard, restoreCard } from "./_remove.js";

const WHO = "stadeum/canvas/op";

const EDITABLE: Record<string, string[]> = {
  [INITIATIVE]: ["name", "status", "description", "target_date"],
  [BRIEF]: ["text", "name"],
  [STORY]: ["text", "name"],
  [REQUIREMENT]: ["text", "name"],
  [MILESTONE]: ["name", "sequence", "status", "description", "due_date"],
  [FEATURE]: ["name", "status", "description"],
  [ARCHITECTURE]: ["name", "description", "diagram", "builds_in", "repos"],
  [QUESTION]: ["text", "name"],
  [OPTION]: ["text", "name"],
};
/** Fields a person may empty; the rest need a value. */
const CLEARABLE = new Set(["diagram", "description", "target_date", "due_date", "repos"]);
const TEXT_NAMED = new Set([STORY, REQUIREMENT, QUESTION, OPTION]);
const ADD: Record<string, { edge: string; type: string; parent: string }> = {
  brief: { edge: HAS_BRIEF, type: BRIEF, parent: INITIATIVE },
  story: { edge: HAS_STORY, type: STORY, parent: INITIATIVE },
  requirement: { edge: HAS_REQUIREMENT, type: REQUIREMENT, parent: STORY },
  milestone: { edge: HAS_MILESTONE, type: MILESTONE, parent: INITIATIVE },
  feature: { edge: HAS_FEATURE, type: FEATURE, parent: MILESTONE },
  architecture: { edge: HAS_ARCHITECTURE, type: ARCHITECTURE, parent: FEATURE },
};

export default defineStep({
  type: "stadeum/canvas/op",
  description:
    "A person's act on the canvas, with no model: accept | drop | reset (a requirement's status) | set_status { ref_id, value, reason? } " +
    "(planned, active, done, dropped on an initiative, milestone or feature; blocked sets the card's blocked flag beside its status, " +
    "any other value clears it) | edit { ref_id, field, value } | remove { ref_id, reason? } (the card and everything under it, kept so " +
    "it can be restored; refused once work has started on it) | restore { ref_id } | add { kind, parent?, text } (kind initiative, " +
    "brief, story, requirement, milestone, feature or architecture) | add_question { parent? | about, text } | add_option { parent, text } | " +
    "choose { ref_id, reason? } | unchoose { ref_id, reason? }. The Infinite Canvas app runs it through the `ops` workflow, as the viewer.",
  effect: "write",
  input: z.object({
    op: z.enum(["accept", "drop", "reset", "set_status", "edit", "remove", "restore", "add", "add_question", "add_option", "choose", "unchoose"]),
    ref_id: z.string().optional(),
    field: z.string().optional(),
    value: z.string().optional(),
    kind: z.enum(["initiative", "brief", "story", "requirement", "milestone", "feature", "architecture"]).optional(),
    parent: z.string().optional(),
    about: z.string().optional(),
    text: z.string().optional(),
    reason: z.string().optional(),
  }),
  output: z.any(),
  async run(cfg, ctx) {
    const need = (v: unknown, what: string) => {
      const s = String(v ?? "").trim();
      if (!s) throw new Error(`${WHO}: ${what} is needed for ${cfg.op}`);
      return s;
    };
    const get = async (ref: string) => {
      const n = await getNode(ctx, ref, WHO);
      if (!n || !live(n.properties)) throw new Error(`${WHO}: ${ref} not found (wrong ref, or removed)`);
      return n;
    };
    const label = (p: Record<string, unknown>, name?: string) => clip(String(p["name"] ?? p["text"] ?? name ?? ""), 80);
    const by = actorOf(ctx);
    const stamp = () => ({ author: by ?? "person", created_by_kind: "human" });

    const setStatus = async (ref: string, raw: unknown) => {
      const n = await get(ref);
      if (!PLAN_TYPES.includes(n.node_type)) throw new Error(`${WHO}: a ${n.node_type} has no status to set`);
      const status = normStatus(raw, WHO);
      const was = (n.properties["status"] as string) ?? null;
      const wasBlocked = isTrue(n.properties["blocked"]);
      if (status === "blocked") {
        const reason = String(cfg.reason ?? "").trim();
        await call(ctx, "graph/edit-node", { ref_id: ref, node_data: { blocked: true, ...(reason ? { blocked_reason: reason } : {}) } }, WHO);
        return { op: "set_status", ref_id: ref, node_type: n.node_type, status: "blocked", text: `${n.node_type} "${label(n.properties)}" is blocked${reason ? ` (${reason})` : ""}; its status stays ${was ?? "unset"}.` };
      }
      const data: Record<string, unknown> = {};
      if (was !== status) data["status"] = status;
      if (status === "done" && !n.properties["completed_at"]) data["completed_at"] = new Date().toISOString();
      if (wasBlocked) data["blocked"] = false;
      if (Object.keys(data).length || wasBlocked) {
        await call(ctx, "graph/edit-node", { ref_id: ref, ...(Object.keys(data).length ? { node_data: data } : {}), ...(wasBlocked && n.properties["blocked_reason"] ? { properties_to_be_deleted: ["blocked_reason"] } : {}) }, WHO);
      }
      return { op: "set_status", ref_id: ref, node_type: n.node_type, status, text: `${n.node_type} "${label(n.properties)}": ${wasBlocked ? "blocked" : was ?? "unset"} → ${status}.` };
    };

    switch (cfg.op) {
      case "set_status":
        return setStatus(need(cfg.ref_id, "ref_id"), need(cfg.value, "value"));
      case "choose": {
        const r = await choose(ctx, need(cfg.ref_id, "ref_id"), cfg.reason?.trim() || "chosen", WHO);
        return { op: cfg.op, ref_id: r.ref_id, text: `Chose "${clip(String(r.text ?? ""), 80)}".` };
      }
      case "unchoose": {
        const ref = need(cfg.ref_id, "ref_id");
        const before = await get(ref);
        const r = await unchoose(ctx, ref, cfg.reason?.trim() || "changed my mind", WHO);
        // A choice said aloud on a recorded call: its lines go with it (the installed `_brainstorm` helper takes off only state_speaker/state_quote).
        const callAloud = ["state_call_job", "state_call_lines"].filter((k) => before.properties[k] !== undefined && before.properties[k] !== null);
        if (callAloud.length) await call(ctx, "graph/edit-node", { ref_id: ref, properties_to_be_deleted: callAloud }, WHO);
        return { op: cfg.op, ref_id: r.ref_id, text: `Took back "${clip(String(r.text ?? ""), 80)}".` };
      }
      case "remove": {
        const r = await removeCard(ctx, need(cfg.ref_id, "ref_id"), { reason: cfg.reason, who: WHO });
        const n = r.removed.length;
        return { op: cfg.op, ref_id: r.ref_id, node_type: r.node_type, removed: r.removed, initiative_ref: r.initiative_ref, text: `Removed ${r.node_type} "${r.name}"${n > 1 ? ` and ${n - 1} card(s) under it` : ""}. You can restore it.` };
      }
      case "restore": {
        const r = await restoreCard(ctx, need(cfg.ref_id, "ref_id"), WHO);
        const n = r.restored.length;
        return { op: cfg.op, ref_id: r.ref_id, node_type: r.node_type, restored: r.restored, initiative_ref: r.initiative_ref, text: `Restored ${r.node_type} "${r.name}"${n > 1 ? ` and ${n - 1} card(s) under it` : ""}.` };
      }
      case "add_question":
      case "add_option": {
        const isQ = cfg.op === "add_question";
        const text = need(cfg.text, "text");
        const r = await addByPerson(ctx, { kind: isQ ? "question" : "option", text, parent: cfg.parent?.trim() || undefined, about: cfg.about?.trim() || undefined }, WHO);
        return { op: cfg.op, ref_id: r.ref_id, root: r.root, written: [{ ref_id: r.ref_id, node_type: r.node_type, name: text }], text: `Added your ${isQ ? "question" : "option"} "${clip(text, 80)}".` };
      }
      case "accept":
      case "drop":
      case "reset": {
        const n = await get(need(cfg.ref_id, "ref_id"));
        if (n.node_type !== REQUIREMENT) throw new Error(`${WHO}: ${cfg.op} is for a requirement, not a ${n.node_type}`);
        const status = cfg.op === "accept" ? "accepted" : cfg.op === "drop" ? "dropped" : "proposed";
        await call(ctx, "graph/edit-node", { ref_id: n.ref_id, node_data: { status } }, WHO);
        return { op: cfg.op, ref_id: n.ref_id, status, text: `Requirement "${label(n.properties)}" is ${status}.` };
      }
      case "edit": {
        const n = await get(need(cfg.ref_id, "ref_id"));
        const allowed = EDITABLE[n.node_type];
        if (!allowed) throw new Error(`${WHO}: a ${n.node_type} is not edited here`);
        const field = need(cfg.field, "field");
        if (!allowed.includes(field)) throw new Error(`${WHO}: ${field} is not editable on a ${n.node_type} (${allowed.join(", ")})`);
        if (field === "status") return setStatus(n.ref_id, need(cfg.value, "value"));
        const raw = CLEARABLE.has(field) ? String(cfg.value ?? "").trim() : need(cfg.value, "value");
        if ((field === "target_date" || field === "due_date") && raw && (!/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(Date.parse(raw)))) {
          throw new Error(`${WHO}: ${field} is a date (YYYY-MM-DD), not "${raw}". Nothing was written.`);
        }
        if (!raw) {
          if (n.properties[field] !== undefined) await call(ctx, "graph/edit-node", { ref_id: n.ref_id, properties_to_be_deleted: [field] }, WHO);
          return { op: cfg.op, ref_id: n.ref_id, text: `Cleared ${field}.` };
        }
        const data: Record<string, unknown> = { [field]: field === "sequence" ? Number(raw) : field === "builds_in" ? normBuildsIn(raw, WHO) : field === "repos" ? JSON.stringify(reposOf(raw, WHO)) : raw };
        if (field === "sequence" && !Number.isFinite(data["sequence"])) throw new Error(`${WHO}: sequence is a number`);
        if (TEXT_NAMED.has(n.node_type) && field === "text") data["name"] = clip(raw);
        await call(ctx, "graph/edit-node", { ref_id: n.ref_id, node_data: data }, WHO);
        return { op: cfg.op, ref_id: n.ref_id, text: `Updated the ${n.node_type}'s ${field}.` };
      }
      case "add": {
        const kind = cfg.kind;
        if (!kind) throw new Error(`${WHO}: add needs a kind`);
        const text = need(cfg.text, "text");
        if (kind === "initiative") {
          const dup = await initiativeNamed(ctx, text, null, WHO);
          if (dup) throw new Error(`${WHO}: there is already an initiative named "${dup.name ?? text}" (${dup.ref_id}). Nothing was written. Open it, or pick another name.`);
          const r = await call(ctx, "graph/create-node", { node_type: INITIATIVE, node_data: { name: text, status: "planned", ...stamp() } }, WHO);
          return { op: cfg.op, ref_id: r.ref_id, written: [{ ref_id: r.ref_id, node_type: INITIATIVE, name: text }], text: `Created the initiative "${clip(text, 80)}".` };
        }
        const spec = ADD[kind]!;
        const par = await get(need(cfg.parent, "parent"));
        if (par.node_type !== spec.parent) throw new Error(`${WHO}: a ${kind} goes under a ${spec.parent}, not a ${par.node_type}`);
        let data: Record<string, unknown>;
        if (kind === "brief") data = { name: clip(text), text, ...stamp() };
        else if (kind === "story" || kind === "requirement") data = { name: clip(text), text, status: "proposed", ...stamp() };
        else if (kind === "feature") data = { name: text, status: "planned", ...stamp() };
        else if (kind === "architecture") data = { name: clip(text.split("\n")[0]!, 200), ...(text.includes("\n") ? { description: text } : {}), ...stamp() };
        else {
          const ms = await linked(ctx, par.ref_id, HAS_MILESTONE, "forward", { who: WHO });
          const got = await getNodes(ctx, ms.map((m) => m.ref_id), WHO);
          const seq = Math.max(0, ...[...got.values()].filter((m) => live(m.properties)).map((m) => Number(m.properties["sequence"]) || 0)) + 1;
          data = { name: text, sequence: seq, status: "planned", ...stamp() };
        }
        const r = await call(ctx, "graph/create-triplet", { source_ref_id: par.ref_id, edge_type: spec.edge, target_type: spec.type, target_data: data }, WHO);
        const ref = r?.target_ref_id ?? r?.ref_id;
        if (!ref) throw new Error(`${WHO}: writing the ${kind} failed: ${JSON.stringify(r)}`);
        return { op: cfg.op, ref_id: ref, written: [{ ref_id: ref, node_type: spec.type, name: data["name"] }], text: `Added the ${kind} "${clip(text, 80)}".` };
      }
    }
  },
});
