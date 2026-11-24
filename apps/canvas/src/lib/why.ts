// Why a goal exists, and what answers it: the goal's brief, the stories of
// who it is for, each story's requirements, the work that satisfies each
// requirement, and each piece of work's architecture. Built from typed nodes
// and the edges among them, like the plan (./plan.ts); which types and edges
// those are is data. Pure.
import { authorOf, type Author } from "./author";
import { isLive, type Plan, type RawEdge, type RawNode } from "./plan";

export interface WhyRoles {
  brief: string;
  story: string;
  requirement: string;
  architecture: string;
  /** goal → its brief, goal → a story, story → a requirement, work → its architecture. */
  hasBrief: string;
  hasStory: string;
  hasRequirement: string;
  hasArchitecture: string;
  /** work → a requirement it answers. */
  satisfies: string;
}

/** What the canvas writes. */
export const WHY: WhyRoles = { brief: "Brief", story: "UserStory", requirement: "Requirement", architecture: "Architecture", hasBrief: "HAS_BRIEF", hasStory: "HAS_STORY", hasRequirement: "HAS_REQUIREMENT", hasArchitecture: "HAS_ARCHITECTURE", satisfies: "SATISFIES" };

/** proposed (an agent wrote it, nobody has said yes), accepted, or dropped. */
export type Agreed = "proposed" | "accepted" | "dropped";

export interface Story {
  id: string;
  text: string;
  status: Agreed;
  by: "person" | "agent" | null;
  author: Author;
  requirements: string[];
}
export interface Requirement {
  id: string;
  text: string;
  status: Agreed;
  by: "person" | "agent" | null;
  author: Author;
  story: string | null;
}
export interface Architecture {
  id: string;
  name: string;
  description: string;
  diagram: string;
}
export interface Why {
  /** A goal's brief, as written, and its node. */
  brief: Record<string, string>;
  briefId: Record<string, string>;
  stories: Record<string, Story>;
  requirements: Record<string, Requirement>;
  /** A goal's stories, in the order they were written. */
  byGoal: Record<string, string[]>;
  /** The work that answers a requirement, and the requirements a piece of work answers. */
  answers: Record<string, string[]>;
  serves: Record<string, string[]>;
  /** A piece of work's architecture. */
  architecture: Record<string, Architecture>;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const textOf = (n: RawNode): string => str(n.properties?.["text"]) || str(n.properties?.["description"]) || str(n.properties?.["content"]) || (n.name ?? "").trim();
const at = (n: RawNode): number => (typeof n.properties?.["date_added_to_graph"] === "number" ? (n.properties["date_added_to_graph"] as number) : 0);
const agreed = (n: RawNode): Agreed => {
  const s = str(n.properties?.["status"]).toLowerCase();
  return s === "accepted" ? "accepted" : s === "dropped" ? "dropped" : "proposed";
};
const by = (n: RawNode) => {
  const k = str(n.properties?.["created_by_kind"]).toLowerCase();
  return k === "human" || k === "person" || k === "user" ? "person" : k ? "agent" : null;
};

export function buildWhy(nodes: { briefs: RawNode[]; stories: RawNode[]; requirements: RawNode[]; architectures?: RawNode[] }, edges: RawEdge[], plan: Plan, roles: WhyRoles = WHY): Why {
  const out: Why = { brief: {}, briefId: {}, stories: {}, requirements: {}, byGoal: {}, answers: {}, serves: {}, architecture: {} };
  const briefs = new Map(nodes.briefs.filter((n) => isLive(n.properties)).map((n) => [n.ref_id, textOf(n)]));
  const archs = new Map((nodes.architectures ?? []).filter((n) => isLive(n.properties)).map((n) => [n.ref_id, { id: n.ref_id, name: (n.name ?? str(n.properties?.["name"])) || "Architecture", description: str(n.properties?.["description"]) || str(n.properties?.["summary"]), diagram: str(n.properties?.["diagram"]) }]));
  const written = new Map<string, number>();
  for (const n of nodes.stories) {
    if (!isLive(n.properties) || out.stories[n.ref_id]) continue;
    out.stories[n.ref_id] = { id: n.ref_id, text: textOf(n), status: agreed(n), by: by(n), author: authorOf(n.properties), requirements: [] };
    written.set(n.ref_id, at(n));
  }
  for (const n of nodes.requirements) {
    if (!isLive(n.properties) || out.requirements[n.ref_id]) continue;
    out.requirements[n.ref_id] = { id: n.ref_id, text: textOf(n), status: agreed(n), by: by(n), author: authorOf(n.properties), story: null };
    written.set(n.ref_id, at(n));
  }
  for (const e of edges) {
    const goal = plan.cards[e.source]?.role === "goal" ? e.source : null;
    if (goal && e.edge_type === roles.hasBrief && briefs.has(e.target)) {
      if (!out.brief[goal]) {
        out.brief[goal] = briefs.get(e.target)!;
        out.briefId[goal] = e.target;
      }
    } else if (goal && e.edge_type === roles.hasStory && out.stories[e.target]) {
      const list = (out.byGoal[goal] ??= []);
      if (!list.includes(e.target)) list.push(e.target);
    } else if (e.edge_type === roles.hasRequirement && out.stories[e.source] && out.requirements[e.target] && !out.requirements[e.target]!.story) {
      out.requirements[e.target]!.story = e.source;
      out.stories[e.source]!.requirements.push(e.target);
    } else if (e.edge_type === roles.satisfies && plan.cards[e.source] && out.requirements[e.target]) {
      const a = (out.answers[e.target] ??= []);
      if (!a.includes(e.source)) a.push(e.source);
      const s = (out.serves[e.source] ??= []);
      if (!s.includes(e.target)) s.push(e.target);
    } else if (e.edge_type === roles.hasArchitecture && plan.cards[e.source] && archs.has(e.target) && !out.architecture[e.source]) {
      out.architecture[e.source] = archs.get(e.target)!;
    }
  }
  const oldestFirst = (x: string, y: string) => (written.get(x) ?? 0) - (written.get(y) ?? 0) || x.localeCompare(y);
  for (const g of Object.keys(out.byGoal)) out.byGoal[g]!.sort(oldestFirst);
  for (const s of Object.values(out.stories)) s.requirements.sort(oldestFirst);
  return out;
}

/** Every piece of work that answers any of a story's requirements. */
export function workFor(why: Why, story: string): string[] {
  const out = new Set<string>();
  for (const r of why.stories[story]?.requirements ?? []) for (const w of why.answers[r] ?? []) out.add(w);
  return [...out];
}

/** "As a builder, I want X, so that Y." in its three parts: who it is for, what they want (without
 *  "I want (to)"), and why (after the last "so that" or ", so"). Null when it does not open "As a …,". */
export function parseStory(text: string): { who: string; want: string; why: string | null } | null {
  const m = /^As an? ([^,]{1,80}),\s*(.+?)\.?$/is.exec(text.replace(/\s+/g, " ").trim());
  if (!m) return null;
  let want = m[2]!.replace(/^I (?:want|need)(?: to)? /i, "");
  let why: string | null = null;
  const so = [...want.matchAll(/,?\s+so that\s+|,\s+so\s+/gi)].pop();
  if (so && so.index > 0) {
    why = want.slice(so.index + so[0].length);
    want = want.slice(0, so.index);
  }
  return { who: m[1]!, want: want.charAt(0).toUpperCase() + want.slice(1), why };
}
