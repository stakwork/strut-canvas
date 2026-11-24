// Pending proposals that would change the plan, as pencil cards where they
// would land: a new initiative on the home map, a new milestone or feature
// under the card it is linked from, a new title on the card it renames.
// A proposal about anything else is not the canvas's. Pure.
import { PLAN, type Pencil, type Plan, type Role, type Roles } from "./plan";

export interface ProposalRecord {
  id: string;
  step: string;
  title?: string;
  rationale?: string;
  input?: unknown;
}

export interface Made {
  id: string;
  role: Role;
  title: string;
  parent?: string;
  pencil: Pencil;
}

/** The steps whose proposals may change the plan: only these are read in full. */
export const PLAN_STEPS = new Set(["graph/create-node", "graph/create-triplet", "graph/create-batch-triplet", "graph/edit-node"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const wordsOf = (d: Record<string, unknown>) => str(d.name) ?? str(d.text) ?? str(d.title) ?? "Untitled";

function roleOf(roles: Roles, type: unknown): Role | null {
  return type === roles.goal ? "goal" : type === roles.group ? "group" : type === roles.work ? "work" : null;
}

const WORD: Record<Role, string> = { goal: "initiative", group: "milestone", work: "feature" };

/** What one proposal would do to the plan: cards it makes, and a rename. Empty when it does not touch the plan. */
export function planChange(rec: ProposalRecord, plan: Plan, roles: Roles = PLAN): { made: Made[]; edit?: { id: string; name: string; pencil: Pencil } } {
  const input = isRecord(rec.input) ? rec.input : {};
  const pencilOf = (title: string): Pencil => ({ proposalId: rec.id, title, ...(rec.rationale ? { rationale: rec.rationale } : {}) });
  const made: Made[] = [];
  const add = (type: unknown, data: unknown, parent?: string) => {
    const role = roleOf(roles, type);
    if (!role) return;
    const d = isRecord(data) ? data : {};
    const title = wordsOf(d);
    const under = parent ? plan.cards[parent] : undefined;
    if (role !== "goal" && !under) return;
    made.push({ id: `pencil:${rec.id}:${made.length}`, role, title, ...(parent ? { parent } : {}), pencil: pencilOf(under ? `Add ${WORD[role]} "${title}" to ${under.title}` : `New ${WORD[role]}: ${title}`) });
  };
  const triplet = (t: Record<string, unknown>) => {
    const source = str(t.source_ref_id);
    if (!source || !plan.cards[source] || str(t.target_ref_id)) return;
    add(t.target_type, t.target_data, source);
  };
  switch (rec.step) {
    case "graph/create-node":
      add(input.node_type, input.node_data);
      break;
    case "graph/create-triplet":
      triplet(input);
      break;
    case "graph/create-batch-triplet":
      if (Array.isArray(input.triplets)) for (const t of input.triplets) if (isRecord(t)) triplet(t);
      break;
    case "graph/edit-node": {
      const ref = str(input.ref_id);
      const card = ref ? plan.cards[ref] : undefined;
      const data = isRecord(input.node_data) ? input.node_data : {};
      if (card) {
        const name = str(data.name);
        return { made, edit: { id: card.id, name: name ?? card.title, pencil: pencilOf(name ? `Rename ${WORD[card.role]} "${card.title}" to "${name}"` : `Change ${WORD[card.role]} "${card.title}"`) } };
      }
    }
  }
  return { made };
}

/** Every plan proposal's cards and renames, and which proposals touch the plan. */
export function planProposals(records: ProposalRecord[], plan: Plan, roles: Roles = PLAN) {
  const made: Made[] = [];
  const edits: Record<string, Pencil & { name: string }> = {};
  const about = new Map<string, string>();
  for (const r of records) {
    const c = planChange(r, plan, roles);
    made.push(...c.made);
    if (c.edit) edits[c.edit.id] = { ...c.edit.pencil, name: c.edit.name };
    const first = c.made[0];
    if (first) about.set(r.id, first.pencil.title);
    else if (c.edit) about.set(r.id, c.edit.pencil.title);
  }
  return { made, edits, about };
}
