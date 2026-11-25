// The canvas presented: opened with `present: <job>` in its deep link, it is
// what Jamie shows a call (a screen share nobody steers). Each card written
// while it is open is brought to the middle and marked for a while, and a
// line says what the job is doing.
//
// People linked to the box get the page itself in Jamie's tile, not the
// video. Once one of them scrolls, pans, zooms or opens a card, it stops
// bringing new cards to the middle (it still marks them) until they press
// Follow, which goes to the newest one.
//
// It adds no feed of its own for the cards. It holds the job's own updates
// open (for the line), and the job reports each write it makes there: that
// is the signal to read the graph again at once, before the page's graph
// change feed would. A new card is then one that a read has and the read
// before did not. A page has only so many connections to the server, and
// every feed holds one open.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useJobUpdates } from "@strut/kit";
import type { Plan } from "./plan";
import type { Brainstorms } from "./brainstorm";
import type { Why } from "./why";
import { FOLLOWING, cardsOn, chosenOn, follow, shownAs } from "./follow";
import { readAgain, readsOfTypes } from "./read";

/** How long a new card stays marked. */
export const FRESH_MS = 20_000;
/** How long the job's line stays up after it last said something: then the call sees "Taking notes" again. */
export const LINE_MS = 12_000;

export interface Presenter {
  /** Cards to mark, by id. */
  fresh: ReadonlySet<string>;
  /** The card to bring to the middle: the newest one written while following, or on Follow (`n` moves on each time). */
  target: { id: string; n: number } | null;
  /** What the job says it is doing now, when the page may read the job; null when it is between turns. */
  line: string | null;
  /** Bringing new cards to the middle: off while a person looks around. */
  following: boolean;
  /** A person is looking around: stop following. */
  look: () => void;
  /** Follow again, from the newest card. */
  follow: () => void;
}

/** An update the job made since the page opened (a little slack for the server's clock). */
const since = (at: string | undefined, opened: number) => !!at && Date.parse(at) > opened - 5_000;

export function usePresenter(job: string | null, plan: Plan | undefined, b: Brainstorms | undefined, why?: Why): Presenter {
  const on = !!job;
  const qc = useQueryClient();
  const updates = useJobUpdates(job ?? undefined, { enabled: on });
  const opened = useRef(Date.now());
  const known = useRef<{ cards: Set<string>; chosen: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<Map<string, number>>(new Map());
  const [state, step] = useReducer(follow, FOLLOWING);

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

  // A read with cards (or choices) the last one did not have: mark them, and bring the newest to the middle (while following).
  useEffect(() => {
    if (!on || !plan || !b || !why) return;
    const now = { cards: cardsOn(plan, b, why), chosen: chosenOn(b) };
    const was = known.current;
    known.current = now;
    if (!was) return;
    const shown: string[] = [];
    const show = (ref: string) => {
      const id = shownAs(ref, plan, b, why);
      if (id && !shown.includes(id)) shown.push(id);
    };
    for (const ref of now.cards) if (!was.cards.has(ref)) show(ref);
    for (const ref of now.chosen) if (!was.chosen.has(ref)) show(ref);
    if (!shown.length) return;
    const at = Date.now();
    setFresh((f) => {
      const n = new Map(f);
      for (const id of shown) n.set(id, at);
      return n;
    });
    step({ wrote: shown[shown.length - 1]! });
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
  const look = useCallback(() => step("look"), []);
  const resume = useCallback(() => step("follow"), []);
  return { fresh: set, target: state.target, line: on ? line : null, following: state.on, look, follow: resume };
}
