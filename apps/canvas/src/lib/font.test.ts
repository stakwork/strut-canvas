import { test } from "node:test";
import assert from "node:assert/strict";
import { fontOf } from "./font.ts";

test("plan cards are printed whoever wrote them", () => {
  for (const by of ["person", "agent", null] as const) assert.equal(fontOf("plan", by), "print");
});

test("a sticky is handwritten only when a person wrote it", () => {
  assert.equal(fontOf("sticky", "person"), "hand");
  assert.equal(fontOf("sticky", "agent"), "print");
  assert.equal(fontOf("sticky", null), "print");
});

test("chat is never handwritten", () => {
  for (const by of ["person", "agent", null] as const) assert.equal(fontOf("chat", by), "print");
});
