// The Why sheet: one piece of paper beside a goal's map. Top to bottom it
// reads why (the brief), who it is for (the stories) and what must be true
// (each story's requirements). Picking a story or a requirement lights the
// work that answers it on the map, and a thread runs to each (App draws
// them, from the element marked `data-thread`); picking work on the map
// lights what it is for here. A person rewrites any of it in place, accepts
// or drops a requirement, and adds stories and requirements — each one
// `ops` run. What an agent wrote and nobody accepted is in pencil.
import { useState } from "react";
import type { Plan } from "../lib/plan";
import { fontOf } from "../lib/font";
import { Byline } from "./Byline";
import { parseStory, workFor, type Why } from "../lib/why";
import { Editable, type Act } from "./Details";

export interface Trace {
  story: string | null;
  requirement: string | null;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A one-line box to add something under a card, shown on press. */
function AddLine({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="sb-link sb-quiet sb-add" onClick={() => setOpen(true)}>
        + {label}
      </button>
    );
  return (
    <Editable
      long
      className="sb-edit-text sb-add"
      label={label}
      value=""
      placeholder={placeholder}
      onSave={(t) => {
        setOpen(false);
        if (t) onAdd(t);
      }}
    />
  );
}

export function WhySheet({
  plan,
  why,
  goal,
  trace,
  onTrace,
  serving,
  onClose,
  onScroll,
  act,
}: {
  plan: Plan;
  why: Why;
  goal: string;
  trace: Trace;
  onTrace: (t: Trace) => void;
  /** The requirements the work picked on the map answers; null when none is picked. */
  serving: Set<string> | null;
  onClose: () => void;
  onScroll: () => void;
  act: Act;
}) {
  const [whole, setWhole] = useState(false);
  const brief = why.brief[goal] ?? "";
  const briefId = why.briefId[goal];
  const stories = why.byGoal[goal] ?? [];
  return (
    <aside className={`sb-why${serving ? " sb-why-rev" : ""}`} onScroll={onScroll} data-testid="ic-why">
      <header className="sb-why-head">
        <span className="sb-meta">Why</span>
        <button type="button" className="sb-btn" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <h2>{plan.cards[goal]!.title}</h2>
      </header>
      {briefId ? (
        <>
          <div className={`sb-brief${whole ? "" : " sb-clamp"}`}>
            <Editable long className="sb-edit-text" label="Brief" value={brief} placeholder="Write the brief" onSave={(text) => text && void act({ op: "edit", ref_id: briefId, field: "text", value: text }, "Saving the brief")} />
          </div>
          {brief.length > 280 && (
            <button type="button" className="sb-link sb-quiet" onClick={() => setWhole((v) => !v)}>
              {whole ? "Show less" : "Read the whole brief"}
            </button>
          )}
        </>
      ) : (
        <div className="sb-brief">
          <AddLine label="Write the brief" placeholder="Why this initiative exists" onAdd={(text) => void act({ op: "add", kind: "brief", parent: goal, text }, "Adding the brief")} />
        </div>
      )}
      <span className="sb-meta sb-why-sec">Who it is for · {count(stories.length, "story", "stories")}</span>
      {stories.map((id) => {
        const s = why.stories[id]!;
        const parts = parseStory(s.text);
        const work = workFor(why, id).length;
        const bare = s.requirements.filter((r) => !why.answers[r]?.length).length;
        const lit = !!serving && s.requirements.some((r) => serving.has(r));
        const open = serving ? lit : trace.story === id;
        const from = open && !serving && !trace.requirement;
        const pencil = s.status !== "accepted" && s.by !== "person";
        return (
          <div key={id} className={`sb-story${open ? " sb-open" : ""}${lit ? " sb-story-lit" : ""}${pencil ? " sb-pencil" : ""}${fontOf("plan", s.by) === "hand" ? " ic-person" : ""}`}>
            <button type="button" className="sb-story-head" aria-expanded={open} {...(from ? { "data-thread": "from" } : {})} onClick={() => onTrace({ story: id, requirement: null })}>
              {parts ? (
                <>
                  <span className="sb-who">As {/^[aeiou]/i.test(parts.who) ? "an" : "a"} {parts.who}</span>
                  <span className="sb-want">{parts.want}</span>
                  {parts.why && <span className="sb-sothat">so that {parts.why}</span>}
                </>
              ) : (
                <span className="sb-want">{s.text || "A story with no words yet"}</span>
              )}
              <span className="sb-cov">
                <span>{count(s.requirements.length, "requirement")}</span>
                {work ? <span>{count(work, "feature")}</span> : <span className="sb-need">no feature answers it yet</span>}
                {work > 0 && bare > 0 && <span className="sb-need">{bare} not answered</span>}
                {s.status !== "accepted" && <span>{s.status}</span>}
                <Byline author={s.author} />
              </span>
            </button>
            {open && (
              <div className="sb-story-tools">
                <Editable long className="sb-edit-text" label="Story" value={s.text} placeholder="As a …, I want …, so that …" onSave={(text) => text && void act({ op: "edit", ref_id: id, field: "text", value: text }, "Saving the story")} />
                <button type="button" className="sb-link sb-quiet" onClick={() => void act({ op: "remove", ref_id: id }, "Removing the story")}>
                  Delete story
                </button>
              </div>
            )}
            {open && (
              <ul className="sb-reqs">
                {s.requirements.map((r) => {
                  const q = why.requirements[r]!;
                  const n = why.answers[r]?.length ?? 0;
                  const on = serving ? serving.has(r) : trace.requirement === r;
                  const rp = q.status === "proposed" && q.by !== "person";
                  return (
                    <li key={r} className={q.status === "dropped" ? "sb-dropped" : ""}>
                      <button type="button" className={`sb-req${on ? " sb-req-on" : ""}${rp ? " sb-pencil" : ""}`} {...(on ? { "data-thread": "from" } : {})} onClick={() => onTrace({ story: id, requirement: trace.requirement === r && !serving ? null : r })}>
                        <i className={`sb-dot${q.status === "accepted" ? " sb-s-done" : ""}`} />
                        <span className={`sb-req-text${fontOf("plan", q.by) === "hand" ? " ic-hand" : ""}`}>{q.text}</span>
                        <small>
                          <span>{q.status}</span>
                          {n ? <span>{count(n, "feature")}</span> : <span className="sb-need">no feature answers this yet</span>}
                          <Byline author={q.author} />
                        </small>
                      </button>
                      {on && !serving && (
                        <div className="sb-req-tools">
                          <Editable long className="sb-edit-text" label="Requirement" value={q.text} placeholder="What must be true" onSave={(text) => text && void act({ op: "edit", ref_id: r, field: "text", value: text }, "Saving the requirement")} />
                          <span className="sb-row-btns">
                            {q.status !== "accepted" && (
                              <button type="button" className="sb-btn sb-small" onClick={() => void act({ op: "accept", ref_id: r }, "Accepting")}>
                                Accept
                              </button>
                            )}
                            {q.status !== "dropped" && (
                              <button type="button" className="sb-btn sb-small" onClick={() => void act({ op: "drop", ref_id: r }, "Dropping")}>
                                Drop
                              </button>
                            )}
                            {q.status !== "proposed" && (
                              <button type="button" className="sb-btn sb-small" onClick={() => void act({ op: "reset", ref_id: r }, "Back to proposed")}>
                                Undecide
                              </button>
                            )}
                            <button type="button" className="sb-btn sb-small" onClick={() => void act({ op: "remove", ref_id: r }, "Removing the requirement")}>
                              Delete
                            </button>
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
                {!s.requirements.length && <li className="sb-quiet">No requirements written yet.</li>}
                <li>
                  <AddLine label="Add requirement" placeholder="What must be true" onAdd={(text) => void act({ op: "add", kind: "requirement", parent: id, text }, "Adding the requirement")} />
                </li>
              </ul>
            )}
          </div>
        );
      })}
      {!stories.length && <p className="sb-brief">No stories have been written for this yet. Add one, or ask Jamie to write them.</p>}
      <div className="sb-why-foot">
        <AddLine label="Add story" placeholder="As a …, I want …, so that …" onAdd={(text) => void act({ op: "add", kind: "story", parent: goal, text }, "Adding the story")} />
      </div>
    </aside>
  );
}
