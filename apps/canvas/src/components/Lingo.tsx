// Right-click a word in the transcript to correct it: a small popup (heard, corrected) that, on save, writes a
// `Lingo` node to the graph (graph/create-node). Corrections apply to every line, now and on later calls.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStrutClient } from "@strut/kit";
import { toast } from "sonner";
import { applyLingo, toEntry, type LingoEntry } from "../lib/lingo";

const KEY = ["ic", "lingo"];

/** Every Lingo node, as entries; `add` writes one (and shows it at once). */
export function useLingo() {
  const client = useStrutClient();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    staleTime: 15_000,
    queryFn: async (): Promise<LingoEntry[]> => {
      const r = await client.run("graph/find", { node_type: "Lingo", limit: 500 });
      if (typeof r === "string") return []; // the type is not on this graph yet: no corrections
      const nodes = ((r as { nodes?: Array<{ ref_id: string; properties?: Record<string, unknown> }> }).nodes ?? []);
      return nodes.map(toEntry).filter((e): e is LingoEntry => !!e);
    },
  });
  const entries = q.data ?? [];
  const add = async (e: LingoEntry): Promise<boolean> => {
    const prev = qc.getQueryData<LingoEntry[]>(KEY) ?? [];
    qc.setQueryData<LingoEntry[]>(KEY, [...prev.filter((x) => x.heard.toLowerCase() !== e.heard.toLowerCase()), e]);
    try {
      const r = await client.run("graph/create-node", {
        node_type: "Lingo",
        node_data: {
          name: `${e.heard} → ${e.corrected}`,
          heard: e.heard,
          corrected: e.corrected,
          ...(e.call ? { call: e.call } : {}),
          ...(e.line !== undefined ? { line: e.line } : {}),
          ...(e.speaker ? { speaker: e.speaker } : {}),
          ...(e.context ? { context: e.context } : {}),
          corrected_at: new Date().toISOString(),
        },
      });
      if (typeof r === "string" && !/warning|exist/i.test(r)) throw new Error(r);
      toast.success(`Lingo: “${e.heard}” → “${e.corrected}”`);
      void qc.invalidateQueries({ queryKey: KEY });
      return true;
    } catch (err) {
      qc.setQueryData(KEY, prev);
      toast.error(`Could not save the correction: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };
  return { entries, add };
}

export interface Pick {
  x: number;
  y: number;
  heard: string;
  line: number;
  speaker: string;
  context: string;
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
        const done = await onSave({ heard: heard.trim(), corrected: fixed.trim(), line: pick.line, speaker: pick.speaker, context: pick.context });
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
