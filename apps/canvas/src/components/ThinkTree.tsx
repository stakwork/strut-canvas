// The brainstorm tree, drawn on the canvas itself: each question hangs off the
// milestone or feature it is about, an opened question's options branch off
// it — the chosen one marked, the ones passed over dimmed, the questions a
// choice leads to hanging under it — so the decisions read as a tree. Every
// change is one `ops` run, as in the rest of the canvas.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
type Sty = { n: TNode; style: CSSProperties };
import type { Brainstorms, TreeNode } from "../lib/brainstorm";
import type { Plan } from "../lib/plan";
import type { ThinkLayout, TNode } from "../lib/thinktree";
import { Editable, type Act } from "./Details";
import { Byline } from "./Byline";
import { Pips } from "./Brainstorm";

const STATE_WORD = { idle: "Not started", prog: "In progress", done: "Done", block: "Blocked" } as const;

interface Props {
  t: ThinkLayout;
  plan: Plan;
  b: Brainstorms;
  trees: Map<string, TreeNode>;
  loading: Set<string>;
  expanded: ReadonlySet<string>;
  folded: ReadonlySet<string>;
  picked: string | null;
  act: Act;
  onToggleAsk: (id: string) => void;
  onToggleFold: (id: string) => void;
  onAsk: (id: string, text: string) => void;
  onSizes: (sizes: Record<string, number>) => void;
}

/** An elbow from the right of one node to the left of another: siblings share one trunk, as in an outline. */
function link(a: TNode, b: TNode): string {
  const x1 = a.x + a.w;
  const y1 = a.y + Math.min(a.h / 2, 30);
  const x2 = b.x;
  const y2 = b.y + Math.min(b.h / 2, 30);
  const m = x1 + Math.min(28, (x2 - x1) / 2);
  const r = Math.min(10, Math.abs(y2 - y1) / 2);
  if (r < 1) return `M${x1},${y1} H${x2}`;
  const s = y2 > y1 ? 1 : -1;
  return `M${x1},${y1} H${m - r} Q${m},${y1} ${m},${y1 + s * r} V${y2 - s * r} Q${m},${y2} ${m + r},${y2} H${x2}`;
}

export function ThinkTree(p: Props) {
  const { t } = p;
  const root = useRef<HTMLDivElement>(null);
  // Measure what drew, so the next layout stacks by real heights.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const next: Record<string, number> = {};
    let changed = false;
    for (const n of el.querySelectorAll<HTMLElement>("[data-tnode]")) {
      const id = n.dataset["tnode"]!;
      const h = n.offsetHeight;
      if (h && Math.abs((t.nodes[id]?.h ?? 0) - h) > 1) {
        next[id] = h;
        changed = true;
      }
    }
    if (changed) p.onSizes(next);
  });
  return (
    <div ref={root} className="bt">
      <svg className="sb-roads bt-links" aria-hidden="true">
        {t.edges.map((e) => {
          const a = t.nodes[e.from];
          const c = t.nodes[e.to];
          return a && c ? <path key={`${e.from}>${e.to}`} className={`bt-l-${e.kind}`} d={link(a, c)} /> : null;
        })}
      </svg>
      {t.order.map((id) => {
        const n = t.nodes[id]!;
        const style = { left: n.x, top: n.y, width: n.w };
        if (n.kind === "ask") return <AskNode key={id} n={n} style={style} {...p} />;
        if (n.kind === "option") return <OptionNode key={id} n={n} style={style} {...p} />;
        return <PlanNode key={id} n={n} style={style} {...p} />;
      })}
    </div>
  );
}

function Tallies({ open, decided }: { open: number; decided: number }) {
  return (
    <span className="bt-tally">
      {open > 0 && <b className="bt-chip bt-chip-open">{open} open</b>}
      {decided > 0 && <b className="bt-chip bt-chip-done">{decided} decided</b>}
      {!open && !decided && <span className="bt-none">no questions</span>}
    </span>
  );
}

function PlanNode({ n, style, plan, t, folded, onToggleFold }: Props & Sty) {
  const c = plan.cards[n.id];
  if (!c) return null;
  const tl = t.tally[n.id] ?? { open: 0, decided: 0 };
  const total = tl.open + tl.decided;
  const isFolded = folded.has(n.id);
  if (n.kind === "goal") {
    return (
      <div data-tnode={n.id} data-id={n.id} className="sb-card sb-goal bt-node bt-goal" style={style}>
        <span className="sb-meta">Initiative · brainstorm · {total} question{total === 1 ? "" : "s"}</span>
        <span className="sb-title">{c.title}</span>
        <Tallies {...tl} />
      </div>
    );
  }
  const word = n.kind === "group" ? "Milestone" : "Feature";
  return (
    <button
      type="button"
      data-tnode={n.id}
      data-id={n.id}
      className={`bt-node bt-plan bt-${n.kind} sb-s-${c.state}${total ? "" : " bt-empty"}`}
      style={style}
      aria-expanded={total ? !isFolded : undefined}
      onClick={() => total && onToggleFold(n.id)}
      title={total ? (isFolded ? "Show its questions" : "Fold its questions away") : "No questions about it yet"}
    >
      <span className="sb-meta">
        <i className={`sb-dot sb-s-${c.state}`} />
        {word} · {STATE_WORD[c.state]}
      </span>
      <span className="sb-title">{c.title}</span>
      <span className="bt-row">
        <Tallies {...tl} />
        {total > 0 && <span className="bt-fold">{isFolded ? `▸ show ${total}` : "▾"}</span>}
      </span>
    </button>
  );
}

function AskNode({ n, style, b, picked, expanded, loading, act, onToggleAsk, onAsk }: Props & Sty) {
  const q = b.asks[n.id]!;
  const open = expanded.has(n.id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const chosen = q.options.map((c) => b.choices[c]).find((c) => c?.state === "chosen");
  const follow = !q.root;
  const note = q.hand && !q.options.length;
  return (
    <div data-tnode={n.id} data-id={n.id} className={`bt-node bt-ask ${q.open ? "bt-open" : "bt-decided"}${follow ? " bt-follow" : ""}${q.hand ? " ic-person" : ""}${picked === n.id ? " sb-on" : ""}`} style={style}>
      <button type="button" className="bt-head" aria-expanded={open} onClick={() => onToggleAsk(n.id)}>
        <span className="sb-meta">
          <i className={`bt-flag ${q.open ? "bt-flag-open" : "bt-flag-done"}`} />
          {follow ? "Follow-up · " : note ? "Note · " : "Question · "}
          {q.open ? "Open" : "Decided"}
          {q.options.length > 0 && ` · ${q.options.length} option${q.options.length === 1 ? "" : "s"}`}
        </span>
        {!editing && <span className={`bt-q${q.hand ? " ic-hand" : ""}`}>{q.text}</span>}
        {chosen && (
          <span className="bt-chosen-line">
            ✓ <span>{chosen.text}</span>
          </span>
        )}
        <span className="bt-row">
          <Byline author={q.author} prefix="" className="bt-by" />
          <span className="bt-fold">{q.options.length ? (open ? "▾ hide options" : `▸ ${q.options.length} option${q.options.length === 1 ? "" : "s"}`) : open ? "▾" : "▸ add options"}</span>
        </span>
      </button>
      {editing && <Editable hand={q.hand} long className="sb-edit-title" label="Question" value={q.text} placeholder="Untitled question" onSave={(text) => (setEditing(false), text && text !== q.text && void act({ op: "edit", ref_id: q.id, field: "text", value: text }, "Saving the question"))} />}
      {open && (
        <div className="bt-tools">
          {loading.has(n.id) && <span className="bt-none">Reading options…</span>}
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
                if (text) void act({ op: "add_option", parent: q.id, text }, "Adding your option");
              }}
            />
          ) : (
            <span className="sb-row-btns">
              <button type="button" className="sb-btn sb-small" onClick={() => setAdding(true)}>
                + Option
              </button>
              <button type="button" className="sb-btn sb-small" onClick={() => onAsk(q.id, "Help me decide this question: lay out the options and what each leads to.")}>
                Think it through with Jamie
              </button>
              <button type="button" className="sb-btn sb-small" onClick={() => setEditing(true)}>
                Rewrite
              </button>
              <button type="button" className="sb-btn sb-small" onClick={() => void act({ op: "remove", ref_id: q.id, reason: "removed from the canvas" }, "Removing the brainstorm")}>
                Remove
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function OptionNode({ n, style, b, trees, act }: Props & Sty) {
  const o = b.choices[n.id]!;
  const d = trees.get(n.id);
  const pros = (d?.effects ?? []).filter((e) => e.direction === "pro");
  const cons = (d?.effects ?? []).filter((e) => e.direction !== "pro");
  const pencil = o.by !== "person" && o.state === "open";
  return (
    <div data-tnode={n.id} data-id={n.id} className={`bt-node bt-opt bt-opt-${o.state}${pencil ? " bt-pencil" : ""}`} style={style}>
      {o.state === "chosen" && <span className="bt-stamp">✓ Chosen</span>}
      <strong className={o.hand ? "ic-hand" : ""}>
        {d?.label ? <b className="ic-letter">{d.label}</b> : null}
        {o.text}
      </strong>
      {d?.ratings && (
        <span className="ic-rate">
          <Pips label="Fast" score={d.ratings.fast} />
          <Pips label="Good" score={d.ratings.good} />
          <Pips label="Cheap" score={d.ratings.cheap} />
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
      <span className="bt-row">
        <small className="bt-state">
          {o.state === "chosen" ? "Chosen" : o.state === "rejected" ? "Not chosen" : "Open"}
          {o.asks.length > 0 && ` · leads to ${o.asks.length} question${o.asks.length === 1 ? "" : "s"}`}
        </small>
        <Byline author={o.author} className="bt-by" />
      </span>
      <span className="sb-row-btns">
        {o.state === "chosen" ? (
          <button type="button" className="sb-btn sb-small" onClick={() => void act({ op: "unchoose", ref_id: o.id, reason: "changed my mind" }, "Un-choosing")}>
            Un-choose
          </button>
        ) : (
          <button type="button" className="sb-btn sb-small bt-choose" onClick={() => void act({ op: "choose", ref_id: o.id }, "Choosing")}>
            Choose this
          </button>
        )}
      </span>
    </div>
  );
}
