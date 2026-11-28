// One call's transcript as the page holds it: the stored lines read with
// `stadeum/canvas/transcript` (again, from the last one, while the call is not
// done), merged with what the live channel brings (./transcript.ts). The
// channel itself is joined by <ChannelTap> (components/Transcript.tsx), which
// hands each frame to `ingest`.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStrutClient } from "@strut/kit";
import { bodyOf, mergeLines, speakingIn, speakingNow, toSpeaking, type Line, type Speaking } from "./transcript";

export interface CallState {
  lines: Line[];
  /** The recording stopped (the store says so, or the channel said `end`). */
  done: boolean;
  from: "stored" | "prompts" | "none" | null;
  speaking: Speaking[];
  /** A line came over the channel since the page opened. */
  live: boolean;
  /** Frames the channel brought, and how many were dropped as already held. */
  frames: number;
  dropped: number;
  error: string | null;
  loading: boolean;
  ingest: (raw: unknown) => void;
  ingestStates: (states: unknown) => void;
}

interface Read {
  lines?: unknown[];
  done?: boolean;
  from?: "stored" | "prompts" | "none";
  last?: number;
}

/** How often the store is read again while the call is not done: often for a call recording now, rarely for an old
 *  one rebuilt from its prompts (which is never marked done). */
const POLL_STORED_MS = 6_000;
const POLL_PROMPTS_MS = 60_000;

export function useCall(job: string | null): CallState {
  const client = useStrutClient();
  const [lines, setLines] = useState<Line[]>([]);
  const [ended, setEnded] = useState(false);
  const [live, setLive] = useState(false);
  const [counts, setCounts] = useState({ frames: 0, dropped: 0 });
  const [states, setStates] = useState<Map<string, Speaking>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const linesRef = useRef<Line[]>([]);
  linesRef.current = lines;

  // A new call: start over.
  useEffect(() => {
    setLines([]);
    setEnded(false);
    setLive(false);
    setCounts({ frames: 0, dropped: 0 });
    setStates(new Map());
  }, [job]);

  const first = useQuery({
    queryKey: ["ic", "transcript", job],
    enabled: !!job,
    queryFn: () => client.run<Read>("stadeum/canvas/transcript", { job }),
    staleTime: Infinity,
  });
  useEffect(() => {
    if (first.data?.lines) setLines((have) => mergeLines(have, first.data!.lines!));
  }, [first.data]);
  const [polled, setPolled] = useState<Read | null>(null);
  useEffect(() => setPolled(null), [job]);
  const from = polled?.from ?? first.data?.from ?? null;
  const done = ended || !!polled?.done || !!first.data?.done;

  // Read the store again from the last line held, while the call goes on.
  useEffect(() => {
    if (!job || !first.data || done) return;
    const every = from === "prompts" || from === "none" ? POLL_PROMPTS_MS : POLL_STORED_MS;
    const t = setInterval(async () => {
      const last = linesRef.current[linesRef.current.length - 1]?.n;
      const r = await client.run<Read>("stadeum/canvas/transcript", { job, ...(last !== undefined && from === "stored" ? { since: last } : {}) }).catch(() => null);
      if (!r) return;
      setPolled(r);
      if (r.lines?.length) setLines((have) => mergeLines(have, r.lines!));
    }, every);
    return () => clearInterval(t);
  }, [job, first.data, done, from]);

  const ingest = useCallback((raw: unknown) => {
    const b = bodyOf(raw);
    if (!b) return;
    if (b["type"] === "end") return setEnded(true);
    const s = toSpeaking(b);
    if (s) {
      setStates((m) => {
        const was = m.get(s.identity);
        if (was && was.at > s.at) return m;
        const n = new Map(m);
        n.set(s.identity, s);
        return n;
      });
      return;
    }
    if (b["type"] !== "line") return;
    setLive(true);
    const dup = linesRef.current.some((l) => l.n === Number(b["n"]));
    setCounts((c) => ({ frames: c.frames + 1, dropped: c.dropped + (dup ? 1 : 0) }));
    setLines((have) => mergeLines(have, [b]));
  }, []);
  const ingestStates = useCallback((all: unknown) => {
    const found = speakingIn(all);
    if (!found.size) return;
    setStates((m) => {
      let changed = false;
      const n = new Map(m);
      for (const [id, s] of found) {
        const was = n.get(id);
        if (was && (was.at > s.at || (was.at === s.at && was.on === s.on))) continue;
        n.set(id, s);
        changed = true;
      }
      return changed ? n : m;
    });
  }, []);

  // A lost `off` turns itself off after 30 s: look again now and then while anyone is on.
  const anyOn = [...states.values()].some((s) => s.on);
  useEffect(() => {
    if (!anyOn) return;
    const t = setInterval(() => setNow(Date.now()), 2_000);
    return () => clearInterval(t);
  }, [anyOn]);
  const speaking = useMemo(() => speakingNow(states.values(), lines, now, done), [states, lines, now, done]);

  return {
    lines,
    done,
    from,
    speaking,
    live,
    frames: counts.frames,
    dropped: counts.dropped,
    error: first.error ? (first.error instanceof Error ? first.error.message : String(first.error)) : null,
    loading: !!job && first.isLoading,
    ingest,
    ingestStates,
  };
}

export interface CallJob {
  job: string;
  title: string;
  at: number;
  busy: boolean;
}

/** The recorded calls here: every `call-…` job, newest first (`stadeum/canvas/calls`: a page's own job/list sees only
 *  the app's jobs). */
export function useCalls(enabled: boolean) {
  const client = useStrutClient();
  return useQuery({
    queryKey: ["ic", "calls"],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<CallJob[]> => {
      const r = await client.run<{ calls?: Array<{ job: string; title?: string; usedAt?: string; createdAt?: string; busy?: unknown }> }>("stadeum/canvas/calls", { limit: 100 });
      return (r.calls ?? [])
        .filter((j) => j.job.startsWith("call-"))
        .map((j) => ({ job: j.job, title: "The call", at: Date.parse(j.createdAt ?? j.usedAt ?? "") || 0, busy: !!j.busy }))
        .sort((a, b) => b.at - a.at);
    },
  });
}
