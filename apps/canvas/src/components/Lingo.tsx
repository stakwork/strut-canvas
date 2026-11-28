// Right-click a word in the transcript to correct it: a small popup (heard, should be) that, on save, adds the pair
// to this server's vocabulary, the one dictation uses (strut's `dictation/add`: the word, and how it was heard). The
// corrections are read from the same vocabulary (`memory/lexicon`) and applied to every line, now and on later
// calls. A server that keeps no vocabulary has none of this: `available` is false and the transcript is plain text.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStrutClient } from "@strut/kit";
import { toast } from "sonner";
import { applyLingo, toEntries, type LingoEntry } from "../lib/lingo";

const KEY = ["ic", "lingo"];
interface Vocabulary {
  available: boolean;
  entries: LingoEntry[];
}
const NONE: Vocabulary = { available: false, entries: [] };

/** The vocabulary's corrections; `add` saves one (shown at once, with Undo). */
export function useLingo() {
  const client = useStrutClient();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<Vocabulary> => {
      try {
        const r = await client.run("memory/lexicon", {});
        return typeof r === "string" ? NONE : { available: true, entries: toEntries(r) };
      } catch {
        return NONE; // this server keeps no vocabulary
      }
    },
  });
  const { available, entries } = q.data ?? NONE;
  const undo = async (ids: string[]) => {
    try {
      await client.run("dictation/undo", { undo: ids });
    } catch (err) {
      toast.error(`Could not undo the correction: ${err instanceof Error ? err.message : String(err)}`);
    }
    void qc.invalidateQueries({ queryKey: KEY });
  };
  const add = async (e: LingoEntry): Promise<boolean> => {
    const prev = qc.getQueryData<Vocabulary>(KEY) ?? NONE;
    qc.setQueryData<Vocabulary>(KEY, { ...prev, entries: [...prev.entries.filter((x) => x.heard.toLowerCase() !== e.heard.toLowerCase()), e] });
    try {
      const r = await client.run<{ undo?: unknown } | string>("dictation/add", { written: e.corrected, heard: e.heard });
      if (typeof r === "string") throw new Error(r);
      const ids = Array.isArray(r?.undo) ? r.undo.map(String) : [];
      // Long enough to read and reach Undo: a correction applies to every line of every call.
      toast.success(`Lingo: “${e.heard}” → “${e.corrected}”`, ids.length ? { duration: 12_000, action: { label: "Undo", onClick: () => void undo(ids) } } : undefined);
      void qc.invalidateQueries({ queryKey: KEY });
      return true;
    } catch (err) {
      qc.setQueryData(KEY, prev);
      toast.error(`Could not save the correction: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };
  return { available, entries, add };
}

export interface Pick {
  x: number;
  y: number;
  heard: string;
}

export function CorrectPopup({ pick, onSave, onClose }: { pick: Pick; onSave: (e: LingoEntry) => Promise<boolean>; onClose: () => void }) {
  const [heard, setHeard] = useState(pick.heard);
  const [fixed, setFixed] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const d = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("keydown", k);
    window.addEventListener("pointerdown", d);
    return () => (window.removeEventListener("keydown", k), window.removeEventListener("pointerdown", d));
  }, []);
  const ok = heard.trim() && fixed.trim() && heard.trim() !== fixed.trim();
  const left = Math.max(8, Math.min(pick.x, window.innerWidth - 300));
  const top = Math.max(8, Math.min(pick.y, window.innerHeight - 200));
  return (
    <form
      ref={ref}
      className="lg-pop"
      style={{ left, top }}
      data-testid="lingo-popup"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || busy) return;
        setBusy(true);
        const done = await onSave({ heard: heard.trim(), corrected: fixed.trim() });
        setBusy(false);
        if (done) onClose();
      }}
    >
      <h4>Correct the transcript</h4>
      <label>
        Heard
        <input value={heard} onChange={(e) => setHeard(e.target.value)} aria-label="Heard word" />
      </label>
      <label>
        Should be
        <input ref={input} value={fixed} onChange={(e) => setFixed(e.target.value)} aria-label="Corrected word" placeholder="the right word" />
      </label>
      <div className="lg-row">
        <button type="button" className="sb-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="sb-btn" disabled={!ok || busy}>
          {busy ? "Saving…" : "Save as Lingo"}
        </button>
      </div>
    </form>
  );
}

/** A line's text with the corrections applied; right-click anywhere in it to correct the word (or the selection) there. */
export function LineText({ text, entries, onPick }: { text: string; entries: readonly LingoEntry[]; onPick: (heard: string, e: { clientX: number; clientY: number }) => void }) {
  const pieces = useMemo(() => applyLingo(text, entries), [text, entries]);
  const words = (s: string, base: number) =>
    s.split(/(\s+)/).map((w, i) =>
      /^\s*$/.test(w) ? (
        w
      ) : (
        <span key={`${base}-${i}`} className="lg-w" data-word={w}>
          {w}
        </span>
      ),
    );
  return (
    <span
      className="lg-line"
      onContextMenu={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-word],[data-fixed]");
        if (!el) return;
        e.preventDefault();
        const sel = window.getSelection()?.toString().trim() ?? "";
        const fixedFrom = el.dataset["fixed"];
        onPick(sel && sel.length < 60 && el.closest(".lg-line")?.contains(window.getSelection()?.anchorNode ?? null) ? sel : (fixedFrom ?? el.dataset["word"] ?? ""), e);
      }}
    >
      {pieces.map((p, i) =>
        p.fixed ? (
          <span key={i} className="lg-fixed" data-fixed={p.heard} title={`Heard “${p.heard}” — corrected (Lingo)`}>
            {p.text}
            <sup className="lg-mark" aria-label={`Corrected by lingo, heard “${p.heard}”`}>
              ✦
            </sup>
          </span>
        ) : (
          <span key={i}>{words(p.text, i)}</span>
        ),
      )}
    </span>
  );
}
