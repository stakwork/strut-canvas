// The canvas presented: opened with `present: <job>` in its deep link, it is
// what Jamie shows a call (a screen share nobody steers). Each card written
// while it is open is brought to the middle and marked for a while, and a
// line says what the job is doing.
//
// It adds no feed of its own for the cards. It holds the job's own updates
// open (for the line), and the job reports each write it makes there: that
// is the signal to read the graph again at once, before the page's graph
// change feed would. A new card is then one that a read has and the read
// before did not. A page has only so many connections to the server, and
// every feed holds one open.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useJobUpdates } from "@strut/kit";
import type { Plan } from "./plan";
import type { Brainstorms } from "./brainstorm";
import type { Why } from "./why";
import { cardsOn, shownAs } from "./follow";
import { readAgain, readsOfTypes } from "./read";

/** How long a new card stays marked. */
export const FRESH_MS = 20_000;
/** How long the job's line stays up after it last said something: then the call sees "Taking notes" again. */
export const LINE_MS = 12_000;

export interface Presenter {
  /** Cards to mark, by id. */
  fresh: ReadonlySet<string>;
  /** The card to bring to the middle: the newest one written (`n` moves on each time). */
  target: { id: string; n: number } | null;
  /** What the job says it is doing now, when the page may read the job; null when it is between turns. */
  line: string | null;
}

/** An update the job made since the page opened (a little slack for the server's clock). */
const since = (at: string | undefined, opened: number) => !!at && Date.parse(at) > opened - 5_000;

export function usePresenter(job: string | null, plan: Plan | undefined, b: Brainstorms | undefined, why?: Why): Presenter {
  const on = !!job;
  const qc = useQueryClient();
  const updates = useJobUpdates(job ?? undefined, { enabled: on });
  const opened = useRef(Date.now());
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Map<string, number>>(new Map());
  const [target, setTarget] = useState<Presenter["target"]>(null);

  // The job wrote: read what it wrote now, not when the change feed comes round. Its update names the types.
  const wrote = updates.latest("graph");
  useEffect(() => {
    if (!on || !since(wrote?.at, opened.current)) return;
    const types = wrote?.detail?.["types"];
    void readAgain(qc, readsOfTypes(types && typeof types === "object" ? Object.keys(types) : []));
  }, [wrote?.at]);

  // The job's line, while it is fresh.
  const status = updates.latest("status");
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    if (!on || !status?.title || !since(status.at, opened.current)) return;
    setLine(status.title);
    const t = setTimeout(() => setLine(null), LINE_MS);
    return () => clearTimeout(t);
  }, [status?.at, status?.title]);

  // A read with cards the last one did not have: mark them, and bring the newest to the middle.
  useEffect(() => {
    if (!on || !plan || !b || !why) return;
    const now = cardsOn(plan, b, why);
    const was = known.current;
    known.current = now;
    if (!was) return;
    const shown: string[] = [];
    for (const ref of now) {
      if (was.has(ref)) continue;
      const id = shownAs(ref, plan, b, why);
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
  }, [on, plan, b, why]);

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
  return { fresh: set, target, line: on ? line : null };
}
