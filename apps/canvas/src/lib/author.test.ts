import { test } from "node:test";
import assert from "node:assert/strict";
import { authorName, authorOf, parseActor } from "./author.ts";

test("a stamp that only says 'a person' names no one", () => {
  assert.deepEqual(parseActor("human"), {});
  assert.deepEqual(parseActor("ada"), { login: "ada" });
});

test("a person's plan card shows who wrote it", () => {
  assert.equal(authorName(authorOf({ created_by_kind: "human", author: "ada" })), "ada");
  assert.equal(authorName(authorOf({ created_by_kind: "human", author: "human" })), "a person");
});

test("an agent's card shows Jamie (or Strut)", () => {
  assert.equal(authorName(authorOf({ created_by_kind: "jamie", author: "jamie" })), "Jamie");
  assert.equal(authorName(authorOf({ created_by_kind: "strut" })), "Strut");
});

test("brainstorm cards: made_by wins over who wrote the card", () => {
  assert.equal(authorName(authorOf({ made_by: "user", by: "ada", author: "jamie" })), "ada");
  assert.equal(authorName(authorOf({ made_by: "model", author: "jamie" })), "Jamie");
});

test("a person's words said on a call show who said them, not who ran the job", () => {
  assert.equal(authorName(authorOf({ made_by: "user", by: "evan", speaker: "Cleo" })), "Cleo");
  assert.equal(authorName(authorOf({ made_by: "user", by: "evan", speaker: " " })), "evan");
});

test("no stamp: nothing to say", () => {
  assert.equal(authorName(authorOf({})), null);
});
