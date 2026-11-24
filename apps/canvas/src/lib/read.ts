// Every read and write the page makes, on the app's grants (app.yaml).
// Reads: every node of the plan's types with `graph/find`, a page at a time,
// then the edges among them with `graph/graph-edges`, re-read (throttled)
// when the graph change feed says one of those types was written. Writes:
// one `ops` run per change, as the viewer — the workflow checks the
// status values, stamps who wrote it and soft-deletes with undo.
import { useEffect, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGraphChanges, useStrutClient, type StrutClient } from "@strut/kit";
import { toast } from "sonner";
import { buildPlan, PLAN, withPencils, type OpsInput, type Plan, type RawEdge, type RawNode, type Role, type Roles } from "./plan";
import { buildBrainstorms, BRAINSTORM, type BrainstormRoles, type Brainstorms, type TreeNode } from "./brainstorm";
import { buildWhy, WHY, type Why, type WhyRoles } from "./why";
import { PLAN_STEPS, planProposals, type ProposalRecord } from "./proposals";

const FIND = "graph/find";
/** graph/find's largest page. */
const PAGE = 500;
/** The most nodes of one type the canvas reads; past it the page says it was cut. */
export const MAX_PER_TYPE = 3000;
/** graph-edges' `ref_ids` per call. */
const EDGES_IDS = 1000;
/** graph-edges' `among` at most. */
const AMONG = 5000;

interface FindPage {
  nodes?: RawNode[];
  cursor?: string;
}

async function findAll(client: StrutClient, type: string): Promise<{ nodes: RawNode[]; truncated: boolean }> {
  const nodes: RawNode[] = [];
  let cursor: string | undefined;
  do {
    const r = await client.run(FIND, { node_type: type, where: { removed_at: null }, limit: PAGE, ...(cursor ? { cursor } : {}) });
    // A graph step answers a problem as a string. A type this graph does not hold is an empty canvas.
    if (typeof r === "string") {
      if (/unknown|no such|not (found|registered|declared)/i.test(r)) return { nodes, truncated: false };
      throw new Error(`${FIND}: ${r}`);
    }
    const page = r as FindPage;
    nodes.push(...(page.nodes ?? []));
    cursor = page.cursor;
    if (cursor && nodes.length >= MAX_PER_TYPE) return { nodes, truncated: true };
  } while (cursor);
  return { nodes, truncated: false };
}

async function edgesOf(client: StrutClient, ids: string[], among: string[]): Promise<{ edges: RawEdge[]; truncated: boolean }> {
  const edges: RawEdge[] = [];
  let truncated = false;
  const others = among.slice(0, AMONG);
  if (among.length > AMONG) truncated = true;
  for (let i = 0; i < ids.length; i += EDGES_IDS) {
    const r = await client.run<{ edges?: RawEdge[]; truncated?: boolean }>("graph/graph-edges", { ref_ids: ids.slice(i, i + EDGES_IDS), among: others });
    edges.push(...(r.edges ?? []));
    if (r.truncated) truncated = true;
  }
  return { edges, truncated };
}

/** A change counter that moves at most once per `ms`: the first change at once, the rest together
 *  when the interval ends. While jobs are writing, the graph changes many times a second, and each
 *  read here is the whole plan. */
export function useSettled(rev: number, ms: number): number {
  const [settled, setSettled] = useState(rev);
  const last = useRef(0);
  useEffect(() => {
    if (rev === settled) return;
    const wait = Math.max(0, last.current + ms - Date.now());
    const t = setTimeout(() => {
      last.current = Date.now();
      setSettled(rev);
    }, wait);
    return () => clearTimeout(t);
  }, [rev, settled, ms]);
  return settled;
}

/** The change feed's counter for some types, whichever shape this kit answers in. */
function useRev(types: string[]): number {
  const g: unknown = useGraphChanges(types);
  return typeof g === "number" ? g : Number((g as { rev?: number } | null)?.rev ?? 0);
}

export async function readPlan(client: StrutClient, roles: Roles = PLAN): Promise<{ plan: Plan; truncated: boolean }> {
  const [goal, group, work] = await Promise.all([findAll(client, roles.goal), findAll(client, roles.group), findAll(client, roles.work)]);
  const nodes: Record<Role, RawNode[]> = { goal: goal.nodes, group: group.nodes, work: work.nodes };
  const ids = [...goal.nodes, ...group.nodes, ...work.nodes].map((n) => n.ref_id);
  const e = await edgesOf(client, ids, []);
  return { plan: buildPlan(nodes, e.edges, roles), truncated: goal.truncated || group.truncated || work.truncated || e.truncated };
}

/** The plan, re-read when a write to one of its types lands, at most every few seconds. */
export function usePlan(roles: Roles = PLAN) {
  const client = useStrutClient();
  const rev = useSettled(useRev([roles.goal, roles.group, roles.work]), 5_000);
  return useQuery({
    queryKey: ["ic", "plan", roles.goal, roles.group, roles.work, rev],
    queryFn: () => readPlan(client, roles),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

const liveIds = (plan: Plan) => Object.keys(plan.cards).filter((id) => !plan.cards[id]!.pencil);

export async function readBrainstorms(client: StrutClient, plan: Plan, roles: BrainstormRoles = BRAINSTORM): Promise<Brainstorms> {
  const [questions, options] = await Promise.all([findAll(client, roles.question), findAll(client, roles.option)]);
  const own = [...questions.nodes, ...options.nodes].map((n) => n.ref_id);
  // A question's edge to the card it is about leads out of the brainstorm, into the plan.
  const { edges } = await edgesOf(client, own, liveIds(plan));
  return buildBrainstorms(questions.nodes, options.nodes, edges, plan, roles);
}

/** The brainstorms about the plan's cards, read once the plan is, and again when one is written. */
export function useBrainstorms(plan: Plan | undefined, roles: BrainstormRoles = BRAINSTORM) {
  const client = useStrutClient();
  const rev = useSettled(useRev([roles.question, roles.option]), 10_000);
  return useQuery({
    queryKey: ["ic", "brainstorms", roles.question, roles.option, rev, plan ? Object.keys(plan.cards).length : 0],
    enabled: !!plan,
    queryFn: () => readBrainstorms(client, plan!, roles),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

/** One brainstorm's whole tree — options with their ratings, pros and cons — for the question picked. */
export function useTree(root: string | null) {
  const client = useStrutClient();
  const rev = useSettled(useRev([BRAINSTORM.question, BRAINSTORM.option]), 5_000);
  return useQuery({
    queryKey: ["ic", "tree", root, rev],
    enabled: !!root,
    queryFn: () => client.run<{ nodes: TreeNode[] }>("stadeum/canvas/brainstorm-tree", { root: root! }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** The trees of the questions opened on the brainstorm tree, one `canvas/brainstorm-tree` read each, merged by ref_id. */
export function useTrees(roots: string[]): { byRef: Map<string, TreeNode>; loading: Set<string> } {
  const client = useStrutClient();
  const rev = useSettled(useRev([BRAINSTORM.question, BRAINSTORM.option]), 5_000);
  const results = useQueries({
    queries: roots.map((root) => ({
      queryKey: ["ic", "tree", root, rev],
      queryFn: () => client.run<{ nodes: TreeNode[] }>("stadeum/canvas/brainstorm-tree", { root }).catch(() => ({ nodes: [] as TreeNode[] })),
      staleTime: 30_000,
      placeholderData: (prev: { nodes: TreeNode[] } | undefined) => prev,
    })),
  });
  const byRef = new Map<string, TreeNode>();
  const loading = new Set<string>();
  results.forEach((r, i) => {
    if (!r.data) loading.add(roots[i]!);
    for (const n of r.data?.nodes ?? []) if (!byRef.has(n.ref_id) || n.kind === "option") byRef.set(n.ref_id, n);
  });
  return { byRef, loading };
}

export async function readWhy(client: StrutClient, plan: Plan, roles: WhyRoles = WHY): Promise<Why> {
  const [briefs, stories, requirements, architectures] = await Promise.all([findAll(client, roles.brief), findAll(client, roles.story), findAll(client, roles.requirement), findAll(client, roles.architecture)]);
  const own = [...briefs.nodes, ...stories.nodes, ...requirements.nodes, ...architectures.nodes].map((n) => n.ref_id);
  // A goal's edge to its brief and stories, work's to a requirement or its architecture, come in from the plan.
  const { edges } = await edgesOf(client, own, liveIds(plan));
  return buildWhy({ briefs: briefs.nodes, stories: stories.nodes, requirements: requirements.nodes, architectures: architectures.nodes }, edges, plan, roles);
}

/** Each goal's brief, stories and requirements, the work that answers them, and each feature's architecture. */
export function useWhy(plan: Plan | undefined, roles: WhyRoles = WHY) {
  const client = useStrutClient();
  const rev = useSettled(useRev([roles.brief, roles.story, roles.requirement, roles.architecture]), 10_000);
  return useQuery({
    queryKey: ["ic", "why", rev, plan ? Object.keys(plan.cards).length : 0],
    enabled: !!plan,
    queryFn: () => readWhy(client, plan!, roles),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

/** A job working on a card, as `work` says: the jobs the card records, and any whose title carries its ref. */
export interface CardJob {
  job: string;
  title: string;
  state: "running" | "done" | "failed";
  via?: "card" | "title";
  error?: string;
  by?: string;
}
export interface CardLink {
  kind: "job" | "run" | "artifact" | "workflow" | "chat" | "other";
  title: string | null;
  url: string | null;
  job: string | null;
  run: string | null;
  workflow: string | null;
  by: string | null;
  why: string | null;
}
export interface CardWork {
  state: "not_started" | "in_progress" | "done" | "blocked";
  line: string;
  reason?: string;
  jobs: CardJob[];
  prs: Array<{ url?: string; repo?: string | null; number?: number | null; state: string; failing: string[]; title?: string }>;
  repos: string[];
  artifacts: Array<{ id: string; kind: string; title: string; url?: string; job: string }>;
}
export interface Work {
  work: Record<string, CardWork>;
  jobs_by_ref: Record<string, CardJob[]>;
  links: Record<string, CardLink[]>;
}

/** The build of one goal's cards: jobs, pull requests, artifacts and linked work, read for the goal on screen only. */
export function useWork(plan: Plan | undefined, goal: string | null) {
  const client = useStrutClient();
  const rev = useSettled(useRev([PLAN.goal, PLAN.group, PLAN.work]), 30_000);
  const features = plan && goal ? collect(plan, goal).filter((id) => plan.cards[id]!.role === "work") : [];
  const also = plan && goal ? collect(plan, goal).filter((id) => plan.cards[id]!.role !== "work") : [];
  const q = useQuery({
    queryKey: ["ic", "work", goal, features.length, rev],
    enabled: !!plan && !!goal,
    // The quick read, for every card on the map: its links and whether their jobs are working now.
    queryFn: () => client.run<Work>("stadeum/canvas/work", { features: features.map((id) => ({ ref_id: id, name: plan!.cards[id]!.title })), also, detail: false }),
    staleTime: 60_000,
    placeholderData: (prev) => (prev && goal ? prev : undefined),
    // While a job on these cards runs, look again now and then; otherwise only when the plan changes.
    refetchInterval: (query) => (Object.values(query.state.data?.jobs_by_ref ?? {}).some((js) => js.some((j) => j.state === "running")) ? 30_000 : false),
  });
  return q;
}

/** One card's whole build — each job's state, its pull requests and what it made — read when the card is picked.
 *  A card nobody linked work to gets its jobs guessed from their words. */
export function useCardWork(plan: Plan | undefined, id: string | null) {
  const client = useStrutClient();
  const card = plan && id ? plan.cards[id] : undefined;
  return useQuery({
    queryKey: ["ic", "card-work", id],
    enabled: !!card && !card.pencil,
    queryFn: () => client.run<Work>("stadeum/canvas/work", card!.role === "work" ? { features: [{ ref_id: card!.id, name: card!.title }], also: [] } : { features: [], also: [card!.id] }),
    staleTime: 60_000,
  });
}

/** A goal and everything under it, live cards only. */
function collect(plan: Plan, goal: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    if (!plan.cards[id] || plan.cards[id]!.pencil) return;
    out.push(id);
    for (const k of plan.kids[id] ?? []) walk(k);
  };
  walk(goal);
  return out;
}

export interface LiveJob {
  job: string;
  title: string;
}

/** The viewer's jobs that are working right now (`job/list`'s `busy`). */
export function useLiveJobs() {
  const client = useStrutClient();
  return useQuery({
    queryKey: ["ic", "live"],
    refetchInterval: 20_000,
    queryFn: async (): Promise<LiveJob[]> => {
      const r = await client.run("job/list", { limit: 50 }).catch(() => null);
      const jobs = (r && typeof r === "object" ? (r as { jobs?: Array<{ job: string; title?: string; busy?: unknown }> }).jobs : null) ?? [];
      return jobs.filter((j) => j.busy).map((j) => ({ job: j.job, title: j.title?.trim() || "Untitled job" }));
    },
  });
}

/** What waits on the viewer's yes or no (`proposal/list`, each person their own); the ones that could touch the plan read in full. */
export function useProposals() {
  const client = useStrutClient();
  return useQuery({
    queryKey: ["ic", "proposals"],
    refetchInterval: 30_000,
    queryFn: async (): Promise<{ records: ProposalRecord[]; others: number }> => {
      const r = await client.run<{ proposals?: Array<{ id: string; step: string; title?: string; rationale?: string }> }>("proposal/list", { status: "pending", limit: 50 }).catch(() => null);
      const list = r?.proposals ?? [];
      const plan = list.filter((p) => PLAN_STEPS.has(p.step)).slice(0, 25);
      const records = await Promise.all(plan.map((p) => client.run<ProposalRecord>("proposal/get", { id: p.id }).catch(() => ({ ...p, input: undefined }) as ProposalRecord)));
      return { records, others: list.length - plan.length };
    },
  });
}

/** The plan with its pending proposals drawn in pencil, and which proposals are about it. */
export function usePlanWithPencils(plan: Plan | undefined, records: ProposalRecord[] | undefined) {
  if (!plan) return { plan: undefined, about: new Map<string, string>() };
  if (!records?.length) return { plan, about: new Map<string, string>() };
  const p = planProposals(records, plan);
  return { plan: withPencils(plan, p.made, p.edits), about: p.about };
}

const IN_FLIGHT = new Set(["running", "queued", "pending", "paused", "cancelling"]);

/** Launch a workflow as the viewer and wait for its end: its output, or an Error saying why it failed. */
export async function runToEnd(client: StrutClient, workflow: string, input: Record<string, unknown>, key?: string): Promise<Record<string, unknown>> {
  const l = await client.run<{ runId: string }>("run/launch", { workflow, input, ...(key ? { key } : {}) });
  for (let i = 0; i < 60; i++) {
    const r = await client.run<{ status: string; output?: Record<string, unknown>; error?: { message?: string } }>("run/get", { workflow, runId: l.runId, wait: 15_000 });
    if (IN_FLIGHT.has(r.status)) continue;
    if (r.status === "success") return r.output ?? {};
    throw new Error(r.error?.message ?? `${workflow} ${r.status}`);
  }
  throw new Error(`${workflow} is still running; it will show when it ends`);
}

/** A failed write's reason, without the step's own prefix. */
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^stadeum\/canvas\/op:\s*/, "");

/** A person's change, one `ops` run each: a toast while it runs, the reason when it is refused, Undo after a delete.
 *  Resolves to the run's output, or null when it did not happen. */
export function useOps() {
  const client = useStrutClient();
  const qc = useQueryClient();
  const act = async (input: OpsInput, label: string): Promise<Record<string, unknown> | null> => {
    const id = `ops:${Date.now()}:${Math.random()}`;
    toast.loading(label, { id });
    try {
      const out = await runToEnd(client, "stadeum/canvas/ops", input);
      toast.dismiss(id);
      void qc.invalidateQueries({ queryKey: ["ic"] });
      if (input.op === "remove") {
        const ref = String(out["ref_id"] ?? input.ref_id);
        toast(String(out["text"] ?? "Removed."), { duration: 12_000, action: { label: "Undo", onClick: () => void act({ op: "restore", ref_id: ref }, "Restoring") } });
      }
      return out;
    } catch (err) {
      toast.error(reason(err), { id, duration: 10_000 });
      return null;
    }
  };
  return act;
}

/** A pending proposal decided from the canvas (`proposal/decide`). */
export function useDecide() {
  const client = useStrutClient();
  const qc = useQueryClient();
  return async (id: string, action: "accept" | "reject"): Promise<string | null> => {
    try {
      const r = await client.run<{ status?: string; error?: string }>("proposal/decide", { id, action });
      void qc.invalidateQueries({ queryKey: ["ic"] });
      return r?.status === "failed" ? (r.error ?? "It failed when it ran.") : null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };
}
