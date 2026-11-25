// A recorded call's transcript, the pure part: lines from the store
// (`stadeum/canvas/transcript`) and from the live channel
// (`canvas-transcript.<job>`, sent by voice) merged into one stream, the
// speakers talking now, the stream cut into bubbles, and the pace a replay
// plays at. The contracts are plan.md's ("Contracts").
//
// A line: { n, at, speaker, identity?, source: voice|chat|jamie, text }. `at`
// is epoch ms on the channel and ISO in the store: either is taken. Lines are
// kept sorted by `n`; an `n` already held is dropped (the store and the
// channel overlap on open).

export type Source = "voice" | "chat" | "jamie";

export interface Line {
  n: number;
  /** Epoch ms. */
  at: number;
  speaker: string;
  identity?: string;
  source: Source;
  text: string;
}

export interface Speaking {
  identity: string;
  speaker: string;
  on: boolean;
  /** Epoch ms. */
  at: number;
}

/** An `on` older than this with no line from them since is a lost `off`. */
export const SPEAKING_STALE_MS = 30_000;

export const timeOf = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v) {
    const num = Number(v);
    if (/^\d+$/.test(v) && Number.isFinite(num)) return num;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
};

/** A line from either source, or null when it is not one. */
export function toLine(raw: unknown): Line | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r["type"] !== undefined && r["type"] !== "line") return null;
  const n = typeof r["n"] === "number" ? r["n"] : typeof r["n"] === "string" ? Number(r["n"]) : NaN;
  if (!Number.isInteger(n)) return null;
  const text = typeof r["text"] === "string" ? r["text"] : "";
  if (!text.trim()) return null;
  const src = r["source"];
  const source: Source = src === "chat" || src === "jamie" ? src : "voice";
  const identity = typeof r["identity"] === "string" && r["identity"] ? r["identity"] : undefined;
  const speaker = (typeof r["speaker"] === "string" && r["speaker"].trim()) || (source === "jamie" ? "Jamie" : identity) || "Someone";
  return { n, at: timeOf(r["at"]), speaker, ...(identity ? { identity } : {}), source, text };
}

/** `have` with `more` merged in: sorted by n, an n already held dropped. The same array when nothing was new. */
export function mergeLines(have: readonly Line[], more: readonly unknown[]): Line[] {
  const known = new Set(have.map((l) => l.n));
  const add: Line[] = [];
  for (const m of more) {
    const l = toLine(m);
    if (!l || known.has(l.n)) continue;
    known.add(l.n);
    add.push(l);
  }
  if (!add.length) return have as Line[];
  return [...have, ...add].sort((a, b) => a.n - b.n);
}

/** A channel message's own body: the frame voice sent, wherever the host's envelope put it. */
export function bodyOf(m: unknown, depth = 0): Record<string, unknown> | null {
  if (!m || typeof m !== "object" || depth > 3) return null;
  const r = m as Record<string, unknown>;
  if (typeof r["type"] === "string" && ["line", "speaking", "end"].includes(r["type"])) return r;
  for (const k of ["data", "payload", "message", "body", "value", "msg", "state"]) {
    const inner = bodyOf(r[k], depth + 1);
    if (inner) return inner;
  }
  return null;
}

export function toSpeaking(raw: unknown): Speaking | null {
  const r = bodyOf(raw);
  if (!r || r["type"] !== "speaking") return null;
  const identity = typeof r["identity"] === "string" ? r["identity"] : "";
  if (!identity) return null;
  return { identity, speaker: typeof r["speaker"] === "string" && r["speaker"] ? r["speaker"] : identity, on: r["on"] === true, at: timeOf(r["at"]) || Date.now() };
}

/** Every `speaking` state anywhere under a channel's states (the host's shape is a map or a list of messages). */
export function speakingIn(states: unknown, out: Map<string, Speaking> = new Map(), depth = 0): Map<string, Speaking> {
  if (!states || typeof states !== "object" || depth > 4) return out;
  const s = toSpeaking(states);
  if (s) {
    const was = out.get(s.identity);
    if (!was || was.at <= s.at) out.set(s.identity, s);
    return out;
  }
  for (const v of Array.isArray(states) ? states : Object.values(states as Record<string, unknown>)) speakingIn(v, out, depth + 1);
  return out;
}

/** Who is speaking now: their state is on, the call has not ended, and an `on` older than 30 s has had a line since. */
export function speakingNow(states: Iterable<Speaking>, lines: readonly Line[], now: number, ended: boolean): Speaking[] {
  if (ended) return [];
  const out: Speaking[] = [];
  for (const s of states) {
    if (!s.on) continue;
    if (now - s.at > SPEAKING_STALE_MS && !lines.some((l) => l.identity === s.identity && l.at >= s.at)) continue;
    out.push(s);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A run of lines one person said together: one bubble. */
export interface Bubble {
  key: string;
  speaker: string;
  identity?: string;
  source: Source;
  lines: Line[];
}

/** A bubble holds one speaker's lines in a row, said within `gapMs` of each other, at most `most` of them. */
export function bubblesOf(lines: readonly Line[], gapMs = 90_000, most = 6): Bubble[] {
  const out: Bubble[] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    const prev = last?.lines[last.lines.length - 1];
    if (last && prev && last.source === l.source && (last.identity ?? last.speaker) === (l.identity ?? l.speaker) && l.at - prev.at <= gapMs && last.lines.length < most) last.lines.push(l);
    else out.push({ key: `b${l.n}`, speaker: l.speaker, ...(l.identity ? { identity: l.identity } : {}), source: l.source, lines: [l] });
  }
  return out;
}

/** "Ada Lovelace" → "AL", "evan" → "EV". */
export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/** A speaker's colour, from their identity (else their name): the same person is the same colour everywhere. */
export function colourOf(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 42%)`;
}

/** The longest silence a replay plays out, and the gap between lines that share a time (the store's old minute times). */
export const REPLAY_MAX_GAP_MS = 8_000;
export const REPLAY_MIN_GAP_MS = 700;

/** When each line appears in a replay, in ms from the first: the call's own pace. Lines that share a time (an old call
 *  rebuilt to the minute) are spread evenly across the time to the next one; a long silence is cut to 8 s. */
export function paceOf(lines: readonly Line[]): number[] {
  const out: number[] = [];
  let t = 0;
  let i = 0;
  while (i < lines.length) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1]!.at === lines[i]!.at) j++;
    const next = lines[j + 1];
    const span = next && next.at > lines[i]!.at ? next.at - lines[i]!.at : (j - i + 1) * 2_000;
    const step = span / (j - i + 1);
    for (let k = i; k <= j; k++) {
      out.push(t);
      t += Math.min(REPLAY_MAX_GAP_MS, Math.max(REPLAY_MIN_GAP_MS, step));
    }
    i = j + 1;
  }
  return out;
}

/** A card the scribe wrote from the call: the job and the lines it came from. */
export interface CallRef {
  id: string;
  kind: "story" | "requirement" | "question" | "option" | "choice";
  job: string;
  lines: number[];
  title: string;
  speaker?: string;
  quote?: string;
}

const linesOf = (v: unknown): number[] => {
  let a: unknown = v;
  if (typeof v === "string") {
    try {
      a = JSON.parse(v);
    } catch {
      a = v.split(/[^0-9]+/).filter(Boolean).map(Number);
    }
  }
  if (typeof a === "number") a = [a];
  return Array.isArray(a) ? a.map(Number).filter((x) => Number.isInteger(x)) : [];
};

/** The cards among `nodes` that carry a back-link to a call (`call_job` + `call_lines`, and a choice's `state_call_*`). */
export function callRefsOf(nodes: ReadonlyArray<{ ref_id: string; name?: string; properties?: Record<string, unknown> }>, kind: CallRef["kind"]): CallRef[] {
  const out: CallRef[] = [];
  for (const n of nodes) {
    const p = n.properties ?? {};
    if (p["removed_at"]) continue;
    const title = String(p["text"] ?? p["name"] ?? n.name ?? "").trim();
    const job = typeof p["call_job"] === "string" ? p["call_job"] : "";
    const lines = linesOf(p["call_lines"]);
    if (job && lines.length) out.push({ id: n.ref_id, kind, job, lines, title, ...(p["speaker"] ? { speaker: String(p["speaker"]) } : {}), ...(p["quote"] ? { quote: String(p["quote"]) } : {}) });
    const sjob = typeof p["state_call_job"] === "string" ? p["state_call_job"] : "";
    const slines = linesOf(p["state_call_lines"]);
    if (sjob && slines.length) out.push({ id: n.ref_id, kind: "choice", job: sjob, lines: slines, title, ...(p["state_speaker"] ? { speaker: String(p["state_speaker"]) } : {}), ...(p["state_quote"] ? { quote: String(p["state_quote"]) } : {}) });
  }
  return out;
}

/** For one call: line n → the cards that cite it. */
export function citedBy(refs: readonly CallRef[], job: string): Map<number, CallRef[]> {
  const out = new Map<number, CallRef[]>();
  for (const r of refs) {
    if (r.job !== job) continue;
    for (const n of r.lines) out.set(n, [...(out.get(n) ?? []), r]);
  }
  return out;
}

export const KIND_WORD: Record<CallRef["kind"], string> = { story: "Story", requirement: "Requirement", question: "Question", option: "Option", choice: "Chosen" };

/** Channel frames for a look (deep link `sim=1`): what voice sends, with the overlaps and faults the page must take —
 *  a line it already has from the store, lines out of order, ms and ISO times, chat and Jamie, a fresh `on`, a lost
 *  `on` (older than 30 s), then `end`. `delay` is ms after the page opens. */
export function simFrames(start: number, base: number): Array<{ delay: number; kind: "event" | "state"; key?: string; body: Record<string, unknown> }> {
  const t = (s: number) => base + s * 1000;
  return [
    { delay: 600, kind: "state", key: "speaking:sim-ada", body: { type: "speaking", speaker: "Ada Park", identity: "sim-ada", on: true, at: Date.now() } },
    { delay: 700, kind: "state", key: "speaking:sim-lost", body: { type: "speaking", speaker: "Lost Lee", identity: "sim-lost", on: true, at: Date.now() - 60_000 } },
    { delay: 900, kind: "event", body: { type: "line", n: start, at: t(1), speaker: "Old Copy", identity: "sim-dup", source: "voice", text: "a line the store already has (dropped)" } },
    { delay: 1200, kind: "event", body: { type: "line", n: start + 2, at: new Date(t(6)).toISOString(), speaker: "Ada Park", identity: "sim-ada", source: "voice", text: "And the second, which arrived first, with an ISO time." } },
    { delay: 1500, kind: "event", body: { type: "line", n: start + 1, at: t(4), speaker: "Ada Park", identity: "sim-ada", source: "voice", text: "This is the first live sentence, settled." } },
    { delay: 1800, kind: "event", body: { type: "line", n: start + 3, at: t(8), speaker: "Ben Ortiz", identity: "sim-ben", source: "chat", text: "typed in the call's chat" } },
    { delay: 2100, kind: "event", body: { type: "line", n: start + 2, at: t(6), speaker: "Ada Park", identity: "sim-ada", source: "voice", text: "a duplicate n (dropped)" } },
    { delay: 2400, kind: "event", body: { type: "line", n: start + 4, at: t(10), speaker: "Jamie", source: "jamie", text: "Noted: I'll put that on the canvas." } },
    { delay: 2600, kind: "state", key: "speaking:sim-ben", body: { type: "speaking", speaker: "Ben Ortiz", identity: "sim-ben", on: true, at: Date.now() } },
    { delay: 8000, kind: "state", key: "speaking:sim-ada", body: { type: "speaking", speaker: "Ada Park", identity: "sim-ada", on: false, at: Date.now() + 8000 } },
    { delay: 8000, kind: "state", key: "speaking:sim-ben", body: { type: "speaking", speaker: "Ben Ortiz", identity: "sim-ben", on: false, at: Date.now() + 8000 } },
    { delay: 8100, kind: "event", body: { type: "end" } },
  ];
}
