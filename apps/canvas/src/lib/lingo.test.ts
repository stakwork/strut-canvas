import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyLingo, cleanWord, toEntries } from "./lingo";

describe("lingo: the vocabulary's corrections on a transcript line", () => {
  it("reads the vocabulary as corrections: each way a word was heard, written as its form or its name", () => {
    const lexicon = {
      entities: [
        { ref_id: "a", name: "Stakwork", written: ["Stakwork"], heard: [{ ref_id: "m1", value: "stack work", form: null }, { ref_id: "m2", value: "Stackwork" }] },
        // A mishearing of another way the word is written.
        { ref_id: "b", name: "Bitcoin", written: ["Bitcoin", "BTC"], heard: [{ ref_id: "m3", value: "bee tee see", form: "BTC" }] },
        // Turned off for dictation, with no mishearing, with no name: none is a correction.
        { ref_id: "c", name: "Peel", heard: [{ ref_id: "m4", value: "peal", form: null }], dictation_off: true },
        { ref_id: "d", name: "Ada Park", heard: [] },
        { ref_id: "e", heard: [{ value: "x" }] },
      ],
      undone: [],
    };
    assert.deepEqual(toEntries(lexicon), [
      { heard: "stack work", corrected: "Stakwork" },
      { heard: "Stackwork", corrected: "Stakwork" },
      { heard: "bee tee see", corrected: "BTC" },
    ]);
    assert.deepEqual(toEntries(null), []);
    assert.deepEqual(toEntries({ entities: "none" }), []);
  });

  it("replaces a heard word or phrase, whole words only, in any case, the longest first", () => {
    const entries = [
      { heard: "stack", corrected: "Stak" },
      { heard: "stack work", corrected: "Stakwork" },
      { heard: "stadium", corrected: "Stadeum" },
    ];
    const text = (line: string) => applyLingo(line, entries).map((p) => p.text).join("");
    assert.equal(text("We run it on Stack Work and on stadium."), "We run it on Stakwork and on Stadeum.");
    // Not inside a longer word.
    assert.equal(text("The stadiums and the haystack."), "The stadiums and the haystack.");
    const pieces = applyLingo("on stadium now", entries);
    assert.deepEqual(pieces.map((p) => [p.text, p.heard ?? null]), [["on ", null], ["Stadeum", "stadium"], [" now", null]]);
    // Nothing to apply: the line as it is, and a pair that only changes nothing is no correction.
    assert.deepEqual(applyLingo("plain", []), [{ text: "plain" }]);
    assert.deepEqual(applyLingo("Peel it", [{ heard: "peel", corrected: "Peel" }]), [{ text: "Peel it" }]);
  });

  it("takes the word under a right-click without its punctuation", () => {
    assert.equal(cleanWord("stadium,"), "stadium");
    assert.equal(cleanWord("“Stackwork.”"), "Stackwork");
  });
});
