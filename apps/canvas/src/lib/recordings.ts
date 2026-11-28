// The Calls page, the pure part: a recorded call as `stadeum/canvas/calls`
// lists it (who spoke, from when to when, its summary once one is written)
// and what its row and its sheet say of it.

export interface Person {
  name: string;
  identity?: string;
}

/** A call's summary, as the summarize workflow kept it (steps/call-summary.ts). */
export interface Summary {
  title: string;
  discussed: string[];
  decided: string[];
  actions: { who: string; items: string[] }[];
  open: string[];
}

export interface Recording {
  job: string;
  title: string;
  /** When it started (its first line, else when its job was made), epoch ms; 0 when unknown. */
  at: number;
  /** Its last line, epoch ms; 0 when unknown. */
  endedAt: number;
  /** A scribe turn is running now. */
  busy: boolean;
  /** The recording stopped. */
  done: boolean;
  lines: number | null;
  people: Person[];
  summary: Summary | null;
}

const time = (v: unknown): number => {
  const t = typeof v === "string" && v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);

function toSummary(v: unknown): Summary | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const title = text(s["title"]);
  if (!title) return null;
  const actions = (Array.isArray(s["actions"]) ? s["actions"] : []).flatMap((a) => {
    const who = text((a as { who?: unknown } | null)?.who);
    const items = texts((a as { items?: unknown } | null)?.items);
    return who && items.length ? [{ who, items }] : [];
  });
  return { title, discussed: texts(s["discussed"]), decided: texts(s["decided"]), actions, open: texts(s["open"]) };
}

/** One call of the step's answer, or null when it is not a recorded call. A call with no word on whether it stopped
 *  (recorded before the facts were kept) is over unless a scribe turn is running. */
export function toRecording(raw: unknown): Recording | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const job = text(r["job"]);
  if (!job.startsWith("call-")) return null;
  const busy = !!r["busy"];
  const summary = toSummary(r["summary"]);
  const people = (Array.isArray(r["people"]) ? r["people"] : []).flatMap((p) => {
    const name = text((p as Person | null)?.name);
    const identity = text((p as Person | null)?.identity);
    return name ? [{ name, ...(identity ? { identity } : {}) }] : [];
  });
  return {
    job,
    title: summary?.title || text(r["title"]) || "A call",
    at: time(r["startedAt"]) || time(r["createdAt"]) || time(r["usedAt"]),
    endedAt: time(r["endedAt"]),
    busy,
    done: typeof r["done"] === "boolean" ? r["done"] : !busy,
    lines: typeof r["lines"] === "number" ? r["lines"] : null,
    people,
    summary,
  };
}

/** The step's answer as the page lists it: recorded calls only, newest first. */
export function toRecordings(calls: readonly unknown[] | undefined): Recording[] {
  return (calls ?? []).flatMap((c) => toRecording(c) ?? []).sort((a, b) => b.at - a.at);
}

/** How long a call ran: "under a minute", "12 min", "1 h 5 min"; "" when either end is unknown. */
export function lengthOf(c: Pick<Recording, "at" | "endedAt">): string {
  if (!c.at || !c.endedAt || c.endedAt < c.at) return "";
  const minutes = Math.round((c.endedAt - c.at) / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""}`;
}

/** "Ada Lovelace" → "Ada". */
export const firstName = (name: string): string => name.trim().split(/[\s._]+/)[0] || name.trim();

/** Who spoke, in a row's one line: "Ada, Ben and 2 more". */
export function namesOf(people: readonly Person[], most = 3): string {
  const names = [...new Set(people.map((p) => firstName(p.name)).filter(Boolean))];
  if (names.length <= most) return names.join(", ");
  return `${names.slice(0, most).join(", ")} and ${names.length - most} more`;
}

/** The lists of a summary that have something to say, in the order the sheet shows them. Action items are apart:
 *  they are by person. */
export function sectionsOf(s: Summary): { key: "discussed" | "decided" | "open"; title: string; points: string[] }[] {
  const all = [
    { key: "discussed" as const, title: "Discussed", points: s.discussed },
    { key: "decided" as const, title: "Decided", points: s.decided },
    { key: "open" as const, title: "Open questions", points: s.open },
  ];
  return all.filter((x) => x.points.length);
}

/** A call still worth asking the server about again: it is recording, or it stopped in the last few minutes and its
 *  summary is on its way. */
export function unsettled(c: Recording, now: number, graceMs = 5 * 60_000): boolean {
  if (!c.done) return true;
  return !c.summary && !!c.endedAt && now - c.endedAt < graceMs;
}
