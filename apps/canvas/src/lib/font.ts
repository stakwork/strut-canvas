// Which face a piece of writing is drawn in. Pure.
//
// The plan (initiatives, milestones, features, briefs, stories, requirements)
// is always printed, whoever wrote it. Handwriting is kept for what a PERSON
// put on the canvas as a sticky: a brainstorm question, option or note. An
// agent's sticky is printed (its pencil outline, while nobody has accepted it,
// is a separate rule). Chat is never handwritten.

/** What kind of writing it is. */
export type Writing = "plan" | "sticky" | "chat";
export type Font = "hand" | "print";

export function fontOf(kind: Writing, by: "person" | "agent" | null): Font {
  return kind === "sticky" && by === "person" ? "hand" : "print";
}
