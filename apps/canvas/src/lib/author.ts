// Who wrote a card, by name. Pure.
//
// The graph stamps a writer two ways:
//  - plan cards: created_by_kind (human | jamie | strut) and author (a person's actor id, or the agent).
//  - brainstorm cards: made_by (user | model), and for a person's words `by` (their actor id).

export interface Author {
  kind: "person" | "agent" | "unknown";
  /** A person's name as the stamp gives it. */
  login?: string;
  /** An agent's name: Jamie, Strut. */
  name?: string;
}

const PEOPLE = new Set(["human", "person", "user"]);
const AGENTS: Record<string, string> = { jamie: "Jamie", model: "Jamie", agent: "Jamie", strut: "Strut" };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A person from a stamp: nothing when it only says "a person". */
export function parseActor(raw: unknown): { login?: string } {
  const s = str(raw);
  return !s || PEOPLE.has(s.toLowerCase()) ? {} : { login: s };
}

/** Who wrote a card, from its properties. */
export function authorOf(p: Record<string, unknown> | undefined): Author {
  const props = p ?? {};
  const made = str(props["made_by"]).toLowerCase();
  const kind = str(props["created_by_kind"]).toLowerCase();
  // A brainstorm card: made_by says whose words they are, whoever wrote the card.
  if (made === "model") return { kind: "agent", name: "Jamie" };
  if (made && PEOPLE.has(made)) return { kind: "person", ...parseActor(props["by"]) };
  if (PEOPLE.has(kind)) return { kind: "person", ...parseActor(props["author"]) };
  if (AGENTS[kind]) return { kind: "agent", name: AGENTS[kind] };
  const by = str(props["author"]).toLowerCase();
  if (AGENTS[by]) return { kind: "agent", name: AGENTS[by] };
  return { kind: "unknown" };
}

/** Names the canvas has read, by the stamp that carries them (kept for callers; stamps carry the name itself). */
export function directoryOf(_authors: Iterable<Author>): Record<string, string> {
  return {};
}

/** The name to show: a person's name, an agent's name. */
export function authorName(a: Author, _dir: Record<string, string> = {}): string | null {
  if (a.kind === "agent") return a.name ?? "Jamie";
  if (a.kind === "person") return a.login ?? "a person";
  return null;
}

/** A person's picture: none (the initial is drawn). */
export function avatarOf(_a: Author, _dir: Record<string, string> = {}): string | null {
  return null;
}
