import { test } from "node:test";
import assert from "node:assert/strict";
import { bump, FEED_TYPES, readsTouched } from "./feed.ts";

test("one feed follows every type the canvas draws", () => {
  for (const t of ["Initiative", "Milestone", "Feature", "Question", "Option", "Effect", "Brief", "UserStory", "Requirement", "Architecture"]) assert.ok(FEED_TYPES.includes(t), t);
});

test("a node write touches the read that shows its type", () => {
  assert.deepEqual([...readsTouched([{ node_type: "Milestone" }])], ["plan"]);
  assert.deepEqual([...readsTouched([{ node_type: "option" }])], ["brainstorm"]);
  assert.deepEqual([...readsTouched([{ node_type: "Requirement" }, { node_type: "Feature" }])].sort(), ["plan", "why"]);
});

test("an edge touches the reads of both its ends", () => {
  assert.deepEqual([...readsTouched([{ types: ["Feature", "Requirement"] }])].sort(), ["plan", "why"]);
  assert.deepEqual([...readsTouched([{ types: ["Question", "Initiative"] }])].sort(), ["brainstorm", "plan"]);
});

test("a batch that names no type touches every read", () => {
  assert.deepEqual([...readsTouched([])].sort(), ["brainstorm", "plan", "why"]);
  assert.deepEqual([...readsTouched([{ node_type: "Feature" }, {}])].sort(), ["brainstorm", "plan", "why"]);
});

test("bump moves only the touched counters", () => {
  assert.deepEqual(bump({ plan: 1, brainstorm: 0, why: 2 }, new Set(["plan", "why"] as const)), { plan: 2, brainstorm: 0, why: 3 });
});
