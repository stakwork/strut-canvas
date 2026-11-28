// The transcript view of a recorded call: one shared stream of what was said,
// bubbles left to right, each with the speaker's name and avatar (initials,
// coloured by identity), chat and Jamie's lines marked, a "speaking…" mark by
// a person's name while their `speaking` state is on. It follows the newest
// line; a drag (or the wheel) stops following, Live returns. A line a card
// cites carries a tag that jumps to the card. A call that is over replays:
// scroll it, or Play it at the call's pace.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useChannel } from "@strut/kit";
import { CorrectPopup, LineText, useLingo, type Pick } from "./Lingo";
import { cleanWord } from "../lib/lingo";
import type { CallState } from "../lib/call";
import { bubblesOf, colourOf, initials, KIND_WORD, paceOf, simFrames, type CallRef, type Line, type Speaking } from "../lib/transcript";

// ---------------------------------------------------------------- the channel

/** Joins `canvas-transcript.<job>` and hands every frame to the call's feed. `sim` plays fixture frames instead of
 *  (as well as) the channel's, so a look can check the merge. */
export function ChannelTap({ job, sim, startN, ingest, ingestStates, onAvailable }: { job: string; sim: boolean; startN: number | null; ingest: (m: unknown) => void; ingestStates: (s: unknown) => void; onAvailable: (a: boolean) => void }) {
  const ch = useChannel(`canvas-transcript.${job}`, { onMessage: (m: unknown) => ingest(m) }) as unknown as { available?: boolean; states?: unknown; events?: unknown[] };
  useEffect(() => onAvailable(ch?.available !== false), [ch?.available]);
  useEffect(() => {
    if (ch?.states) ingestStates(ch.states);
  }, [ch?.states]);
  // The recent events the channel kept (a page that joins late): lines are merged by n, so a second sight is a no-op.
  const seenEvents = useRef(0);
  useEffect(() => {
    const evs = Array.isArray(ch?.events) ? ch!.events! : [];
    if (evs.length < seenEvents.current) seenEvents.current = 0;
    for (const e of evs.slice(seenEvents.current)) ingest(e);
    seenEvents.current = evs.length;
  }, [ch?.events]);
  // Fixture frames, once the stored lines are in.
  const simmed = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (!sim || simmed.current || startN === null) return;
    simmed.current = true;
    const frames = simFrames(startN, Date.now());
    // Kept until the page leaves the call: the lines the frames add move `startN`, which must not cancel the rest.
    timers.current = frames.map((f) => setTimeout(() => ingest(f.body), f.delay));
  }, [sim, startN]);
  return null;
}

// ---------------------------------------------------------------- back-links on cards

export interface CallLinks {
  /** The cards that came from a call, by id (a choice said aloud may have two: the option and its choosing). */
  byCard: Map<string, CallRef[]>;
  open: (job: string, n: number) => void;
}
export const CallLinksContext = createContext<CallLinks | null>(null);

/** "From the call": on a card the scribe wrote from a call, a link to its line in the transcript. */
export function FromCall({ id }: { id: string }) {
  const ctx = useContext(CallLinksContext);
  const refs = ctx?.byCard.get(id);
  if (!ctx || !refs?.length) return null;
  return (
    <span className="cv-from">
      {refs.map((r) => (
        <button
          key={`${r.kind}${r.job}`}
          type="button"
          className="cv-from-btn"
          title={`${r.speaker ? `${r.speaker}: ` : ""}${r.quote ? `“${r.quote}”` : ""} — line ${r.lines.join(", ")}`}
          onClick={(e) => {
            e.stopPropagation();
            ctx.open(r.job, r.lines[0]!);
          }}
        >
          {r.kind === "choice" ? "chosen on the call" : "from the call"} · line {r.lines[0]}
          {r.lines.length > 1 ? `–${r.lines[r.lines.length - 1]}` : ""} ›
        </button>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- the view

export function Avatar({ name, id, small }: { name: string; id?: string | undefined; small?: boolean }) {
  return (
    <span className={`tv-av${small ? " tv-av-s" : ""}`} style={{ background: colourOf(id ?? name) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

const hhmm = (at: number) => (at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

export interface Focus {
  n: number;
  k: number;
}

export function TranscriptView({
  job,
  title,
  call,
  cited,
  following,
  setFollowing,
  focus,
  onOpenCard,
  active,
  onReplay,
}: {
  job: string;
  title: string;
  call: CallState;
  cited: Map<number, CallRef[]>;
  following: boolean;
  setFollowing: (f: boolean) => void;
  focus: Focus | null;
  onOpenCard: (r: CallRef) => void;
  active: boolean;
  onReplay: (r: { playing: boolean; shown: number; speed: number; marked: number | null }) => void;
}) {
  const stream = useRef<HTMLDivElement>(null);
  const lingo = useLingo();
  const [pick, setPick] = useState<Pick | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    setPlaying(false);
    setCursor(null);
  }, [job]);
  const pace = useMemo(() => paceOf(call.lines), [call.lines]);
  const shown: Line[] = cursor === null ? call.lines : call.lines.slice(0, cursor + 1);
  const bubbles = useMemo(() => bubblesOf(shown), [shown]);

  // Play: the next line after the gap the call had (shortened past 8 s), at `speed`.
  useEffect(() => {
    if (!playing || cursor === null) return;
    if (cursor >= call.lines.length - 1) {
      setPlaying(false);
      setCursor(null);
      return;
    }
    const gap = Math.max(60, (pace[cursor + 1]! - pace[cursor]!) / speed);
    const t = setTimeout(() => setCursor((c) => (c === null ? null : c + 1)), gap);
    return () => clearTimeout(t);
  }, [playing, cursor, speed, pace, call.lines.length]);
  const play = () => {
    setFollowing(true);
    if (cursor === null || cursor >= call.lines.length - 1) setCursor(0);
    setPlaying(true);
  };

  // Follow the newest line.
  useLayoutEffect(() => {
    const s = stream.current;
    if (!s || !following) return;
    s.scrollLeft = s.scrollWidth;
  }, [following, shown.length, call.speaking.length, bubbles.length]);

  // A line to show (a card's back-link, or `line=` in the link): brought to the middle and marked.
  const [marked, setMarked] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!focus) return;
    const s = stream.current;
    const el = s?.querySelector<HTMLElement>(`[data-n="${focus.n}"]`);
    if (!s || !el) return;
    setFollowing(false);
    setPlaying(false);
    setCursor(null);
    const b = el.closest<HTMLElement>(".tv-bubble") ?? el;
    s.scrollLeft = Math.max(0, b.offsetLeft - s.clientWidth / 2 + b.offsetWidth / 2);
    setMarked(focus.n);
  }, [focus?.k, call.lines.length > 0]);
  // The mark stays until the view follows the newest line again.
  useEffect(() => {
    if (following) setMarked(null);
  }, [following]);
  useEffect(() => onReplay({ playing, shown: shown.length, speed, marked }), [playing, shown.length, speed, marked]);

  // A drag moves along the stream and stops following; so does the wheel.
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const s = stream.current;
    if (!s) return;
    const g = { x: e.clientX, left: s.scrollLeft, moved: false };
    const move = (ev: PointerEvent) => {
      if (!g.moved && Math.abs(ev.clientX - g.x) < 4) return;
      if (!g.moved) {
        g.moved = true;
        setFollowing(false);
        s.classList.add("tv-drag");
      }
      s.scrollLeft = g.left - (ev.clientX - g.x);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      s.classList.remove("tv-drag");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  useEffect(() => {
    const s = stream.current;
    if (!s) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setFollowing(false);
      s.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    };
    s.addEventListener("wheel", onWheel, { passive: false });
    return () => s.removeEventListener("wheel", onWheel);
  }, []);

  // Everyone in the call so far: who has spoken, and who is speaking.
  const people = useMemo(() => {
    const m = new Map<string, { name: string; id?: string; source: Line["source"] }>();
    for (const l of call.lines) {
      const k = l.identity ?? `${l.source}:${l.speaker}`;
      if (!m.has(k)) m.set(k, { name: l.speaker, ...(l.identity ? { id: l.identity } : {}), source: l.source });
    }
    for (const s of call.speaking) if (!m.has(s.identity)) m.set(s.identity, { name: s.speaker, id: s.identity, source: "voice" });
    return [...m.entries()];
  }, [call.lines, call.speaking]);
  const talking = new Set(call.speaking.map((s) => s.identity));
  const live = !call.done && (call.live || call.from === "stored");

  return (
    <div className={`tv${active ? "" : " tv-inactive"}`} data-testid="transcript">
      <header className="tv-head">
        <div className="tv-title">
          <span className="sb-meta">
            Transcript · {call.done ? "the call is over" : live ? "recording" : call.from === "prompts" ? "rebuilt from the notes, to the minute" : "waiting for lines"}
          </span>
          <h2>{title}</h2>
        </div>
        <ul className="tv-people" aria-label="People in the call">
          {people.map(([k, p]) => (
            <li key={k} className={talking.has(k) ? "tv-talking" : ""}>
              <Avatar name={p.name} id={p.id} small />
              <span>{p.name}</span>
              {p.source === "jamie" && <em className="tv-tag tv-tag-jamie">Jamie</em>}
              {talking.has(k) && <em className="tv-speaking">speaking…</em>}
            </li>
          ))}
        </ul>
      </header>

      <div className="tv-stream" ref={stream} onPointerDown={onDown}>
        <div className="tv-row">
          {call.loading && <p className="tv-empty">Reading the transcript…</p>}
          {!call.loading && call.error && <p className="tv-empty">The transcript could not be read: {call.error}</p>}
          {!call.loading && !call.error && !call.lines.length && <p className="tv-empty">Nothing said yet. Each sentence shows here once it is finished.</p>}
          {bubbles.map((b) => (
            <article key={b.key} className={`tv-bubble tv-src-${b.source}`} style={{ ["--who" as string]: colourOf(b.identity ?? b.speaker) }}>
              <header>
                <Avatar name={b.speaker} id={b.identity} />
                <b>{b.speaker}</b>
                {b.source === "chat" && <em className="tv-tag">chat</em>}
                {b.source === "jamie" && <em className="tv-tag tv-tag-jamie">Jamie</em>}
                {talking.has(b.identity ?? "") && b === bubbles[bubbles.length - 1] && <em className="tv-speaking">speaking…</em>}
                <time>{hhmm(b.lines[0]!.at)}</time>
              </header>
              {b.lines.map((l) => (
                <p key={l.n} data-n={l.n} className={marked === l.n ? "tv-marked" : ""}>
                  <small className="tv-n">{l.n}</small>
                  {lingo.available ? <LineText text={l.text} entries={lingo.entries} onPick={(heard, ev) => setPick({ x: ev.clientX, y: ev.clientY, heard: cleanWord(heard) || heard })} /> : l.text}
                  {(cited.get(l.n) ?? []).map((r) => (
                    <button key={`${r.id}${r.kind}`} type="button" className="tv-cite" title={r.title} onClick={() => onOpenCard(r)}>
                      → {KIND_WORD[r.kind]}: {r.title.length > 42 ? `${r.title.slice(0, 42)}…` : r.title}
                    </button>
                  ))}
                </p>
              ))}
            </article>
          ))}
          {cursor === null &&
            call.speaking
              .filter((s) => !bubbles.length || bubbles[bubbles.length - 1]!.identity !== s.identity)
              .map((s: Speaking) => (
                <article key={`speaking-${s.identity}`} className="tv-bubble tv-ghost" style={{ ["--who" as string]: colourOf(s.identity) }}>
                  <header>
                    <Avatar name={s.speaker} id={s.identity} />
                    <b>{s.speaker}</b>
                    <em className="tv-speaking">speaking…</em>
                  </header>
                  <p className="tv-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </p>
                </article>
              ))}
        </div>
      </div>

      {pick && <CorrectPopup pick={pick} onClose={() => setPick(null)} onSave={lingo.add} />}
      <footer className="tv-foot">
        {!following && (
          <button type="button" className="sb-btn tv-live" onClick={() => setFollowing(true)}>
            <i className="tv-live-dot" /> {cursor !== null ? "Back to the replay" : live ? "Live" : "Latest"}
          </button>
        )}
        {call.lines.length > 1 && (
          <span className="tv-replay">
            {playing ? (
              <button type="button" className="sb-btn" onClick={() => setPlaying(false)}>
                Pause
              </button>
            ) : (
              <button type="button" className="sb-btn" onClick={play}>
                {cursor === null ? "Play the call" : "Play on"}
              </button>
            )}
            {cursor !== null && (
              <>
                <span className="tv-count">
                  {cursor + 1} of {call.lines.length}
                </span>
                <button type="button" className="sb-btn" onClick={() => (setPlaying(false), setCursor(null))}>
                  Show all
                </button>
              </>
            )}
            <span className="sb-seg" role="group" aria-label="Replay speed">
              {[1, 4, 16].map((x) => (
                <button key={x} type="button" className="sb-btn" aria-pressed={speed === x} onClick={() => setSpeed(x)}>
                  {x}×
                </button>
              ))}
            </span>
          </span>
        )}
      </footer>
    </div>
  );
}
