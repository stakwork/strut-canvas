// Which of the canvas's reads a graph write touches. The page follows every
// type it draws through ONE change feed: each feed is a request held open on
// the server, and over plain HTTP a browser keeps six connections to it, so
// five feeds (one per read) plus a job's left nothing for the reads
// themselves, and a card written by a job waited up to 25 s to show. Each
// read is read again only when a write of its own types lands. Pure.
import { PLAN } from "./plan";
import { BRAINSTORM } from "./brainstorm";
import { WHY } from "./why";

/** Each read the page makes, and the node types it shows. */
export const READS = {
  plan: [PLAN.goal, PLAN.group, PLAN.work],
  brainstorm: [BRAINSTORM.question, BRAINSTORM.option, "Effect"],
  why: [WHY.brief, WHY.story, WHY.requirement, WHY.architecture],
} as const;
export type Read = keyof typeof READS;
export type Revs = Record<Read, number>;

/** Every type the canvas draws: what its one feed follows. */
export const FEED_TYPES: string[] = [...new Set(Object.values(READS).flat())];

/** A write as the feed reports it: a node with its type, or an edge with its ends' types where known. */
export interface Change {
  node_type?: string;
  types?: string[];
}

/** The reads a batch of writes touches. A batch that names no type (the server restarted, or an edge whose ends it
 *  does not know) touches every read. */
export function readsTouched(changes: readonly Change[]): Set<Read> {
  const all = new Set(Object.keys(READS) as Read[]);
  if (!changes.length) return all;
  const out = new Set<Read>();
  for (const c of changes) {
    const types = (c.node_type ? [c.node_type] : (c.types ?? [])).map((t) => t.toLowerCase());
    if (!types.length) return all;
    for (const [read, ts] of Object.entries(READS) as Array<[Read, readonly string[]]>) if (ts.some((t) => types.includes(t.toLowerCase()))) out.add(read);
  }
  return out;
}

/** The counters moved on by one batch. */
export function bump(revs: Revs, touched: ReadonlySet<Read>): Revs {
  if (!touched.size) return revs;
  const out = { ...revs };
  for (const r of touched) out[r] += 1;
  return out;
}
