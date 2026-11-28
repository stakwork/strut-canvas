// The Calls page: every recorded call, newest first, and beside the list the
// one picked: its title, when and how long, who spoke, and its summary
// (discussed, decided, action items, open questions), with the transcript one
// click away. Under the list, the lingo: every word corrected in a transcript,
// with Remove. A call that stopped without a summary offers Summarize; one
// still recording says so. On a narrow page the list and the call take turns.
import { useEffect, useState } from "react";
import { lengthOf, namesOf, sectionsOf, type Recording } from "../lib/recordings";
import { Avatar } from "./Transcript";
import { LingoList } from "./Lingo";

const when = (at: number) => (at ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export interface Summarizing {
  busy: ReadonlySet<string>;
  failed: ReadonlyMap<string, string>;
  run: (job: string) => void;
}

export function CallsPage({
  calls,
  loading,
  error,
  current,
  summarizing,
  onOpen,
  onClose,
}: {
  calls: Recording[] | undefined;
  loading: boolean;
  error: string | null;
  /** The call open in the transcript view, if any: the page opens on it. */
  current: string | null;
  summarizing: Summarizing;
  onOpen: (job: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(current);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // A wide page always shows a call beside the list: the one picked, else the newest.
  const shown = calls?.find((c) => c.job === picked) ?? calls?.[0] ?? null;

  return (
    <div className={`cp${picked ? " cp-picked" : ""}`} data-testid="calls">
      <nav className="cp-list" aria-label="Recorded calls">
        <h2>Calls</h2>
        {loading && <p className="cp-note">Reading the calls…</p>}
        {!loading && error && <p className="cp-note">The calls could not be read: {error}</p>}
        {!loading && !error && calls && !calls.length && <p className="cp-note">No calls recorded yet.</p>}
        {calls?.map((c) => {
          const facts = [when(c.at), lengthOf(c)].filter(Boolean).join(" · ");
          return (
            <button key={c.job} type="button" className="cp-row" aria-current={c.job === shown?.job} onClick={() => setPicked(c.job)}>
              <b>
                {!c.done && <i className="tv-live-dot" />} {c.title}
              </b>
              <small>{facts || c.job}</small>
              {c.people.length > 0 && <small>{namesOf(c.people)}</small>}
            </button>
          );
        })}
        <LingoList />
      </nav>
      <section className="cp-call" aria-label="The call">
        {shown && <Call key={shown.job} call={shown} summarizing={summarizing} onOpen={onOpen} onBack={() => setPicked(null)} />}
      </section>
    </div>
  );
}

function Call({ call, summarizing, onOpen, onBack }: { call: Recording; summarizing: Summarizing; onOpen: (job: string) => void; onBack: () => void }) {
  const s = call.summary;
  const busy = summarizing.busy.has(call.job);
  const failed = summarizing.failed.get(call.job);
  const facts = [when(call.at), lengthOf(call), call.lines ? `${call.lines} lines` : ""].filter(Boolean).join(" · ");
  return (
    <article className="cp-sheet" data-job={call.job}>
      <button type="button" className="sb-btn sb-quietbtn cp-back" onClick={onBack}>
        ‹ Calls
      </button>
      <span className="sb-meta">{facts || call.job}</span>
      <h2>{call.title}</h2>
      {call.people.length > 0 && (
        <ul className="tv-people" aria-label="Who spoke">
          {call.people.map((p) => (
            <li key={p.identity ?? p.name}>
              <Avatar name={p.name} id={p.identity} small />
              <span>{p.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="cp-acts">
        <button type="button" className="sb-btn sb-primary" onClick={() => onOpen(call.job)}>
          Open transcript
        </button>
        {call.done && !s && (
          <button type="button" className="sb-btn cp-outline" disabled={busy} onClick={() => summarizing.run(call.job)}>
            {busy ? "Summarizing…" : "Summarize"}
          </button>
        )}
      </div>
      {!call.done && (
        <p className="cp-note">
          <i className="tv-live-dot" /> Recording
        </p>
      )}
      {call.done && !s && !busy && <p className="cp-note">{failed ?? "No summary yet."}</p>}
      {s && (
        <div className="cp-summary" data-testid="summary">
          {sectionsOf(s)
            .filter((x) => x.key !== "open")
            .map((x) => (
              <Points key={x.key} title={x.title} points={x.points} />
            ))}
          {s.actions.length > 0 && (
            <section>
              <h3>Action items</h3>
              <ul>
                {s.actions.map((a) =>
                  a.items.length === 1 ? (
                    <li key={a.who}>
                      <b>{a.who}:</b> {a.items[0]}
                    </li>
                  ) : (
                    <li key={a.who}>
                      <b>{a.who}</b>
                      <ul>
                        {a.items.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}
          {s.open.length > 0 && <Points title="Open questions" points={s.open} />}
        </div>
      )}
    </article>
  );
}

function Points({ title, points }: { title: string; points: string[] }) {
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </section>
  );
}
