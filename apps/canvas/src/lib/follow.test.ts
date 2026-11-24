import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsOn, shownAs } from "./follow.ts";
import type { Plan } from "./plan.ts";
import type { Brainstorms } from "./brainstorm.ts";

const plan = { cards: { g: { id: "g", role: "goal" }, f: { id: "f", role: "work" }, p: { id: "p", role: "work", pencil: { proposalId: "x" } } } } as unknown as Plan;
const b = { asks: { q: { id: "q", options: ["o1", "o2"] } }, choices: { o1: { id: "o1" }, o2: { id: "o2" } }, byCard: {} } as unknown as Brainstorms;

test("a written ref is shown as its card, its question, or the question its option answers", () => {
  assert.equal(shownAs("f", plan, b), "f");
  assert.equal(shownAs("q", plan, b), "q");
  assert.equal(shownAs("o2", plan, b), "q");
  // Not on the canvas yet (the plan is read again a few seconds after a write), or only proposed.
  assert.equal(shownAs("new", plan, b), null);
  assert.equal(shownAs("p", plan, b), null);
});

test("the cards a read has: plan cards, questions and options, not proposals", () => {
  assert.deepEqual([...cardsOn(plan, b)].sort(), ["f", "g", "o1", "o2", "q"]);
});
