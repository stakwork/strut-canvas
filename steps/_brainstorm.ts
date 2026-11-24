/**
 * A person's acts on a brainstorm: writing their own question or option,
 * choosing an option, and taking a choice back. An agent never chooses (the
 * Brainstorm page): its words go through `brainstorm-write`.
 */
import { ABOUT, OPTION, PARENT_OF, QUESTION, TREE_TYPES, actorOf, call, clip, getNode, getNodes, linked, live, nextSeq, type Node } from "./_canvas.js";

/** Who decided, and when: from the run, never from the input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const decided = (ctx: any, reason: string) => ({
  state_reason: reason,
  state_at: Date.now(),
  state_run: String(ctx.runId ?? ""),
  ...(actorOf(ctx) ? { state_by: actorOf(ctx) } : {}),
});

/** The root question of the brainstorm a card is in. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rootOf(ctx: any, ref: string, who = "canvas"): Promise<string> {
  let cur = ref;
  const seen = new Set([ref]);
  for (;;) {
    const up = await linked(ctx, cur, PARENT_OF, "reverse", { types: TREE_TYPES, who });
    if (!up.length) return cur;
    cur = up[0]!.ref_id;
    if (seen.has(cur)) throw new Error(`${who}: the brainstorm has a loop at ${cur}`);
    seen.add(cur);
  }
}

/**
 * A person's own question or option. A question with no parent starts a
 * brainstorm about a plan card (`about`); a question under a question is a
 * sub-question, under an option a follow-up; an option goes under a question.
 */
export async function addByPerson(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  a: { kind: "question" | "option"; text: string; parent?: string; about?: string },
  who = "canvas",
) {
  const text = a.text.trim();
  if (!text) throw new Error(`${who}: the ${a.kind} has no text`);
  let parent: Node | null = null;
  if (a.parent) {
    parent = await getNode(ctx, a.parent, who);
    if (!parent || !live(parent.properties)) throw new Error(`${who}: parent ${a.parent} not found (or removed)`);
    if (!TREE_TYPES.includes(parent.node_type)) throw new Error(`${who}: a ${a.kind} goes under a question or an option, not a ${parent.node_type}`);
    if (a.kind === "option" && parent.node_type !== QUESTION) throw new Error(`${who}: an option goes under a question; add a follow-up question under this option first`);
  } else {
    if (a.kind === "option") throw new Error(`${who}: an option needs the question it answers (parent)`);
    if (!a.about) throw new Error(`${who}: a new brainstorm needs the card it is about (about)`);
    const ab = await getNode(ctx, a.about, who);
    if (!ab || !live(ab.properties)) throw new Error(`${who}: ${a.about} not found (or removed)`);
  }
  const by = actorOf(ctx);
  const type = a.kind === "question" ? QUESTION : OPTION;
  const made = await call(ctx, "graph/create-node", {
    node_type: type,
    node_data: { name: clip(text), text, made_by: "user", quote: text, state: "open", seq: nextSeq(), ...(by ? { by } : {}) },
  }, who);
  const ref: string = made.ref_id;
  if (parent) await call(ctx, "graph/create-triplet", { source_ref_id: parent.ref_id, edge_type: PARENT_OF, target_ref_id: ref }, who);
  else await call(ctx, "graph/create-triplet", { source_ref_id: ref, edge_type: ABOUT, target_ref_id: a.about! }, who);
  return { ref_id: ref, node_type: type, root: parent ? await rootOf(ctx, parent.ref_id, who) : ref };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function optionWithQuestion(ctx: any, ref: string, who: string) {
  const n = await getNode(ctx, ref, who);
  if (!n || !live(n.properties)) throw new Error(`${who}: ${ref} not found (or removed)`);
  if (n.node_type !== OPTION) throw new Error(`${who}: ${ref} is a ${n.node_type}; only an option is chosen`);
  const up = await linked(ctx, ref, PARENT_OF, "reverse", { types: [QUESTION], who });
  if (up.length > 1) throw new Error(`${who}: ${ref} hangs under ${up.length} questions; the brainstorm is malformed`);
  return { n, question: up[0] ? await getNode(ctx, up[0].ref_id, who) : null };
}

/** Mark an option chosen, and its question decided. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function choose(ctx: any, ref: string, reason = "chosen", who = "canvas") {
  const { n, question } = await optionWithQuestion(ctx, ref, who);
  if (n.properties["state"] !== "chosen") await call(ctx, "graph/edit-node", { ref_id: ref, node_data: { state: "chosen", ...decided(ctx, reason) } }, who);
  if (question && question.properties["state"] !== "decided") {
    await call(ctx, "graph/edit-node", { ref_id: question.ref_id, node_data: { state: "decided", ...decided(ctx, `"${clip(String(n.properties["text"] ?? ""), 60)}" chosen: ${reason}`) } }, who);
  }
  return { ref_id: ref, text: n.properties["text"] ?? null, question: question?.ref_id ?? null };
}

/** Take a choice back: the option is open again, and so is its question unless another option under it is still chosen. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function unchoose(ctx: any, ref: string, reason = "changed my mind", who = "canvas") {
  const { n, question } = await optionWithQuestion(ctx, ref, who);
  if (n.properties["state"] !== "chosen") throw new Error(`${who}: "${clip(String(n.properties["text"] ?? ""), 60)}" is not chosen; nothing to take back`);
  await call(ctx, "graph/edit-node", { ref_id: ref, node_data: { state: "open", ...decided(ctx, reason) } }, who);
  let reopened = false;
  if (question) {
    const siblings = await linked(ctx, question.ref_id, PARENT_OF, "forward", { types: [OPTION], who });
    const got = await getNodes(ctx, siblings.map((s) => s.ref_id).filter((id) => id !== ref), who);
    const still = [...got.values()].some((o) => live(o.properties) && o.properties["state"] === "chosen");
    if (!still && question.properties["state"] !== "open") {
      await call(ctx, "graph/edit-node", { ref_id: question.ref_id, node_data: { state: "open", ...decided(ctx, `"${clip(String(n.properties["text"] ?? ""), 60)}" taken back: ${reason}`) } }, who);
      reopened = true;
    }
  }
  return { ref_id: ref, text: n.properties["text"] ?? null, question: question?.ref_id ?? null, reopened };
}
