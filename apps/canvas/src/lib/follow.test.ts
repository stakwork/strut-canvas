import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLLOWING, cardsOn, chosenOn, follow, shownAs, watchLooking, whyPlace, type FollowEvent } from "./follow.ts";
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

const run = (...events: FollowEvent[]) => events.reduce(follow, FOLLOWING);

test("following, each card written is brought to the middle", () => {
  assert.deepEqual(run({ wrote: "a" }, { wrote: "b" }), { on: true, newest: "b", target: { id: "b", n: 2 } });
});

test("a person looking around is not moved to new cards; Follow goes to the newest", () => {
  const looked = run({ wrote: "a" }, "look", { wrote: "b" }, { wrote: "c" });
  assert.deepEqual(looked, { on: false, newest: "c", target: { id: "a", n: 1 } });
  assert.deepEqual(follow(looked, "follow"), { on: true, newest: "c", target: { id: "c", n: 2 } });
  // Back on the card it was last at, when nothing new came: a new `n` still moves the camera there.
  assert.deepEqual(run({ wrote: "a" }, "look", "follow"), { on: true, newest: "a", target: { id: "a", n: 2 } });
  // Nothing written yet: following again, nowhere to go.
  assert.deepEqual(run("look", "follow"), FOLLOWING);
});

test("looking again, or following while following, changes nothing", () => {
  const looked = run({ wrote: "a" }, "look");
  assert.equal(follow(looked, "look"), looked);
  const on = run({ wrote: "a" });
  assert.equal(follow(on, "follow"), on);
});

/** A page watched for a person looking around, with what is under the pointer. */
function watched(under: "desk" | "card" | "follow") {
  class Page extends EventTarget {
    closest(sel: string) {
      if (under === "follow") return sel.includes("button") || sel.includes(".sb-follow") ? this : null;
      return under === "card" && sel.includes("button") ? this : null;
    }
  }
  const page = new Page();
  let looks = 0;
  const stop = watchLooking(page, () => looks++);
  const fire = (type: string, at: Record<string, number> = {}) => page.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX: 0, clientY: 0, ...at }));
  return { fire, stop, looks: () => looks };
}

test("a drag, a wheel or a press on a card is looking around; a still press on the desk is not", () => {
  const desk = watched("desk");
  desk.fire("pointerdown");
  desk.fire("pointermove", { clientX: 2 });
  desk.fire("pointerup");
  desk.fire("click");
  assert.equal(desk.looks(), 0);
  // Moving the pointer without pressing is not a drag.
  desk.fire("pointermove", { clientX: 40 });
  assert.equal(desk.looks(), 0);
  desk.fire("pointerdown");
  desk.fire("pointermove", { clientX: 30, clientY: 10 });
  desk.fire("pointermove", { clientX: 60, clientY: 10 });
  assert.equal(desk.looks(), 1);
  desk.fire("wheel");
  assert.equal(desk.looks(), 2);
  desk.stop();
  desk.fire("wheel");
  assert.equal(desk.looks(), 2);

  const card = watched("card");
  card.fire("click");
  assert.equal(card.looks(), 1);
});

test("pressing Follow is not looking around", () => {
  const f = watched("follow");
  f.fire("pointerdown");
  f.fire("pointermove", { clientX: 30 });
  f.fire("click");
  f.fire("wheel");
  assert.equal(f.looks(), 0);
});
