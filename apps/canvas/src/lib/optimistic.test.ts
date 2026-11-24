import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, type RawNode } from "./plan.ts";
import { buildWhy } from "./why.ts";
import { buildBrainstorms } from "./brainstorm.ts";
import { patchBrainstorms, patchPlan, patchWhy } from "./optimistic.ts";

const node = (ref_id: string, properties: Record<string, unknown> = {}): RawNode => ({ ref_id, name: String(properties["name"] ?? ref_id), properties });
const plan = buildPlan(
  { goal: [node("g", { name: "Goal", status: "planned" })], group: [node("m", { name: "M1", status: "planned", sequence: 1 })], work: [node("f", { name: "F1", status: "planned" })] },
  [
    { source: "g", target: "m", edge_type: "HAS_MILESTONE" },
    { source: "m", target: "f", edge_type: "HAS_FEATURE" },
  ],
);

test("a rename, a status and the blocked flag show on the card at once", () => {
  assert.equal(patchPlan(plan, { op: "edit", ref_id: "m", field: "name", value: "Renamed" })!.cards["m"]!.title, "Renamed");
  const active = patchPlan(plan, { op: "set_status", ref_id: "f", value: "active" })!;
  assert.equal(active.cards["f"]!.state, "prog");
  assert.equal(active.cards["f"]!.status, "active");
  const blocked = patchPlan(active, { op: "set_status", ref_id: "f", value: "BLOCKED", reason: "waiting on design" })!;
  assert.equal(blocked.cards["f"]!.state, "block");
  assert.equal(blocked.cards["f"]!.props["blocked_reason"], "waiting on design");
  assert.equal(patchPlan(blocked, { op: "set_status", ref_id: "f", value: "active" })!.cards["f"]!.state, "prog");
});

test("a removed card goes with everything under it", () => {
  const p = patchPlan(plan, { op: "remove", ref_id: "m" })!;
  assert.deepEqual(Object.keys(p.cards), ["g"]);
  assert.deepEqual(p.kids["g"], []);
  assert.equal(patchPlan(plan, { op: "remove", ref_id: "g" })!.goals.length, 0);
});

test("an act the plan does not draw changes nothing", () => {
  assert.equal(patchPlan(plan, { op: "accept", ref_id: "f" }), null);
  assert.equal(patchPlan(plan, { op: "edit", ref_id: "nope", field: "name", value: "x" }), null);
});

const why = buildWhy(
  { briefs: [node("b", { text: "Why" })], stories: [node("s", { text: "A story" })], requirements: [node("r1", { text: "One" }), node("r2", { text: "Two", status: "accepted" })] },
  [
    { source: "g", target: "b", edge_type: "HAS_BRIEF" },
    { source: "g", target: "s", edge_type: "HAS_STORY" },
    { source: "s", target: "r1", edge_type: "HAS_REQUIREMENT" },
    { source: "s", target: "r2", edge_type: "HAS_REQUIREMENT" },
    { source: "f", target: "r1", edge_type: "SATISFIES" },
  ],
  plan,
);

test("a requirement accepted, dropped or undecided shows at once", () => {
  assert.equal(patchWhy(why, { op: "accept", ref_id: "r1" })!.requirements["r1"]!.status, "accepted");
  assert.equal(patchWhy(why, { op: "drop", ref_id: "r1" })!.requirements["r1"]!.status, "dropped");
  assert.equal(patchWhy(why, { op: "reset", ref_id: "r2" })!.requirements["r2"]!.status, "proposed");
});

test("words on the why sheet change at once, the brief's too", () => {
  assert.equal(patchWhy(why, { op: "edit", ref_id: "s", field: "text", value: "New" })!.stories["s"]!.text, "New");
  assert.equal(patchWhy(why, { op: "edit", ref_id: "b", field: "text", value: "Because" })!.brief["g"], "Because");
});

test("a removed story takes its requirements with it", () => {
  const w = patchWhy(why, { op: "remove", ref_id: "s" })!;
  assert.deepEqual(w.byGoal["g"], []);
  assert.equal(w.requirements["r1"], undefined);
  assert.deepEqual(w.serves["f"], []);
});

const b = buildBrainstorms(
  [node("q", { text: "Which?" }), node("fq", { text: "Then?" })],
  [node("o1", { text: "A" }), node("o2", { text: "B" }), node("o3", { text: "C" })],
  [
    { source: "q", target: "g", edge_type: "ABOUT" },
    { source: "q", target: "o1", edge_type: "PARENT_OF" },
    { source: "q", target: "o2", edge_type: "PARENT_OF" },
    { source: "o2", target: "fq", edge_type: "PARENT_OF" },
    { source: "fq", target: "o3", edge_type: "PARENT_OF" },
  ],
  plan,
);

test("choosing an option decides its question and passes over the others; un-choosing opens them again", () => {
  const chosen = patchBrainstorms(b, { op: "choose", ref_id: "o1" })!;
  assert.equal(chosen.choices["o1"]!.state, "chosen");
  assert.equal(chosen.choices["o2"]!.state, "rejected");
  assert.equal(chosen.asks["q"]!.open, false);
  const back = patchBrainstorms(chosen, { op: "unchoose", ref_id: "o1" })!;
  assert.equal(back.choices["o1"]!.state, "open");
  assert.equal(back.choices["o2"]!.state, "open");
  assert.equal(back.asks["q"]!.open, true);
});

test("a removed option goes with the questions it leads to", () => {
  const r = patchBrainstorms(b, { op: "remove", ref_id: "o2" })!;
  assert.deepEqual(r.asks["q"]!.options, ["o1"]);
  assert.equal(r.asks["fq"], undefined);
  assert.equal(r.choices["o3"], undefined);
  assert.deepEqual(patchBrainstorms(b, { op: "remove", ref_id: "q" })!.byCard["g"], []);
});
