// A brainstorm, whole: the question, its lettered options with their
// fast / good / cheap ratings and the pros and cons weighed for each, which
// one was chosen, and the questions an option leads to. A person chooses (or
// un-chooses) an option, adds their own options, rewrites a question, and
// removes the brainstorm — each one `ops` run. What a person wrote is
// in their hand; an agent's option nobody chose is in pencil.
import { useState } from "react";
import { pips, type Ask, type Brainstorms, type TreeNode } from "../lib/brainstorm";
import type { Plan } from "../lib/plan";
import { useTree } from "../lib/read";
import { Editable, type Act } from "./Details";
import { authorName } from "../lib/author";
import { Byline } from "./Byline";


export function Pips({ label, score }: { label: string; score: number | undefined }) {
  const n = pips(score);
  if (!n) return null;
  return (
    <span className="ic-pips" title={`${label}: ${n} of 3`}>
      {label}{" "}
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= n ? "on" : ""} />
      ))}
    </span>
  );
}

export function BrainstormPanel({ ask, b, plan, act, onShow, onAsk }: { ask: Ask; b: Brainstorms; plan: Plan; act: Act; onShow: (id: string) => void; onAsk: (text: string) => void }) {
  const tree = useTree(ask.id).data;
  const [adding, setAdding] = useState(false);
  const byRef = new Map<string, TreeNode>((tree?.nodes ?? []).map((n) => [n.ref_id, n]));
  const about = ask.about ? plan.cards[ask.about] : undefined;
  return (
    <>
      <span className="sb-meta">
        Question · {ask.open ? "Open" : "Decided"}
        {authorName(ask.author) ? <> · <Byline author={ask.author} prefix="asked by " /></> : ""}
      </span>
      <Editable hand={ask.hand} long className="sb-edit-title" label="Question" value={ask.text} placeholder="Untitled question" onSave={(text) => text && void act({ op: "edit", ref_id: ask.id, field: "text", value: text }, "Saving the question")} />
      {about && (
        <p>
          About {about.role === "goal" ? "the initiative" : about.role === "group" ? "the milestone" : "the feature"}{" "}
          <button type="button" className="sb-link" onClick={() => onShow(about.id)}>
            {about.title}
          </button>
        </p>
      )}
      <span className="sb-meta">Options · {ask.options.length}</span>
      {!ask.options.length && <p>No options yet.</p>}
      <ul className="sb-opts">
        {ask.options.map((id) => {
          const o = b.choices[id]!;
          const t = byRef.get(id);
          const pros = (t?.effects ?? []).filter((e) => e.direction === "pro");
          const cons = (t?.effects ?? []).filter((e) => e.direction !== "pro");
          const pencil = o.by !== "person" && o.state === "open";
          return (
            <li key={id} className={`sb-opt sb-opt-${o.state}${pencil ? " sb-pencil-box" : ""}`}>
              <strong className={o.hand ? "ic-hand" : ""}>
                {t?.label ? <b className="ic-letter">{t.label}</b> : null}
                {o.text}
              </strong>
              {t?.ratings && (
                <span className="ic-rate">
                  <Pips label="Fast" score={t.ratings.fast} />
                  <Pips label="Good" score={t.ratings.good} />
                  <Pips label="Cheap" score={t.ratings.cheap} />
                </span>
              )}
              {(pros.length > 0 || cons.length > 0) && (
                <ul className="ic-effects">
                  {pros.map((e, i) => (
                    <li key={`p${i}`} title={e.description}>
                      + {e.name}
                    </li>
                  ))}
                  {cons.map((e, i) => (
                    <li key={`c${i}`} className="ic-con" title={e.description}>
                      − {e.name}
                    </li>
                  ))}
                </ul>
              )}
              <small>
                {o.state === "chosen" ? "Chosen" : o.state === "rejected" ? "Not chosen" : "Open"}
                {authorName(o.author) ? <> · <Byline author={o.author} /></> : ""}
              </small>
              {o.asks.map((q) => (
                <button key={q} type="button" className="sb-link sb-quiet" onClick={() => onShow(q)}>
                  Leads to: {b.asks[q]?.text}
                </button>
              ))}
              <span className="sb-row-btns">
                {o.state === "chosen" ? (
                  <button type="button" className="sb-btn sb-small" onClick={() => void act({ op: "unchoose", ref_id: id, reason: "changed my mind" }, "Un-choosing")}>
                    Un-choose
                  </button>
                ) : (
                  <button type="button" className="sb-btn sb-small" onClick={() => void act({ op: "choose", ref_id: id }, "Choosing")}>
                    Choose this
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {adding ? (
        <Editable
          hand
          long
          className="sb-edit-text"
          label="Your option"
          value=""
          placeholder="Your option"
          onSave={(text) => {
            setAdding(false);
            if (text) void act({ op: "add_option", parent: ask.id, text }, "Adding your option");
          }}
        />
      ) : (
        <span className="sb-row-btns">
          <button type="button" className="sb-btn sb-small" onClick={() => setAdding(true)}>
            + Add an option
          </button>
          <button type="button" className="sb-btn sb-small" onClick={() => onAsk("Help me decide this question: lay out the options and what each leads to.")}>
            Work through it with Jamie
          </button>
          <button type="button" className="sb-btn sb-small" onClick={() => void act({ op: "remove", ref_id: ask.id, reason: "removed from the canvas" }, "Removing the brainstorm")}>
            Remove
          </button>
        </span>
      )}
    </>
  );
}
