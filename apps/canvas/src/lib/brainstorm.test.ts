import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, type RawNode } from "./plan.ts";
import { asksIn, buildBrainstorms } from "./brainstorm.ts";
import { asksAbove, thinkTree } from "./thinktree.ts";
import { patchBrainstorms } from "./optimistic.ts";

const node = (ref_id: string, properties: Record<string, unknown> = {}): RawNode => ({ ref_id, name: String(properties["text"] ?? ref_id), properties });
const plan = buildPlan({ goal: [node("g", { name: "Goal" })], group: [], work: [] }, []);

// A topic (as Brainstorm Method writes one): the root names it, each decision is a sub-question with its options,
// and an option leads to a follow-up.
const b = buildBrainstorms(
  [node("root", { text: "How should onboarding work?", seq: 1 }), node("q1", { text: "How is setup guided?", seq: 2 }), node("q2", { text: "Who invites the team?", seq: 6 }), node("f", { text: "How long is the tour?", seq: 9 })],
  [
    node("o1", { text: "A checklist", seq: 3, fast: 0.5, good: 0.4, cheap: 0.6, recommended: true }),
    node("o2", { text: "A tour", seq: 4, made_by: "user", speaker: "Cleo", by: "evan" }),
    node("o3", { text: "The admin", seq: 7, state: "chosen" }),
    node("o4", { text: "Anyone", seq: 8 }),
    node("o5", { text: "Two minutes", seq: 10 }),
  ],
  [
    { source: "root", target: "g", edge_type: "ABOUT" },
    { source: "root", target: "q2", edge_type: "PARENT_OF" },
    { source: "root", target: "q1", edge_type: "PARENT_OF" },
    { source: "q1", target: "o2", edge_type: "PARENT_OF" },
    { source: "q1", target: "o1", edge_type: "PARENT_OF" },
    { source: "q2", target: "o3", edge_type: "PARENT_OF" },
    { source: "q2", target: "o4", edge_type: "PARENT_OF" },
    { source: "o2", target: "f", edge_type: "PARENT_OF" },
    { source: "f", target: "o5", edge_type: "PARENT_OF" },
    { source: "o1", target: "e1", edge_type: "HAS_EFFECT" },
    { source: "o1", target: "e2", edge_type: "HAS_EFFECT" },
  ],
  plan,
  undefined,
  [node("e1", { name: "Quick to ship", description: "Ships this sprint.", score: 0.6 }), node("e2", { name: "Easy to skip", description: "People may ignore it.", score: -0.3 })],
);

test("sub-questions hang under their question, not as trees of their own", () => {
  assert.deepEqual(b.asks["root"]!.subs, ["q1", "q2"]);
  assert.equal(b.asks["q1"]!.root, false);
  assert.equal(b.asks["q1"]!.follows, false);
  assert.equal(b.asks["f"]!.follows, true);
  assert.deepEqual(asksIn(plan, b, "g"), ["root"]);
  assert.deepEqual(asksAbove(b, "f"), ["root", "q1"]);
});

test("labels follow the tree: numbered sub-questions, lettered options, follow-ups pass their option's label down", () => {
  assert.equal(b.asks["root"]!.label, "");
  assert.equal(b.asks["q1"]!.label, "1");
  assert.equal(b.asks["q2"]!.label, "2");
  assert.deepEqual(["o1", "o2", "o3", "o4"].map((o) => b.choices[o]!.label), ["1A", "1B", "2A", "2B"]);
  assert.equal(b.choices["o5"]!.label, "1BA");
});

test("an option carries its ratings and effects from the one read", () => {
  const o = b.choices["o1"]!;
  assert.deepEqual(o.ratings, { fast: 0.5, good: 0.4, cheap: 0.6 });
  assert.equal(o.recommended, true);
  assert.deepEqual(o.effects.map((e) => `${e.direction} ${e.name}`), ["pro Quick to ship", "con Easy to skip"]);
  assert.equal(b.choices["o2"]!.ratings, null);
});

test("a topic is open while a decision under it is", () => {
  assert.equal(b.asks["q2"]!.open, true, "q2 has a chosen option but was not marked decided");
  assert.equal(b.asks["root"]!.open, true);
  const decided = buildBrainstorms(
    [node("t", { text: "Topic" }), node("d", { text: "Decision", state: "decided" })],
    [node("x", { text: "X", state: "chosen" })],
    [
      { source: "t", target: "g", edge_type: "ABOUT" },
      { source: "t", target: "d", edge_type: "PARENT_OF" },
      { source: "d", target: "x", edge_type: "PARENT_OF" },
    ],
    plan,
  );
  assert.equal(decided.asks["t"]!.open, false);
});

test("an opened topic draws its sub-questions; Open all reaches every question", () => {
  const closed = thinkTree(plan, b, "g", { folded: new Set(), expanded: new Set(), show: "all", sizes: {} });
  assert.deepEqual(closed.shownAsks, ["root"]);
  assert.deepEqual([...closed.everyAsk].sort(), ["f", "q1", "q2", "root"]);
  const open = thinkTree(plan, b, "g", { folded: new Set(), expanded: new Set(closed.everyAsk), show: "all", sizes: {} });
  assert.deepEqual(open.nodes["root"]!.kids, ["q1", "q2"]);
  assert.deepEqual(open.nodes["q1"]!.kids, ["o1", "o2"]);
  assert.deepEqual(open.nodes["o2"]!.kids, ["f"]);
});

test("removing a topic takes its sub-questions, their options and follow-ups with it", () => {
  const r = patchBrainstorms(b, { op: "remove", ref_id: "q1" })!;
  assert.deepEqual(r.asks["root"]!.subs, ["q2"]);
  for (const gone of ["q1", "o1", "o2", "f", "o5"]) assert.ok(!r.asks[gone] && !r.choices[gone], gone);
  assert.deepEqual(Object.keys(patchBrainstorms(b, { op: "remove", ref_id: "root" })!.asks), []);
});
