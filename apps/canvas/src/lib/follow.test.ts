import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsOn, chosenOn, shownAs, whyPlace } from "./follow.ts";
import type { Why } from "./why.ts";
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

test("a choice is shown as the question it decides", () => {
  assert.deepEqual([...chosenOn(b)], []);
  const decided = { ...b, choices: { o1: { id: "o1", state: "rejected" }, o2: { id: "o2", state: "chosen" } } } as unknown as Brainstorms;
  assert.deepEqual([...chosenOn(decided)], ["o2"]);
  assert.equal(shownAs("o2", plan, decided), "q");
});

const why = {
  brief: { g: "Why" },
  briefId: { g: "br" },
  stories: { s: { id: "s", requirements: ["r"] } },
  requirements: { r: { id: "r", story: "s" } },
  byGoal: { g: ["s"] },
  answers: {},
  serves: {},
  architecture: {},
} as unknown as Why;

test("a brief, story or requirement a call writes is shown on its initiative's Why sheet", () => {
  assert.equal(shownAs("r", plan, b, why), "r");
  assert.equal(shownAs("br", plan, b, why), "br");
  assert.ok(cardsOn(plan, b, why).has("s"));
  assert.deepEqual(whyPlace("r", why), { goal: "g", story: "s", requirement: "r" });
  assert.deepEqual(whyPlace("s", why), { goal: "g", story: "s", requirement: null });
  assert.deepEqual(whyPlace("br", why), { goal: "g", story: null, requirement: null });
  assert.equal(whyPlace("f", why), null);
});
