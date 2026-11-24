// The canvas presented: opened with `present: <job>` in its deep link, it is
// what Jamie shows a call (a screen share nobody steers). Each card written
// while it is open is brought to the middle and marked for a while, and a
// line says what the job is doing.
//
// It adds no feed of its own for the cards: the canvas already reads the plan
// and its brainstorms again when the graph changes (./read.ts), so a new card
// is one that a read has and the read before did not. A page has only so many
// connections to the server, and every feed holds one open.
import { useEffect, useMemo, useRef, useState } from "react";
import { useJobUpdates } from "@strut/kit";
import type { Plan } from "./plan";
import type { Brainstorms } from "./brainstorm";
import { cardsOn, shownAs } from "./follow";

/** How long a new card stays marked. */
export const FRESH_MS = 20_000;

export interface Presenter {
  /** Cards to mark, by id. */
  fresh: ReadonlySet<string>;
  /** The card to bring to the middle: the newest one written (`n` moves on each time). */
  target: { id: string; n: number } | null;
  /** What the job says it is doing, when the page may read the job. */
  line: string | null;
}

export function usePresenter(job: string | null, plan: Plan | undefined, b: Brainstorms | undefined): Presenter {
  const on = !!job;
  const updates = useJobUpdates(job ?? undefined, { enabled: on });
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Map<string, number>>(new Map());
  const [target, setTarget] = useState<Presenter["target"]>(null);

  // A read with cards the last one did not have: mark them, and bring the newest to the middle.
  useEffect(() => {
    if (!on || !plan || !b) return;
    const now = cardsOn(plan, b);
    const was = known.current;
    known.current = now;
    if (!was) return;
    const shown: string[] = [];
    for (const ref of now) {
      if (was.has(ref)) continue;
      const id = shownAs(ref, plan, b);
      if (id && !shown.includes(id)) shown.push(id);
    }
    if (!shown.length) return;
    const at = Date.now();
    setFresh((f) => {
      const n = new Map(f);
      for (const id of shown) n.set(id, at);
      return n;
    });
    setTarget((t) => ({ id: shown[shown.length - 1]!, n: (t?.n ?? 0) + 1 }));
  }, [on, plan, b]);

  // Marks fade.
  useEffect(() => {
    if (!fresh.size) return;
    const t = setTimeout(() => {
      const now = Date.now();
      setFresh((f) => new Map([...f].filter(([, at]) => now - at < FRESH_MS)));
    }, 1_000);
    return () => clearTimeout(t);
  }, [fresh]);

  const set = useMemo(() => new Set(fresh.keys()), [fresh]);
  return { fresh: set, target, line: on ? (updates.latest("status")?.title ?? null) : null };
}
