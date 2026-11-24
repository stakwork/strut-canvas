// Jamie on the canvas: a message bar on the desk, and the conversation docked
// beside the canvas. Each turn is a run of the same `orchestrator` the Jamie
// app talks to, as the viewer; what the viewer has picked rides along in the
// turn's context, with ref_ids. The thread is drawn with strut/jamie's own
// pieces — its Markdown, the job cards (their live strip follows `job/updates`,
// their run is long-polled) and the artifact cards — compiled in.
//
// It follows a turn the way the Jamie app does, as live as this app may:
// the Jamie app long-polls its conversation (`conversation/get { wait }`),
// which only strut's own apps may call, so a turn here is followed by
// long-polling its run (`run/get { wait }`): the message shows the moment it
// is sent, Jamie's working card at once, and the reply, its jobs and what it
// made the moment the run ends. No timer polls a running turn.
import { Component, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { assistantJobs, isInFlight, useHost, useRun, useRunEvents, useStrutClient, type RunSummary } from "@strut/kit";
import { Markdown } from "strut/jamie/components/Markdown";
import { JobCard } from "strut/jamie/components/JobCard";
import { ArtifactCard, type TurnRuns } from "strut/jamie/components/ArtifactCard";
import { turnContext } from "strut/jamie/lib/chat";

const say = (err: unknown) => (err instanceof Error ? err.message : String(err));
const ASSISTANT = "orchestrator";
const NO_RUNS: TurnRuns = { byJob: new Map(), byRun: new Map() };
/** The builder's own test conversations (the v63–v64 checks, sessions "infinite-canvas" and "infinite-canvas-…"): never listed or opened. */
const HIDDEN = ["infinite-canvas"];
const isHidden = (s: string) => HIDDEN.some((h) => s === h || s.startsWith(`${h}-`));
/** A new conversation's id, named as the earlier Infinite Canvas named them, so old and new list together. */
const newSession = () => `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** One of the viewer's conversations held in this app, as `threads` reads them in place. */
export interface Thread {
  session: string;
  title: string;
  startedAt: string;
  lastAt: string;
  turns: number;
  runIds: string[];
  running: boolean;
}

/** A turn this page sent: shown the moment it is sent, with its run once the launch answers. */
interface Sent {
  key: string;
  session: string;
  prompt: string;
  runId?: string;
  error?: string;
}

const promptOf = (r: RunSummary | undefined) => {
  const p = (r?.input as { prompt?: unknown } | undefined)?.prompt;
  return typeof p === "string" ? p : "";
};

/** The viewer's conversations on the canvas: the list, the open one's turns, the ones just sent, and a turn sent with what is picked.
 *  The canvas opens on a new conversation, as the Jamie app does; an earlier one opens from the list and goes on in its own thread. */
function useJamie(about: string, open: boolean) {
  const host = useHost();
  const client = useStrutClient();
  const [thread, setThread] = useState<string>(newSession);
  // The list: the turns where they live (this app's orchestrator runs, the viewer's own), grouped by session on the server.
  const threads = useQuery({
    queryKey: ["ic", "jamie-threads"],
    enabled: open,
    queryFn: () => client.run<{ threads: Thread[]; cut: boolean }>("stadeum/canvas/threads", { hide: HIDDEN }),
    staleTime: 30_000,
  });
  const current = threads.data?.threads.find((t) => t.session === thread);
  // The open conversation's turns, each read once — a settled run never changes.
  const reads = useQueries({
    queries: (current?.runIds ?? []).map((runId) => ({
      queryKey: ["ic", "jamie-turn", runId],
      queryFn: () => client.run<RunSummary>("run/get", { workflow: ASSISTANT, runId }),
      staleTime: Infinity,
    })),
  });
  const history = useMemo(() => reads.map((q) => q.data).filter((r): r is RunSummary => !!r), [reads.map((q) => `${q.data?.runId}:${q.data?.status}`).join(",")]);
  const [sent, setSent] = useState<Sent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const aboutRef = useRef(about);
  aboutRef.current = about;
  // A sent turn leaves the local list once the read-back history has it.
  const known = new Set(history.map((r) => r.runId));
  const live = sent.filter((s) => s.session === thread && (!s.runId || !known.has(s.runId)));
  return {
    thread,
    threads: threads.data?.threads ?? [],
    threadsCut: !!threads.data?.cut,
    threadsLoading: threads.isLoading,
    threadsError: threads.error ? say(threads.error) : null,
    history,
    sent: live,
    error,
    sending: live.some((s) => !s.runId && !s.error),
    /** A turn of ours ended: read the list again so it joins the history. */
    settled: () => void threads.refetch(),
    open: (session: string) => {
      setError(null);
      setThread(session);
    },
    newChat: () => {
      setError(null);
      setThread(newSession());
    },
    /** Send a turn. The message shows at once; true when the launch was taken. */
    say: async (text: string): Promise<boolean> => {
      const prompt = text.trim();
      if (!prompt) return false;
      setError(null);
      const key = `${Date.now()}:${Math.random()}`;
      const session = thread;
      setSent((all) => [...all, { key, session, prompt }]);
      try {
        const ctx = turnContext(new Date(), (host as { timeZone?: string }).timeZone);
        const line = `${ctx.line}${aboutRef.current ? `${aboutRef.current} ` : ""}`;
        const l = await client.run<{ runId: string }>("run/launch", { workflow: ASSISTANT, input: { prompt, session, context: { ...ctx, line } } });
        setSent((all) => all.map((s) => (s.key === key ? { ...s, runId: l.runId } : s)));
        return true;
      } catch (err) {
        setSent((all) => all.map((s) => (s.key === key ? { ...s, error: say(err) } : s)));
        setError(say(err));
        return false;
      }
    },
  };
}
type JamieState = ReturnType<typeof useJamie>;

/** The bar on the desk: type to Jamie about what is picked. Enter sends and opens the chat; Shift+Enter adds a line. */
function JamieBar({ jamie, subject, onOpen, shift }: { jamie: JamieState; subject: string | null; onOpen: () => void; shift: number }) {
  const [text, setText] = useState("");
  const submit = () => {
    const words = text;
    if (!words.trim()) return;
    setText("");
    onOpen();
    void jamie.say(words);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") e.currentTarget.blur();
  };
  return (
    <div className="sb-jbar" style={{ left: `calc(50% + ${shift / 2}px)` }} data-testid="ic-jamie-bar">
      <div className="sb-jchips">
        {subject && <span className="sb-jchip sb-jquiet">About: {subject}</span>}
        <button type="button" className="sb-jchip" onClick={onOpen}>
          ⤢ Full chat
        </button>
      </div>
      <div className="sb-jfield">
        <textarea rows={1} value={text} placeholder={subject ? "Ask about this, or tell Jamie what to change" : "Message Jamie"} aria-label="Message Jamie" onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      </div>
    </div>
  );
}

/** Jamie's failure is Jamie's alone: the canvas stays up, and the bar says what went wrong. */
class Guard extends Component<{ children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: say(err) };
  }
  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="sb-jbar" style={{ left: "50%" }}>
        <div className="sb-jfield">
          <span className="sb-need">Jamie could not start here: {this.state.error}</span>
        </div>
      </div>
    );
  }
}

interface DockProps {
  /** What the viewer is looking at, with ref_ids: added to every turn. */
  about: string;
  subject: string | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  shift: number;
  /** A turn the canvas itself sends (its right-click menu); a new `n` is a new turn. */
  ask?: { text: string; n: number } | null;
  /** A job to show (a press on it under Working now); a new `n` is a new press. */
  focusJob?: { job: string; n: number } | null;
}

export function JamieDock(props: DockProps) {
  return (
    <Guard>
      <Dock {...props} />
    </Guard>
  );
}

/** A job opened from Working now: its newest run, and the conversation of this app's that started it, if one did. */
interface Focus {
  job: string;
  runId?: string;
  workflow?: string;
  /** The conversation it came from is open: its card is in the thread. */
  inThread: boolean;
  n: number;
}

function Dock({ about, open, onOpen, onClose, shift, ask, subject, focusJob }: DockProps) {
  const jamie = useJamie(about, open);
  const client = useStrutClient();
  const asked = useRef(0);
  useEffect(() => {
    if (!ask || asked.current === ask.n) return;
    asked.current = ask.n;
    void jamie.say(ask.text);
  }, [ask, jamie]);
  // As the Jamie app opens a job: the conversation that started it, scrolled to its card. A job no conversation
  // of this app's started (one begun elsewhere) shows as its own card at the top of the chat.
  const [focus, setFocus] = useState<Focus | null>(null);
  useEffect(() => {
    if (!focusJob) return;
    let gone = false;
    setFocus({ job: focusJob.job, inThread: false, n: focusJob.n });
    void client
      .run<{ runs?: Array<{ workflow: string; runId: string; parentRunId?: string; startedBy?: { workflow?: string; session?: string } }> }>("job/get", { job: focusJob.job })
      .then((v) => {
        if (gone) return;
        const turn = (v.runs ?? []).find((r) => !r.parentRunId);
        const from = (v.runs ?? []).map((r) => r.startedBy).find((s) => s?.workflow === ASSISTANT && s.session);
        const raw = from?.session;
        const name = raw?.startsWith("app/") ? raw.split("/").slice(3).join("/") : raw;
        const session = name && !isHidden(name) ? name : null;
        if (session) jamie.open(session);
        setFocus({ job: focusJob.job, ...(turn ? { runId: turn.runId, workflow: turn.workflow } : {}), inThread: !!session, n: focusJob.n });
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [focusJob?.n]);
  return open ? <JamiePanel jamie={jamie} focus={focus} onClose={onClose} /> : <JamieBar jamie={jamie} subject={subject} onOpen={onOpen} shift={shift} />;
}

/** Jamie's working card, as the Jamie app draws it. */
function Working() {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5" data-testid="ic-jamie-working">
      <Loader2 className="size-3.5 animate-spin text-sky-600" />
      <span className="text-sm font-medium">Jamie is working on it</span>
    </div>
  );
}

/** The person's words, at once. */
function You({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-end">
      <div data-chat-bubble="you" className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground shadow-sm" data-testid="ic-jamie-you">
        {text}
      </div>
    </div>
  );
}

/** What a turn came back with: the reply, its question, the jobs it started (read once from its log, when it ended) and what it made. */
function Reply({ run }: { run: RunSummary }) {
  const ended = !isInFlight(run);
  const events = useRunEvents(ASSISTANT, run.runId, { enabled: ended && run.status === "success" });
  const jobs = useMemo(() => assistantJobs(events.data), [events.data]);
  const out = (run.output ?? {}) as { text?: unknown; ask?: unknown; artifacts?: unknown };
  const text = typeof out.text === "string" ? out.text : "";
  const ask = typeof out.ask === "string" ? out.ask : typeof (out.ask as { message?: unknown } | undefined)?.message === "string" ? (out.ask as { message: string }).message : null;
  const artifacts = Array.isArray(out.artifacts) ? out.artifacts : [];
  if (!ended) return <Working />;
  if (run.status !== "success") return <p className="text-sm text-rose-700">{run.error?.message ?? `This turn ${run.status === "cancelled" ? "was stopped" : "failed"}.`}</p>;
  return (
    <div className="space-y-2" data-testid="ic-jamie-reply">
      {text && (
        <div data-chat-bubble="assistant" className="rounded-2xl bg-muted/40 px-3 py-2 shadow-sm">
          <Markdown text={text} />
        </div>
      )}
      {ask && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">{ask}</div>}
      {jobs.map((j) => (
        <JobCard key={`${j.job}:${j.runId}`} job={j.job} runId={j.runId} {...(j.workflow ? { workflow: j.workflow } : {})} />
      ))}
      {artifacts.map((a, k) => (
        <ArtifactCard key={k} artifact={a as Parameters<typeof ArtifactCard>[0]["artifact"]} runs={NO_RUNS} />
      ))}
    </div>
  );
}

/** A turn this page just sent: its words at once, the working card, then — the moment its run ends (`run/get { wait }`) — the reply. */
function LiveTurn({ turn, onSettled }: { turn: Sent; onSettled: () => void }) {
  const run = useRun(ASSISTANT, turn.runId, { live: true });
  const ended = !!run.data && !isInFlight(run.data);
  useEffect(() => {
    if (ended) onSettled();
  }, [ended]);
  return (
    <div className="flex flex-col gap-2" data-testid="ic-jamie-turn" data-status={turn.error ? "error" : run.data?.status ?? "sending"}>
      <You text={turn.prompt} />
      {turn.error ? <p className="text-sm text-rose-700">Not sent: {turn.error}</p> : run.data && ended ? <Reply run={run.data} /> : <Working />}
    </div>
  );
}

/** A turn read back from the history; one still running (the page was reopened mid-turn) is followed live. */
function PastTurn({ run }: { run: RunSummary }) {
  const live = useRun(ASSISTANT, isInFlight(run) ? run.runId : undefined, { live: true });
  const now = live.data ?? run;
  return (
    <div className="flex flex-col gap-2" data-testid="ic-jamie-turn" data-status={now.status}>
      <You text={promptOf(now)} />
      <Reply run={now} />
    </div>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** The viewer's conversations here, newest first, as the Jamie app lists them: pick one to read it and go on in it. */
function Chats({ jamie, onPick }: { jamie: JamieState; onPick: (session: string) => void }) {
  return (
    <div className="flex-1 overflow-y-auto" data-testid="ic-jamie-chats">
      {jamie.threadsLoading && <p className="p-3 text-sm text-muted-foreground">Reading your conversations…</p>}
      {jamie.threadsError && <p className="sb-need p-3 text-sm">{jamie.threadsError}</p>}
      {!jamie.threadsLoading && !jamie.threads.length && !jamie.threadsError && <p className="p-3 text-sm text-muted-foreground">No earlier conversations here yet.</p>}
      {jamie.threads.map((t) => (
        <button key={t.session} type="button" data-session={t.session} onClick={() => onPick(t.session)} className="block w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-muted">
          <span className="line-clamp-2 block text-sm font-medium">{t.title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {when(t.lastAt)} · {t.turns} {t.turns === 1 ? "message" : "messages"}
            {t.running ? " · working" : ""}
            {t.session === jamie.thread ? " · open" : ""}
          </span>
        </button>
      ))}
      {jamie.threadsCut && <p className="p-3 text-xs text-muted-foreground">Showing the conversations in your latest 300 messages; older ones are not listed.</p>}
    </div>
  );
}

function JamiePanel({ jamie, focus, onClose }: { jamie: JamieState; focus: Focus | null; onClose: () => void }) {
  const [text, setText] = useState("");
  const [listing, setListing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const count = jamie.history.length + jamie.sent.length;
  const title = jamie.threads.find((t) => t.session === jamie.thread)?.title;
  useEffect(() => {
    const el = scroller.current;
    if (el && !focus?.inThread) el.scrollTop = el.scrollHeight;
  }, [count, jamie.sent.map((s) => s.runId ?? "").join(",")]);
  // A job opened from Working now: show the chat (not the list), and once its card is drawn, bring it into view.
  useEffect(() => {
    if (!focus) return;
    setListing(false);
    if (!focus.inThread) return;
    let tries = 0;
    const t = window.setInterval(() => {
      const card = scroller.current?.querySelector<HTMLElement>(`[data-testid="job-card"][data-job="${CSS.escape(focus.job)}"]`);
      if (card || ++tries > 40) window.clearInterval(t);
      if (!card) return;
      card.scrollIntoView({ block: "center" });
      card.animate([{ boxShadow: "0 0 0 2px var(--ring)" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1600 });
    }, 250);
    return () => window.clearInterval(t);
  }, [focus?.n, focus?.inThread]);
  const submit = () => {
    const words = text;
    if (!words.trim()) return;
    setText("");
    setListing(false);
    void jamie.say(words);
  };
  return (
    <aside className="sb-jamie bg-background text-foreground" data-testid="ic-jamie">
      <header className="sb-jamie-head">
        <strong className="truncate" title={title ?? "Jamie"}>
          {listing ? "Conversations" : (title ?? "Jamie")}
        </strong>
        <button type="button" className="sb-btn" aria-pressed={listing} onClick={() => setListing((v) => !v)}>
          Chats
        </button>
        <button
          type="button"
          className="sb-btn"
          disabled={!count && !listing}
          onClick={() => {
            setListing(false);
            jamie.newChat();
          }}
        >
          New chat
        </button>
        <button type="button" className="sb-btn" aria-label="Close the chat" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="sb-jamie-body">
        {listing ? (
          <Chats
            jamie={jamie}
            onPick={(s) => {
              jamie.open(s);
              setListing(false);
            }}
          />
        ) : (
          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-3" data-testid="ic-jamie-thread">
            {focus && !focus.inThread && focus.runId && (
              <div className="space-y-1" data-testid="ic-jamie-focus">
                <span className="sb-meta">Working now</span>
                <JobCard job={focus.job} runId={focus.runId} {...(focus.workflow ? { workflow: focus.workflow } : {})} />
              </div>
            )}
            {!count && !focus && <p className="text-sm text-muted-foreground">Ask Jamie about what you have picked on the canvas, or open an earlier conversation from Chats.</p>}
            {jamie.history.map((r) => (
              <PastTurn key={r.runId} run={r} />
            ))}
            {jamie.sent.map((s) => (
              <LiveTurn key={s.key} turn={s} onSettled={jamie.settled} />
            ))}
            {jamie.error && <p className="sb-need text-sm">{jamie.error}</p>}
          </div>
        )}
        <div className="sb-jfield" style={{ margin: 8 }}>
          <textarea
            rows={1}
            value={text}
            placeholder="Message Jamie"
            aria-label="Message Jamie in the chat"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
      </div>
    </aside>
  );
}
