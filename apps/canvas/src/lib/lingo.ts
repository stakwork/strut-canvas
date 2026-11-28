// Lingo: a word the call's transcript got wrong and what it should have said. One `Lingo` graph node per correction
// (heard → corrected, with the line, speaker and call it was made on). The transcript shows every line with the
// corrections applied. Pure parts here; the read and write are `useLingo` (../components/Lingo.tsx).

export interface LingoEntry {
  ref_id?: string;
  heard: string;
  corrected: string;
  call?: string;
  line?: number;
  speaker?: string;
  context?: string;
}

/** A piece of a line: plain text, or a word a correction replaced. */
export type Piece = { text: string; fixed?: LingoEntry; heard?: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The word a right-click landed on, without the punctuation around it. */
export const cleanWord = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** `text` cut into pieces, each heard word or phrase of `entries` (whole words, any case) replaced by its correction. */
export function applyLingo(text: string, entries: readonly LingoEntry[]): Piece[] {
  const live = entries.filter((e) => e.heard.trim() && e.corrected.trim() && e.heard.trim().toLowerCase() !== e.corrected.trim().toLowerCase());
  if (!live.length) return [{ text }];
  const by = new Map<string, LingoEntry>();
  for (const e of live) by.set(e.heard.trim().toLowerCase(), e);
  const alts = [...by.keys()].sort((a, b) => b.length - a.length).map(esc);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${alts.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const out: Piece[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i) });
    const e = by.get(m[0].toLowerCase())!;
    out.push({ text: e.corrected, fixed: e, heard: m[0] });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** Whether a Lingo node's properties make an entry. */
export function toEntry(n: { ref_id: string; properties?: Record<string, unknown> }): LingoEntry | null {
  const p = n.properties ?? {};
  const heard = typeof p["heard"] === "string" ? p["heard"] : "";
  const corrected = typeof p["corrected"] === "string" ? p["corrected"] : "";
  if (!heard || !corrected) return null;
  const line = typeof p["line"] === "number" ? p["line"] : Number(p["line"]);
  return {
    ref_id: n.ref_id,
    heard,
    corrected,
    ...(typeof p["call"] === "string" ? { call: p["call"] } : {}),
    ...(Number.isFinite(line) ? { line } : {}),
    ...(typeof p["speaker"] === "string" ? { speaker: p["speaker"] } : {}),
    ...(typeof p["context"] === "string" ? { context: p["context"] } : {}),
  };
}
