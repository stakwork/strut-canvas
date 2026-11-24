// Where a card's build is: the jobs on it (the ones it records, else
// guessed from the jobs' words), their pull requests with failing checks,
// what they delivered, the other work linked to it, its architecture, and —
// on a feature with an architecture — Implement, which starts the job that
// builds it through the `implement` workflow: a Code Change job when the
// architecture says it is code in a repository, a builder job when it is
// workflows or an app on this server. The person sees which, and may switch.
import { useState } from "react";
import { useHost, useStrutClient } from "@strut/kit";
import { toast } from "sonner";
import type { Card } from "../lib/plan";
import { runToEnd, type CardJob, type CardLink, type CardWork } from "../lib/read";
import type { Architecture } from "../lib/why";

const STATE: Record<string, string> = { running: "working", done: "finished", failed: "failed" };

type BuildsIn = "repo" | "strut";
/** What Implement would start: the job's title, where it builds, and in which repositories. */
interface Preview {
  title: string;
  builds_in: BuildsIn;
  repos: string[];
}

export function BuildPanel({ card, work, jobs, links, architecture, loading }: { card: Card; work?: CardWork; jobs: CardJob[]; links: CardLink[]; architecture?: Architecture; loading?: boolean }) {
  const host = useHost();
  const client = useStrutClient();
  const [starting, setStarting] = useState(false);
  const [showArch, setShowArch] = useState(false);
  const open = (url?: string | null) => url && host.openLink(url);
  const other = links.filter((l) => l.kind !== "job");
  const [preview, setPreview] = useState<Preview | null>(null);
  /** First what it would start (a dry run of `implement`), then — on the person's yes — the job itself. */
  const look = async (builds_in?: BuildsIn) => {
    setStarting(true);
    try {
      const out = await runToEnd(client, "stadeum/canvas/implement", { feature: card.id, dry_run: true, ...(builds_in ? { builds_in } : {}) });
      setPreview({
        title: String(out["title"] ?? card.title),
        builds_in: out["builds_in"] === "strut" ? "strut" : "repo",
        repos: Array.isArray(out["repos"]) ? (out["repos"] as unknown[]).map(String) : [],
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { duration: 10_000 });
    } finally {
      setStarting(false);
    }
  };
  const implement = async (p: Preview) => {
    setStarting(true);
    setPreview(null);
    const id = `impl:${card.id}`;
    toast.loading(p.builds_in === "strut" ? "Starting a builder job" : "Starting a Code Change job", { id });
    try {
      const out = await runToEnd(client, "stadeum/canvas/implement", { feature: card.id, builds_in: p.builds_in }, `impl:${card.id}`);
      toast.success(String(out["text"] ?? "Job started."), { id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { id, duration: 10_000 });
    } finally {
      setStarting(false);
    }
  };
  if (!work && !jobs.length && !links.length && !architecture) return loading ? <span className="sb-meta">Reading its build…</span> : null;
  return (
    <>
      {loading && <span className="sb-meta">Reading its build…</span>}
      {architecture && (
        <>
          <span className="sb-meta">Architecture</span>
          <button type="button" className="sb-link" onClick={() => setShowArch((v) => !v)}>
            {architecture.name}
          </button>
          {showArch && architecture.description && <p className="ic-pre">{architecture.description}</p>}
          {showArch && architecture.diagram && <pre className="ic-diagram">{architecture.diagram}</pre>}
        </>
      )}
      {work && (work.started || work.prs.length > 0) && (
        <>
          <span className="sb-meta">Build</span>
          <p className={work.state === "blocked" ? "sb-need" : ""}>{work.line}</p>
        </>
      )}
      {jobs.length > 0 && (
        <>
          <span className="sb-meta">Jobs · {jobs.length}</span>
          <ul className="sb-kids">
            {jobs.map((j) => (
              <li key={j.job}>
                <i className={`sb-dot${j.state === "running" ? " sb-s-prog" : j.state === "failed" ? " sb-s-block" : " sb-s-done"}`} title={STATE[j.state]} />
                <span>
                  <button type="button" className="sb-link" onClick={() => open(`/jobs/${j.job}`)}>
                    {j.title}
                  </button>
                  <small className="sb-quiet"> · {STATE[j.state] ?? j.state}{j.via === "title" ? " · named in its title" : ""}</small>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {work && work.prs.length > 0 && (
        <>
          <span className="sb-meta">Pull requests · {work.prs.length}</span>
          <ul className="sb-kids">
            {work.prs.map((p, i) => (
              <li key={`${p.url}-${i}`}>
                <i className={`sb-dot${p.state === "merged" ? " sb-s-done" : p.failing.length ? " sb-s-block" : p.state === "open" || p.state === "draft" ? " sb-s-prog" : ""}`} />
                <span>
                  <button type="button" className="sb-link" onClick={() => open(p.url)}>
                    {p.repo ?? "PR"}
                    {p.number ? ` #${p.number}` : ""}
                  </button>
                  <small className="sb-quiet"> · {p.state}</small>
                  {p.failing.length > 0 && <small className="sb-need"> · failing: {p.failing.join(", ")}</small>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {work && work.artifacts.length > 0 && (
        <>
          <span className="sb-meta">What the jobs made · {work.artifacts.length}</span>
          <ul className="sb-kids">
            {work.artifacts.map((a) => (
              <li key={`${a.job}/${a.id}`}>
                <i className="sb-dot" />
                <button type="button" className="sb-link" onClick={() => open(a.url)}>
                  {a.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {other.length > 0 && (
        <>
          <span className="sb-meta">Linked work · {other.length}</span>
          <ul className="sb-kids">
            {other.map((l, i) => (
              <li key={i} title={l.why ?? undefined}>
                <i className="sb-dot" />
                <span>
                  {l.url ? (
                    <button type="button" className="sb-link" onClick={() => open(l.url)}>
                      {l.title ?? l.kind}
                    </button>
                  ) : (
                    <span>{l.title ?? l.workflow ?? (l.run ? `Run ${l.run}` : l.kind)}</span>
                  )}
                  <small className="sb-quiet"> · {l.kind}</small>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {card.role === "work" && architecture && !preview && (
        <button type="button" className="sb-btn sb-primary" disabled={starting} onClick={() => void look()}>
          {starting ? "Reading…" : "Implement"}
        </button>
      )}
      {preview && (
        <div className="sb-pencil-box" data-testid="ic-implement-confirm">
          <p>
            {preview.builds_in === "strut"
              ? `This starts a builder job, “${preview.title}”, that builds it as workflows or an app on this server.`
              : `This starts a Code Change job, “${preview.title}”, ${preview.repos.length ? `in ${preview.repos.join(", ")}` : "that finds the repositories to change"}.`}
          </p>
          <button type="button" className="sb-link sb-quiet" disabled={starting} onClick={() => void look(preview.builds_in === "strut" ? "repo" : "strut")}>
            {preview.builds_in === "strut" ? "Change code in a repository instead" : "Build it on this server instead"}
          </button>
          <span className="sb-row-btns">
            <button type="button" className="sb-btn sb-small" disabled={starting} onClick={() => void implement(preview)}>
              Start the job
            </button>
            <button type="button" className="sb-btn sb-small" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </span>
        </div>
      )}
    </>
  );
}
