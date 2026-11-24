// The home map's opening ring: the most recently active goals, drafts included, tests left out.
// Run: node --experimental-strip-types --test src/lib/plan.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, lastActivity, openingGoals, timeOf, type RawEdge, type RawNode } from "./plan.ts";
import { CARD_W, homeMap, toEdge } from "./map.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-01T00:00:00Z");
const goal = (id: string, name: string, status: string, at: number, extra: Record<string, unknown> = {}): RawNode => ({ ref_id: id, name, properties: { name, status, date_added_to_graph: at, ...extra } });

const goals: RawNode[] = [
  goal("old-active", "Old active", "ACTIVE", T0 - 30 * DAY),
  goal("a2", "Active two", "ACTIVE", T0 - 20 * DAY),
  goal("a3", "Active three", "ACTIVE", T0 - 19 * DAY),
  goal("a4", "Active four", "ACTIVE", T0 - 18 * DAY),
  goal("a5", "Active five", "ACTIVE", T0 - 17 * DAY),
  // A new draft: written today, ISO created_at, nothing under it.
  goal("draft", "Stakwork Human Tasks", "planned", 0, { created_at: new Date(T0).toISOString() }),
  // An old goal whose feature moved yesterday: its activity is the feature's.
  goal("busy", "Busy old", "ACTIVE", T0 - 60 * DAY),
  // A check's test goal, newest of all: never on the ring.
  goal("test", "IC v62 check (safe to delete)", "planned", T0 + DAY),
];
const groups: RawNode[] = [{ ref_id: "m", name: "M", properties: { status: "active", date_added_to_graph: T0 - 60 * DAY } }];
const work: RawNode[] = [{ ref_id: "f", name: "F", properties: { status: "active", date_added_to_graph: T0 - 60 * DAY, updated_at: T0 - DAY } }];
const edges: RawEdge[] = [
  { source: "busy", target: "m", edge_type: "HAS_MILESTONE" },
  { source: "m", target: "f", edge_type: "HAS_FEATURE" },
];
const plan = buildPlan({ goal: goals, group: groups, work }, edges);

test("times come as epoch ms, epoch seconds or ISO strings", () => {
  assert.equal(timeOf(T0), T0);
  assert.equal(timeOf(T0 / 1000), T0);
  assert.equal(timeOf(new Date(T0).toISOString()), T0);
  assert.equal(timeOf("not a date"), 0);
});

test("a goal's activity is the latest time of anything under it", () => {
  assert.equal(lastActivity(plan, "busy"), T0 - DAY);
});

test("the ring is the 5 most recent goals, drafts included, tests left out, newest first", () => {
  assert.deepEqual(openingGoals(plan), ["draft", "busy", "a5", "a4", "a3"]);
});

test("the ring is one ring in that order, and a draft keeps its draft state", () => {
  const ring = openingGoals(plan);
  const map = homeMap(plan, ring, true);
  assert.equal(map.rings.length, 1);
  assert.deepEqual(Object.keys(map.spots), ring);
  // The newest sits at the top of the ring.
  assert.ok(map.spots["draft"]!.y < map.spots["a5"]!.y);
  assert.equal(plan.cards["draft"]!.state, "idle");
});

test("a road on the home map ends at its card's edge, not under it", () => {
  assert.deepEqual(toEdge({ x: 0, y: 0 }, { x: 0, y: 400 }), { x: 0, y: 346 });
  assert.deepEqual(toEdge({ x: 0, y: 0 }, { x: 600, y: 0 }), { x: 600 - CARD_W / 2, y: 0 });
  const p = buildPlan({ goal: [goal("x", "X", "ACTIVE", T0), goal("y", "Y", "ACTIVE", T0)], group: [], work: [] }, []);
  for (const r of homeMap(p, ["x", "y"], true).roads) {
    const spot = Object.values(homeMap(p, ["x", "y"], true).spots).find((s) => Math.abs(s.x + CARD_W / 2 - r.b.x) <= CARD_W / 2 + 1 && Math.abs(s.y + 56 - r.b.y) <= 57);
    assert.ok(spot, `road end ${JSON.stringify(r.b)} is on a card's edge`);
  }
});
