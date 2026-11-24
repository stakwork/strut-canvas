// ⌘K: find any card by its words; Enter goes to it.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Brainstorms } from "../lib/brainstorm";
import type { Plan } from "../lib/plan";
import { KIND_WORD, search, type Hit } from "../lib/search";
import type { Why } from "../lib/why";

export function Palette({ plan, why, b, close, pick }: { plan: Plan; why?: Why | null; b?: Brainstorms | null; close: () => void; pick: (hit: Hit) => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => search(q, plan, why, b), [q, plan, why, b]);
  const flat = groups.flatMap((g) => g.hits);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  let i = -1;
  return (
    <div className="sb-menu ic-palette" data-palette onPointerDown={(e) => e.stopPropagation()}>
      <input
        autoFocus
        className="ic-palette-input"
        value={q}
        placeholder="Find an initiative, milestone, feature, question, story or requirement…"
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(close, 150)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(flat.length - 1, a + 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          if (e.key === "Enter" && flat[active]) pick(flat[active]!);
          if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) (e.preventDefault(), close());
        }}
      />
      <div ref={list} className="ic-palette-list">
        {groups.map((g) => (
          <div key={g.kind} className="sb-group-list">
            <h4>{KIND_WORD[g.kind]}</h4>
            {g.hits.map((h) => {
              i += 1;
              const idx = i;
              return (
                <button key={`${g.kind}:${h.id}`} type="button" data-index={idx} data-hit={h.id} className={idx === active ? "ic-active" : ""} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(idx)} onClick={() => pick(h)}>
                  <span>{h.text}</span>
                  <b>{h.card && h.card !== h.id && plan.cards[h.card] ? plan.cards[h.card]!.title : ""}</b>
                </button>
              );
            })}
          </div>
        ))}
        {!flat.length && <h4>Nothing called that yet.</h4>}
      </div>
      <small className="sb-hint">↑↓ move · ↵ go there · esc close</small>
    </div>
  );
}
