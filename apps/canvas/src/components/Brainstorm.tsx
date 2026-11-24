// An option's fast / good / cheap ratings as pips, drawn on the brainstorm tree (./ThinkTree.tsx).
import { pips } from "../lib/brainstorm";

export function Pips({ label, score }: { label: string; score: number | null | undefined }) {
  const n = pips(score);
  if (!n) return null;
  return (
    <span className="ic-pips" title={`${label}: ${n} of 3`}>
      {label}{" "}
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= n ? "on" : ""} />
      ))}
    </span>
  );
}
