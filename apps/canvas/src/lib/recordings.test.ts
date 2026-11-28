import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { firstName, lengthOf, namesOf, sectionsOf, toRecording, toRecordings, unsettled } from "./recordings";

const T = Date.parse("2026-11-27T15:02:00Z");
const iso = (min: number) => new Date(T + min * 60_000).toISOString();

describe("a recorded call, as the Calls page lists it", () => {
  it("takes the step's answer: the summary's title, the first line's time, who spoke", () => {
    const c = toRecording({
      job: "call-a1",
      title: "Call, 27 Nov 15:02",
      createdAt: iso(-1),
      startedAt: iso(0),
      endedAt: iso(12),
      busy: false,
      done: true,
      lines: 40,
      people: [{ name: "Ada Park", identity: "box_ada" }, { name: " " }, { name: "Ben Ortiz" }],
      summary: { title: "Checklist first", discussed: ["A", " "], decided: [], actions: [{ who: "Ben", items: ["Emails"] }, { who: "Ada", items: [] }], open: ["Pricing?"] },
    })!;
    assert.equal(c.title, "Checklist first");
    assert.equal(c.at, T);
    assert.equal(c.endedAt, T + 12 * 60_000);
    assert.deepEqual(c.people, [{ name: "Ada Park", identity: "box_ada" }, { name: "Ben Ortiz" }]);
    assert.deepEqual(c.summary, { title: "Checklist first", discussed: ["A"], decided: [], actions: [{ who: "Ben", items: ["Emails"] }], open: ["Pricing?"] });
  });

  it("reads a call recorded before its facts were kept: over unless a scribe turn runs, timed by its job", () => {
    const old = toRecording({ job: "call-old", title: "Call notes", usedAt: iso(5), busy: false })!;
    assert.deepEqual([old.done, old.at, old.endedAt, old.lines, old.summary, old.people.length], [true, T + 5 * 60_000, 0, null, null, 0]);
    assert.equal(toRecording({ job: "call-live", busy: true })!.done, false);
    assert.equal(toRecording({ job: "call-live", busy: true })!.title, "A call");
    // A summary with no title is no summary; a job that is not a call is not listed.
    assert.equal(toRecording({ job: "call-x", summary: { title: " ", discussed: ["A"] } })!.summary, null);
    assert.equal(toRecording({ job: "job-1", title: "A build" }), null);
  });

  it("lists the newest first", () => {
    const got = toRecordings([{ job: "call-1", startedAt: iso(0) }, { job: "job-2" }, { job: "call-3", createdAt: iso(60) }, null]);
    assert.deepEqual(got.map((c) => c.job), ["call-3", "call-1"]);
  });

  it("says how long it ran", () => {
    const run = (min: number) => lengthOf({ at: T, endedAt: T + min * 60_000 });
    assert.deepEqual([run(0.2), run(1), run(12.4), run(60), run(65), run(125)], ["under a minute", "1 min", "12 min", "1 h", "1 h 5 min", "2 h 5 min"]);
    assert.equal(lengthOf({ at: T, endedAt: 0 }), "");
    assert.equal(lengthOf({ at: 0, endedAt: T }), "");
  });

  it("names who spoke in one line", () => {
    assert.equal(firstName("Ada Lovelace"), "Ada");
    assert.equal(firstName("evan_feenstra"), "evan");
    const people = ["Ada Park", "Ben Ortiz", "Cy Young", "Di Lee", "Ada Stone"].map((name) => ({ name }));
    assert.equal(namesOf(people.slice(0, 2)), "Ada, Ben");
    // Two Adas are one name; four names is one more than the line holds.
    assert.equal(namesOf(people), "Ada, Ben, Cy and 1 more");
    assert.equal(namesOf([]), "");
  });

  it("shows only the lists of a summary that say something", () => {
    const s = { title: "T", discussed: ["A"], decided: [], actions: [], open: ["Q"] };
    assert.deepEqual(sectionsOf(s).map((x) => [x.title, x.points]), [["Discussed", ["A"]], ["Open questions", ["Q"]]]);
  });

  it("keeps asking about a call that records, or that just stopped with no summary yet", () => {
    const base = toRecording({ job: "call-1", startedAt: iso(0), endedAt: iso(10), done: true })!;
    assert.equal(unsettled({ ...base, done: false }, T), true);
    assert.equal(unsettled(base, T + 11 * 60_000), true);
    assert.equal(unsettled(base, T + 20 * 60_000), false);
    assert.equal(unsettled({ ...base, summary: { title: "T", discussed: [], decided: [], actions: [], open: [] } }, T + 11 * 60_000), false);
  });
});
