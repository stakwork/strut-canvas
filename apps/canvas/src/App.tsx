// Infinite Canvas: the plan as a map on a paper desk. The whole page is the
// canvas. It opens on the home map — the initiatives in progress ringed
// round the centre, the rest one click away — and each initiative opens
// into its own map: a road left to right through its milestones (by
// `sequence`), each milestone's features in a plot beside it, and one card
// under the gate that opens its brainstorm as a tree of decisions.
// Green is done, a pulsing blue outline is being built now, amber is blocked
// or needs you, a dashed outline is not started; pencil (dashed, faint) is
// what an agent proposed and nobody accepted.
//
// Map is computed from the plan (lib/map.ts), never stored; so is the
// Brainstorm tree (lib/thinktree.ts). Nothing on either is moved by hand. The
// camera lives in a ref and writes the world's transform directly, so
// panning and zooming re-render nothing.
//
// Reads are the generic graph steps (lib/read.ts); every write is one
// `ops` run as the viewer; Jamie is strut/jamie's own Thread.
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useAppState, useHost, useToolInput } from "@strut/kit";
import { Toaster, toast } from "sonner";
import "./fonts.css";
import "./board.css";
import { useBrainstorms, useCanvasFeed, useCardWork, useDecide, useLiveJobs, useOps, usePlan, usePlanWithPencils, useProposals, useWhy, useWork, type CardJob } from "./lib/read";
import { addRequest, goalOf, PLAN, mapGoals, openingGoals, progress, type Card, type Plan, type Role, type State } from "./lib/plan";
import { CardFacts } from "./components/Details";
import { asksIn, jobsByCard, openByGoal } from "./lib/brainstorm";
import { fontOf } from "./lib/font";
import { authorOf, directoryOf } from "./lib/author";
import { AuthorDirectory, Byline } from "./components/Byline";
import { boundsOf, BRAINSTORM_SPOT, CARD_W, GROUP_W, goalMap, homeMap, TILE_H, TILE_W, type MapLayout } from "./lib/map";
import { JamieDock } from "./components/Jamie";
import { WhySheet, type Trace } from "./components/WhySheet";
import { ThinkTree } from "./components/ThinkTree";
import { asksAbove, subtreeBox, thinkTree, type Show } from "./lib/thinktree";
import { BuildPanel } from "./components/Build";
import { Palette } from "./components/Palette";
import { workFor } from "./lib/why";
import { usePresenter } from "./lib/present";
import { whyPlace } from "./lib/follow";
import type { Hit } from "./lib/search";

const STATE_WORD: Record<State, string> = { idle: "Not started", prog: "In progress", done: "Done", block: "Blocked" };
const ROLE_WORD: Record<Role, string> = { goal: "Initiative", group: "Milestone", work: "Feature" };
const HOME = "all";
type Menu = "boards" | "needs" | "live" | null;

interface Camera {
  x: number;
  y: number;
  z: number;
}

/** A card's small line: what it is, its state, how much under it is done. */
function metaOf(plan: Plan, c: Card): string {
  if (c.pencil) return `${ROLE_WORD[c.role]} · proposed`;
  const p = progress(plan, c.id);
  const done = p.total ? ` · ${p.done} of ${p.total} done` : "";
  if (c.role === "goal") return `${ROLE_WORD.goal}${c.state === "block" ? " · blocked" : c.status ? ` · ${c.status.replace(/_/g, " ")}` : ""}${done}`;
  return `${ROLE_WORD[c.role]} · ${STATE_WORD[c.state]}${done}`;
}

/** A failure anywhere on the canvas says what it was, on the desk, instead of leaving a blank page. */
class Fence extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  override render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <div className="sb">
        <div className="sb-note" style={{ width: "min(640px, calc(100% - 32px))", textAlign: "left" }}>
          <h2>The canvas hit a problem</h2>
          <p>{e.message}</p>
          <p style={{ marginTop: 8, fontSize: 11, whiteSpace: "pre-wrap" }}>{(e.stack ?? "").split("\n").slice(1, 6).join("\n")}</p>
        </div>
      </div>
    );
  }
}

export default function App() {
  // Who wrote what, by name: user id → login, from every author the board has read (lib/author.ts).
  const [authors, setAuthors] = useState<Record<string, string>>({});
  return (
    <Fence>
      <AuthorDirectory.Provider value={authors}>
        <Board onAuthors={setAuthors} />
      </AuthorDirectory.Provider>
      <Toaster position="bottom-right" />
    </Fence>
  );
}

function Board({ onAuthors }: { onAuthors: (dir: Record<string, string>) => void }) {
  // One graph change feed for every read (lib/feed.ts): a page has only so many connections to the server.
  const revs = useCanvasFeed();
  const { data, error, isLoading } = usePlan(revs.plan);
  const proposals = useProposals().data;
  const { plan, about: proposalAbout } = usePlanWithPencils(data?.plan, proposals?.records);
  const base = data?.plan;
  const b = useBrainstorms(base, revs.brainstorm).data;
  const why = useWhy(base, revs.why).data;
  const authorDir = useMemo(
    () =>
      directoryOf([
        ...Object.values(plan?.cards ?? {}).map((c) => authorOf(c.props)),
        ...Object.values(b?.asks ?? {}).map((a) => a.author),
        ...Object.values(b?.choices ?? {}).map((o) => o.author),
        ...Object.values(why?.stories ?? {}).map((s) => s.author),
        ...Object.values(why?.requirements ?? {}).map((r) => r.author),
      ]),
    [plan, b, why],
  );
  const authorKey = JSON.stringify(authorDir);
  useEffect(() => onAuthors(authorDir), [authorKey]);
  const live = useLiveJobs().data ?? [];
  const act = useOps();
  const decide = useDecide();
  const toolInput = useToolInput<Record<string, string>>();
  // Presented (`present: <job>`): what Jamie shows a call. It follows that job's writes (lib/present.ts).
  const present = typeof toolInput?.["present"] === "string" && toolInput["present"] ? toolInput["present"] : null;
  const host = useHost();
  // The canvas always opens on the home map (the Board's rule): where the viewer was is not restored.
  // Earlier versions kept it in app state ("board", "camera"); an open clears those keys.
  const [where, setWhere] = useState<string>(HOME);
  const [oldBoard, setOldBoard, oldBoardMeta] = useAppState<string | null>("board", null);
  const [oldCams, setOldCams, oldCamsMeta] = useAppState<Record<string, Camera> | null>("camera", null);
  useEffect(() => {
    if (oldBoardMeta?.loaded && oldBoard !== null) setOldBoard(null);
  }, [oldBoardMeta?.loaded, oldBoard]);
  useEffect(() => {
    if (oldCamsMeta?.loaded && oldCams !== null) setOldCams(null);
  }, [oldCamsMeta?.loaded, oldCams]);
  /** A job to show in the docked chat (a press on it under Working now); a new `n` is a new press. */
  const [focusJob, setFocusJob] = useState<{ job: string; n: number } | null>(null);
  const [everything, setEverything] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [chat, setChat] = useState(false);
  const [palette, setPalette] = useState(false);
  /** The Why sheet is open, and what is picked on it. */
  const [sheet, setSheet] = useState(false);
  const [trace, setTrace] = useState<Trace>({ story: null, requirement: null });

  const goal = plan && where !== HOME && plan.cards[where]?.role === "goal" ? where : null;
  const work = useWork(base, goal, revs.plan).data;
  const opening = useMemo(() => (plan ? openingGoals(plan) : []), [plan]);
  const all = useMemo(() => (plan ? mapGoals(plan) : []), [plan]);
  const shown = useMemo(() => (plan ? (everything ? all : opening) : []), [plan, everything, opening, all]);
  const shelf = useMemo(() => (plan && b && goal ? asksIn(plan, b, goal) : []), [plan, b, goal]);
  const mapped: MapLayout | null = useMemo(() => (plan ? (goal ? goalMap(plan, goal, shelf) : homeMap(plan, shown, !everything)) : null), [plan, goal, shown, shelf, everything]);
  // Map is the canvas's own drawing of the plan; Brainstorm is the initiative's questions as a tree.
  // The canvas always opens on the Map. (Free, a viewer's own arrangement, is gone: its saved
  // positions stay in app state under "free", unread.)
  const [mode, setMode] = useState<"map" | "think">("map");
  // Brainstorm: the initiative's questions as a tree on the canvas, grouped under what they are about.
  const think = mode === "think" && !!goal;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [showAsks, setShowAsks] = useState<Show>("all");
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const tree = useMemo(() => (think && plan && b && goal ? thinkTree(plan, b, goal, { folded, expanded, show: showAsks, sizes }) : null), [think, plan, b, goal, folded, expanded, showAsks, sizes]);
  const boardKey = goal ?? HOME;
  const layout: MapLayout | null = mapped;
  const openAsks = useMemo(() => (plan && b ? openByGoal(plan, b) : {}), [plan, b]);

  // The jobs working on each card now: the build's (linked first, else guessed) and the viewer's
  // running jobs that wrote a question about it.
  const working = useMemo(() => {
    const out = new Map<string, { job: string; title: string }>();
    for (const [card, jobs] of Object.entries(work?.jobs_by_ref ?? {})) {
      const j = (jobs as CardJob[]).find((x) => x.state === "running");
      if (j) out.set(card, { job: j.job, title: j.title });
    }
    if (b && live.length) {
      const busy = new Map(live.map((j) => [j.job, j.title]));
      for (const [card, jobs] of Object.entries(jobsByCard(b))) {
        const j = jobs.find((id) => busy.has(id));
        if (j && !out.has(card)) out.set(card, { job: j, title: busy.get(j)! });
      }
    }
    return out;
  }, [work, b, live]);

  const desk = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ x: 0, y: 0, z: 1 });
  // Threads: a dotted line from what is picked on the Why sheet to each lit card on the map. Drawn from
  // where the elements are on screen, so it is redrawn whenever the camera moves, without a render.
  const threads = useRef<SVGSVGElement>(null);
  const drawThreads = useCallback(() => {
    const svg = threads.current;
    const d = desk.current;
    if (!svg || !d) return;
    const o = d.getBoundingClientRect();
    const from = [...d.querySelectorAll<HTMLElement>('[data-thread="from"]')];
    const to = [...d.querySelectorAll<HTMLElement>(".sb-lit")];
    const edge = d.querySelector<HTMLElement>(".sb-why")?.getBoundingClientRect();
    const nodes: SVGElement[] = [];
    for (const f of from) {
      const a = f.getBoundingClientRect();
      const y1 = Math.max((edge?.top ?? a.top) + 14, Math.min((edge?.bottom ?? a.bottom) - 14, a.top + Math.min(a.height / 2, 22))) - o.top;
      const x1 = (edge?.right ?? a.right) - o.left + 2;
      for (const t of to) {
        const r = t.getBoundingClientRect();
        if (r.right < x1 + o.left || r.left > o.right || r.bottom < o.top || r.top > o.bottom) continue;
        const x2 = Math.max(r.left - o.left, x1 + 12);
        const y2 = r.top + r.height / 2 - o.top;
        const m = x1 + (x2 - x1) / 2;
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`);
        nodes.push(p);
      }
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", String(x1));
      c.setAttribute("cy", String(y1));
      c.setAttribute("r", "3");
      nodes.push(c);
    }
    svg.replaceChildren(...nodes);
  }, []);
  const apply = useCallback(
    (fly = false) => {
      const w = world.current;
      const d = desk.current;
      if (!w || !d) return;
      const c = cam.current;
      w.classList.toggle("sb-fly", fly);
      w.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.z})`;
      // The linen moves with the cards.
      const tile = 320 * Math.max(c.z, 0.45);
      d.style.backgroundSize = `${tile}px ${tile}px`;
      d.style.backgroundPosition = `${c.x}px ${c.y}px`;
      drawThreads();
    },
    [drawThreads],
  );
  // A panel docked on the left (the Why sheet, or Jamie) covers that much of the desk; a picked card's details,
  // docked on the right, this much. The camera keeps what it frames clear of both.
  const inset = sheet || chat ? 444 : 0;
  const right = !present && plan && picked && plan.cards[picked] ? 344 : 0;

  const fit = useCallback(
    (fly = false) => {
      const d = desk.current;
      const box = think ? tree?.box : layout && boundsOf(layout);
      if (!d || !box) return;
      const r = d.getBoundingClientRect();
      if (!r.width) return;
      const w = box.x1 - box.x0 + 80;
      const h = box.y1 - box.y0 + 190;
      // A goal's road can be long: open readable at its start, not shrunk to a line.
      const room = Math.max(240, r.width - inset - right);
      const z = Math.max(think ? 0.62 : goal ? 0.55 : 0.16, Math.min(1, room / w, r.height / h));
      cam.current = { z, x: inset + (w * z > room ? 16 : (room - w * z) / 2) - (box.x0 - 40) * z, y: (h * z > r.height ? (think ? 116 : 70) : (r.height - h * z) / 2 + 20) - (box.y0 - 40) * z };
      apply(fly);
    },
    [layout, goal, apply, inset, right, think, tree],
  );
  // A new board, or more of it shown: frame it. Brainstorms arriving on the shelf do not move the camera.
  const framed = useRef("");
  useLayoutEffect(() => {
    const key = `${goal ?? HOME}/${shown.length}/${plan ? Object.keys(plan.cards).length : 0}/${inset}/${think}/${think && !!tree}`;
    if (framed.current === key) return;
    framed.current = key;
    fit();
  }, [fit, goal, shown.length, plan, think, tree]);

  /** Bring a box of the world into view, moving the camera as little as it can; it never zooms out below 0.5. */
  const reveal = useCallback(
    (box: { x0: number; y0: number; x1: number; y1: number }, fly = true) => {
      const r = desk.current?.getBoundingClientRect();
      if (!r) return;
      const c = cam.current;
      // Zoom out only as far as the box's width needs (never below 0.5), about the window's middle.
      const z = Math.max(0.5, Math.min(c.z, (r.width - inset - right - 60) / (box.x1 - box.x0 + 40)));
      let x = c.x * (z / c.z) + (r.width / 2) * (1 - z / c.z);
      let y = c.y * (z / c.z) + (r.height / 2) * (1 - z / c.z);
      const left = inset + 24;
      const edge = r.width - right - 24;
      const top = 110;
      const bottom = r.height - 110;
      // Right edge into view, then the left edge wins; the same for the bottom, then the top.
      if (box.x1 * z + x > edge) x -= box.x1 * z + x - edge;
      if (box.x0 * z + x < left) x += left - (box.x0 * z + x);
      if (box.y1 * z + y > bottom) y -= box.y1 * z + y - bottom;
      if (box.y0 * z + y < top) y += top - (box.y0 * z + y);
      cam.current = { x, y, z };
      apply(fly);
    },
    [apply, inset, right],
  );
  /** A question to bring into view once the tree has drawn it opened. */
  const revealAsk = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = revealAsk.current;
    if (!id || !tree?.nodes[id]) return;
    revealAsk.current = null;
    const box = subtreeBox(tree, id);
    if (box) reveal(box);
  }, [tree, reveal]);
  /** Open a question on the brainstorm tree: its initiative's tree, the questions above it opened, it opened and in view. */
  const showAsk = (id: string) => {
    if (!b?.asks[id]) return;
    const chain = asksAbove(b, id);
    setMode("think");
    setShowAsks((s) => (s === "all" || (s === "open") === b.asks[chain[0] ?? id]!.open ? s : "all"));
    setExpanded((e) => new Set([...e, ...chain, id]));
    const top = chain[0] ?? id;
    const about = b.asks[top]!.about;
    if (about) setFolded((f) => {
      if (!f.size) return f;
      const n = new Set(f);
      let at: string | undefined = about;
      while (at) {
        n.delete(at);
        at = plan?.parent[at];
      }
      return n;
    });
    setPicked(id);
    setMenu(null);
    revealAsk.current = id;
  };
  const toggleAsk = (id: string) => {
    setPicked(id);
    setExpanded((e) => {
      const n = new Set(e);
      if (n.has(id)) n.delete(id);
      else {
        n.add(id);
        revealAsk.current = id;
      }
      return n;
    });
  };

  /** Bring a card to the middle of the window: of what the panels leave clear, with its details open beside it. */
  const flyTo = useCallback(
    (id: string) => {
      const s = layout?.spots[id];
      const r = desk.current?.getBoundingClientRect();
      if (!s || !r) return;
      const z = Math.max(cam.current.z, 0.75);
      const clear = present ? 0 : 344;
      cam.current = { z, x: inset + (r.width - inset - clear) / 2 - (s.x + 120) * z, y: r.height / 2 - (s.y + 50) * z };
      apply(true);
    },
    [layout, apply, inset, present],
  );
  /** Where a card sits on the map, as a box of the world. */
  const spotBox = (id: string) => {
    const s = layout?.spots[id];
    const role = plan?.cards[id]?.role;
    if (!s || !role) return null;
    const w = role === "work" ? TILE_W : role === "group" ? GROUP_W : CARD_W;
    return { x0: s.x, y0: s.y, x1: s.x + w, y1: s.y + (role === "work" ? TILE_H : 110) };
  };
  // A card picked where its own details would cover it is brought out from under them.
  useLayoutEffect(() => {
    if (!picked || !right || think) return;
    const box = spotBox(picked);
    const r = desk.current?.getBoundingClientRect();
    if (!box || !r) return;
    const c = cam.current;
    if (box.x1 * c.z + c.x <= r.width - right - 12 && box.x0 * c.z + c.x >= inset + 12) return;
    reveal(box);
  }, [picked, right]);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const d = desk.current;
      if (!d) return;
      const r = d.getBoundingClientRect();
      const c = cam.current;
      const z = Math.max(0.12, Math.min(2, c.z * factor));
      const px = cx - r.left;
      const py = cy - r.top;
      cam.current = { z, x: px - ((px - c.x) * z) / c.z, y: py - ((py - c.y) * z) / c.z };
      apply();
    },
    [apply],
  );
  // The wheel zooms about the pointer. Not passive: the page must not scroll.
  useEffect(() => {
    const d = desk.current;
    if (!d) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".sb-menu, .sb-detail, .sb-jamie, .sb-why")) return;
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    };
    d.addEventListener("wheel", onWheel, { passive: false });
    return () => d.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Dragging the desk pans; a press that does not move clears what was picked. The move and the
  // release are listened for on the window for the length of the drag.
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, textarea, input, select, .sb-menu, .sb-detail, .sb-note, .sb-jamie, .sb-why, .sb-jbar")) return;
    const d = e.currentTarget;
    const g = { x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false };
    const move = (ev: PointerEvent) => {
      if (!g.moved && Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < 4) return;
      g.moved = true;
      d.classList.add("sb-drag");
      cam.current = { ...cam.current, x: g.cx + ev.clientX - g.x, y: g.cy + ev.clientY - g.y };
      apply();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      d.classList.remove("sb-drag");
      if (!g.moved) {
        setPicked(null);
        setMenu(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };



  // The right-click menu: what a person can do by hand to the card under the pointer, or to the desk.
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string | null } | null>(null);
  const [jamieAsk, setJamieAsk] = useState<{ text: string; n: number } | null>(null);
  const onContext = (e: ReactMouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!plan || t.closest("textarea, input, select, .sb-menu, .sb-detail, .sb-jamie, .sb-why, .sb-jbar, .sb-bar")) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const id = t.closest<HTMLElement>("[data-id]")?.dataset["id"] ?? null;
    setMenu(null);
    if (id) setPicked(id);
    setCtx({ x: Math.min(e.clientX - r.left, r.width - 250), y: Math.min(e.clientY - r.top, r.height - 220), id });
  };
  useEffect(() => {
    if (!ctx) return;
    const away = (e: PointerEvent) => !(e.target as HTMLElement).closest(".sb-ctx") && setCtx(null);
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [ctx]);
  /** Add a card by hand under `under` (or an initiative, under nothing), and pick it so it can be named. */
  const addCard = async (role: Role, under?: Card) => {
    setCtx(null);
    const out = await act(addRequest(PLAN, role, `New ${ROLE_WORD[role].toLowerCase()}`, under), `Adding a ${ROLE_WORD[role].toLowerCase()}`);
    const id = out && typeof out["ref_id"] === "string" ? out["ref_id"] : null;
    if (id) {
      if (role === "goal") setWhere(id);
      setPicked(id);
    }
  };
  /** Put a sticky note on a card: the viewer's own open question about it, picked so it can be written. */
  const addNote = async (about: Card) => {
    setCtx(null);
    const out = await act({ op: "add_question", about: about.id, text: "New note" }, "Adding a sticky note");
    const id = out && typeof out["ref_id"] === "string" ? out["ref_id"] : null;
    if (id) setPicked(id);
  };
  const deleteCard = (c: Card) => {
    setCtx(null);
    setPicked(null);
    void act({ op: "remove", ref_id: c.id }, `Removing ${ROLE_WORD[c.role].toLowerCase()} "${c.title}"`);
  };
  // Next: step through what needs the viewer on this board — the open questions on a goal's map,
  // the goals that have any on the map of them all.
  const nextAt = useRef(-1);
  const goNext = () => {
    if (!plan) return;
    const list = goal ? openHere : plan.goals.filter((g) => openAsks[g]);
    if (!list.length) return;
    nextAt.current = (nextAt.current + 1) % list.length;
    const id = list[nextAt.current]!;
    setMenu(null);
    if (b?.asks[id]) showAsk(id);
    else if (layout?.spots[id]) show(id);
    else open(id);
  };
  const askJamie = (text: string) => {
    setCtx(null);
    setSheet(false);
    setChat(true);
    setJamieAsk((a) => ({ text, n: (a?.n ?? 0) + 1 }));
  };
  /** A job opened from Working now: its card, in the conversation that started it, in the docked chat — as the Jamie app opens one. */
  const openJob = (job: string) => {
    setMenu(null);
    setSheet(false);
    setChat(true);
    setFocusJob((f) => ({ job, n: (f?.n ?? 0) + 1 }));
  };

  const open = (id: string) => {
    setWhere(id);
    setPicked(null);
    setMenu(null);
    setTrace({ story: null, requirement: null });
    setSheet(false);
  };
  const show = (id: string) => {
    setPicked(id);
    setMenu(null);
    flyTo(id);
  };
  /** Go to any card: open the board it is on, then bring it to the middle. */
  const pending = useRef<string | null>(null);
  const goTo = (id: string) => {
    if (!plan) return;
    // A question opens on its initiative's brainstorm tree, opened, with the questions above it.
    if (b?.asks[id]) {
      const top = asksAbove(b, id)[0] ?? id;
      const about = b.asks[top]!.about;
      const g = about ? (plan.cards[about]?.role === "goal" ? about : goalOf(plan, about)) : null;
      if (!g) return;
      if (g !== goal) open(g);
      showAsk(id);
      return;
    }
    const card = plan.cards[id] ? id : null;
    if (!card) return;
    const g = plan.cards[id]!.role === "goal" ? id : goalOf(plan, id);
    // An initiative opens its own map; anything else is brought to the middle of the map it is on.
    if (g === id && !plan.cards[id]!.pencil) return open(id);
    if (think) setMode("map");
    if (layout?.spots[id]) return show(id);
    if (g && g !== goal) {
      pending.current = id;
      open(g);
      if (id === g) pending.current = null;
    } else setPicked(id);
  };
  useEffect(() => {
    const id = pending.current;
    if (id && layout?.spots[id]) {
      pending.current = null;
      setTimeout(() => show(id), 80);
    }
  }, [layout]);
  const pick = (h: Hit) => {
    setPalette(false);
    if (h.kind === "story" || h.kind === "requirement") {
      if (h.card) {
        open(h.card);
        setTimeout(() => {
          setSheet(true);
          setTrace(h.kind === "story" ? { story: h.id, requirement: null } : { story: why?.requirements[h.id]?.story ?? null, requirement: h.id });
        }, 60);
      }
      return;
    }
    goTo(h.id);
  };
  const presenter = usePresenter(present, base, b, why);
  useEffect(() => {
    const t = presenter.target;
    if (!t) return;
    // A brief, story or requirement shows on its initiative's Why sheet, its story opened; anything else on the map
    // or the brainstorm tree.
    const w = why ? whyPlace(t.id, why) : null;
    if (w) {
      if (w.goal !== goal) open(w.goal);
      setMode("map");
      setSheet(true);
      setTrace({ story: w.story, requirement: w.requirement });
      return;
    }
    setSheet(false);
    goTo(t.id);
    // Every question the job just wrote is shown open: the call sees the options people named.
    if (b?.asks[t.id]) setExpanded((e) => new Set([...e, ...[...presenter.fresh].filter((id) => b.asks[id])]));
  }, [presenter.target]);

  // A deep link opens where it points: `at` (or ref / node / canvas) is a card, `roadmap` an initiative;
  // `view: brainstorm` opens that initiative's brainstorm tree, and `ask` a question on it, opened.
  const linked = useRef(false);
  useEffect(() => {
    const ref = toolInput?.["ask"] ?? toolInput?.["at"] ?? toolInput?.["ref"] ?? toolInput?.["node"] ?? toolInput?.["canvas"] ?? toolInput?.["roadmap"];
    if (!ref || linked.current || !plan) return;
    const byName = Object.values(plan.cards).find((c) => c.role === "goal" && c.title.toLowerCase() === String(ref).toLowerCase());
    // A link to a brainstorm waits for the brainstorms to be read.
    if (!plan.cards[ref] && !byName && !b) return;
    if (toolInput?.["view"] === "brainstorm" && !b) return;
    linked.current = true;
    goTo(plan.cards[ref] ? ref : (byName?.id ?? ref));
    if (toolInput?.["view"] === "brainstorm") setMode("think");
  }, [toolInput, plan, b]);

  // New cards a job (or anyone else) wrote: a toast says so, with a way to go there. The first read is what was already there.
  // A burst of writes (a job writing a whole plan) is one toast that counts up, not one per read.
  const seen = useRef<Set<string> | null>(null);
  const burst = useRef<{ ids: string[]; until: number }>({ ids: [], until: 0 });
  useEffect(() => {
    if (!base || !b) return;
    const ids = [...Object.keys(base.cards), ...Object.values(b.asks).filter((q) => q.root && q.about).map((q) => q.id)];
    const was = seen.current;
    seen.current = new Set(ids);
    if (!was || present) return;
    const fresh = ids.filter((id) => !was.has(id) && id !== picked);
    const fresh2 = fresh.filter((id) => (base.cards[id]?.by ?? b.asks[id]?.by) !== "person");
    if (!fresh2.length) return;
    const now = Date.now();
    const kept = now < burst.current.until ? burst.current.ids.filter((id) => base.cards[id] || b.asks[id]) : [];
    const theirs = [...kept, ...fresh2.filter((id) => !kept.includes(id))];
    burst.current = { ids: theirs, until: now + 15_000 };
    const first = theirs[0]!;
    const name = (id: string) => base.cards[id]?.title ?? b.asks[id]?.text ?? "";
    const kind = base.cards[first] ? ROLE_WORD[base.cards[first]!.role].toLowerCase() : "brainstorm";
    toast(theirs.length === 1 ? `New ${kind} on the canvas` : `${theirs.length} new cards on the canvas`, {
      id: "new-cards",
      duration: 15_000,
      description: theirs.slice(0, 3).map(name).filter(Boolean).join(" · "),
      action: { label: "Show me", onClick: () => goTo(first) },
    });
  }, [base, b]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((o) => !o);
        return;
      }
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key !== "Escape") return;
      if (palette) setPalette(false);
      else if (menu) setMenu(null);
      else if (picked) setPicked(null);
      else if (goal) open(HOME);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // What a look can check that the page's text cannot say.
  useEffect(() => {
    (window as unknown as { __debug?: unknown }).__debug = () => ({
      board: boardKey,
      mode,
      camera: cam.current,
      cards: layout ? Object.keys(layout.spots).length : 0,
      roads: layout?.roads.length ?? 0,
      plots: layout?.plots.map((p) => p.state) ?? [],
      picked,
      pencils: plan ? Object.values(plan.cards).filter((c) => c.pencil).length : 0,
      working: [...working.keys()],
      brainstorm: tree
        ? {
            show: showAsks,
            questions: tree.shownAsks.length,
            open: tree.all.open,
            decided: tree.all.decided,
            expanded: [...expanded],
            folded: [...folded],
            options: tree.order.filter((id) => tree.nodes[id]!.kind === "option").length,
            plan: tree.order.filter((id) => ["group", "work"].includes(tree.nodes[id]!.kind)).map((id) => `${plan?.cards[id]?.title}: ${tree.nodes[id]!.kids.length}`),
            box: tree.box,
          }
        : null,
    });
  });

  const center = () => {
    const r = desk.current?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 };
  };
  const pickedCard = plan && picked ? plan.cards[picked] : undefined;
  const cardWork = useCardWork(base, pickedCard && !pickedCard.pencil ? pickedCard.id : null).data;
  const pickedAsk = b && picked ? b.asks[picked] : undefined;
  // Tracing: with the Why sheet open, what is picked on it lights the work that answers it; picking
  // work on the map lights what it is for instead.
  const tracing = sheet && !!goal && !!why;
  const serving = tracing && pickedCard && pickedCard.role !== "goal" ? new Set(why!.serves[pickedCard.id] ?? []) : null;
  const lit = new Set<string>(!tracing ? [] : serving ? [pickedCard!.id] : trace.requirement ? (why!.answers[trace.requirement] ?? []) : trace.story ? workFor(why!, trace.story) : []);
  const dimmed = tracing && (serving !== null || !!trace.story);
  const storyCount = goal && why ? (why.byGoal[goal]?.length ?? 0) : 0;
  const toggleWhy = () => {
    setChat(false);
    setMenu(null);
    setPicked(sheet ? null : goal);
    setSheet((v) => !v);
    if (!trace.story) setTrace({ story: why?.byGoal[goal!]?.[0] ?? null, requirement: null });
  };
  useLayoutEffect(() => drawThreads());
  const openHere = goal ? shelf.filter((id) => b?.asks[id]?.open) : [];
  const openTotal = goal ? openHere.length : Object.values(openAsks).reduce((n, k) => n + k, 0);
  const planWaiting = proposals?.records.filter((r) => proposalAbout.has(r.id)) ?? [];
  const needs = planWaiting.length + openTotal;
  // What Jamie is told the person is looking at, with ids it can act on.
  const name = (id: string) => `the ${ROLE_WORD[plan!.cards[id]!.role].toLowerCase()} "${plan!.cards[id]!.title}" (ref_id ${id})`;
  const subject = pickedCard && !pickedCard.pencil ? pickedCard.id : pickedAsk?.about && plan?.cards[pickedAsk.about] ? pickedAsk.about : null;
  // Said even before the plan is read: a turn sent then is still about the canvas.
  const canvasJob = `Plan changes and brainstorms on these cards are a Canvas Planning job, written with the \`stadeum/canvas/canvas\` workflow (a brainstorm about a card is a Question about its ref_id).`;
  const about = !plan
    ? `On the Infinite Canvas: on the map of every initiative, nothing picked. ${canvasJob}`
    : `On the Infinite Canvas: ${
        [pickedAsk ? `looking at the brainstorm question "${pickedAsk.text}" (ref_id ${pickedAsk.id})${subject ? ` about ${name(subject)}` : ""}` : subject ? `looking at ${name(subject)}` : "", goal && goal !== subject ? `in ${name(goal)}` : !goal && !subject ? "on the map of every initiative, nothing picked" : ""]
          .filter(Boolean)
          .join(", ")
      }. "This" and "it" mean ${pickedAsk ? `the question ${pickedAsk.id}` : subject ? `ref_id ${subject}` : "nothing in particular"}. ${canvasJob}`;
  const subjectTitle = pickedAsk ? pickedAsk.text : pickedCard ? pickedCard.title : null;
  const decideOne = async (id: string, action: "accept" | "reject") => {
    const t = toast.loading(action === "accept" ? "Accepting" : "Rejecting");
    const problem = await decide(id, action);
    if (!problem) return void toast.success(action === "accept" ? "Accepted." : "Rejected.", { id: t });
    // Only strut's own apps may decide a proposal: this one opens it where the person decides.
    if (/strut's own app|person's decision/i.test(problem)) {
      toast("Opened the change in strut: say yes or no there.", { id: t, duration: 8_000 });
      host.openLink(`/proposals/${id}`);
      return;
    }
    toast.error(`Not ${action === "accept" ? "accepted" : "rejected"}: ${problem}`, { id: t, duration: 10_000 });
  };
  const jobsOf = (id: string): CardJob[] => (work?.jobs_by_ref?.[id] ?? []) as CardJob[];
  const linksOf = (id: string) => work?.links?.[id] ?? [];

  return (
    <div
      className={`sb${present ? " sb-present" : ""}`}
      ref={desk}
      onPointerDown={onDown}
      onContextMenu={onContext}
      // The camera is the only way the desk moves: focusing a card off screen must not scroll it under the camera.
      onScroll={(e) => {
        if (e.target !== e.currentTarget) return;
        e.currentTarget.scrollTop = 0;
        e.currentTarget.scrollLeft = 0;
      }}
    >
      {present && <div className="sb-present-line">{presenter.line ?? "Taking notes"}</div>}
      <div className={`sb-world${dimmed ? " sb-trace" : ""}`} ref={world} onTransitionEnd={drawThreads}>
        {think && tree && plan && b ? (
          <ThinkTree
            t={tree}
            plan={plan}
            b={b}
            expanded={expanded}
            folded={folded}
            picked={picked}
            act={act}
            onToggleAsk={toggleAsk}
            onToggleFold={(id) =>
              setFolded((f) => {
                const n = new Set(f);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
            onAsk={(id, text) => {
              setPicked(id);
              askJamie(text);
            }}
            onSizes={(s) => setSizes((was) => ({ ...was, ...s }))}
          />
        ) : plan && layout && (
          <>
            {layout.rings.map((r, i) => (
              <div key={i} className="sb-ring" style={{ left: -r.rx, top: -r.ry, width: r.rx * 2, height: r.ry * 2 }} />
            ))}
            {layout.plots.map((p, i) => (
              <div key={i} className={`sb-plot sb-plot-${p.state}`} style={{ left: p.x, top: p.y, width: p.w, height: p.h }} />
            ))}
            {layout.labels.map((l, i) => (
              <div key={i} className="sb-label" style={{ left: l.x, top: l.y }}>
                {l.text}
              </div>
            ))}
            <svg className="sb-roads" aria-hidden="true">
              {layout.roads.map((r, i) => (
                <path key={i} className={`sb-road-${r.kind}`} d={`M${r.a.x},${r.a.y} L${r.b.x},${r.b.y}`} />
              ))}
            </svg>
            {!goal && (
              <>
                <div className="sb-centre">
                  Initiatives
                  <small>{everything || shown.length === all.length ? `${all.length} in all` : `${shown.length} most recent of ${all.length}`}</small>
                </div>
                {all.length > opening.length && (
                  <div className="sb-more-row">
                    <button type="button" className="sb-btn sb-more" onClick={() => setEverything((v) => !v)}>
                      {everything ? "Collapse" : `Show all ${all.length}`}
                    </button>
                  </div>
                )}
              </>
            )}
            {Object.entries(layout.spots).map(([id, s]) => {
              const on = (picked === id ? " sb-on" : "") + (presenter.fresh.has(id) ? " sb-fresh" : "");
              if (id === BRAINSTORM_SPOT && b && goal) {
                const open = shelf.filter((q) => b.asks[q]!.open).length;
                const decided = shelf.length - open;
                const groups = new Set(shelf.map((q) => b.asks[q]!.about)).size;
                return (
                  <button key={id} type="button" data-id={id} className="sb-sticky bt-entry" style={{ left: s.x, top: s.y }} onClick={() => setMode("think")}>
                    <span className="sb-meta">Brainstorm · {shelf.length} question{shelf.length === 1 ? "" : "s"} about {groups} card{groups === 1 ? "" : "s"}</span>
                    <span className="bt-tally">
                      {open > 0 && <b className="bt-chip bt-chip-open">{open} open</b>}
                      {decided > 0 && <b className="bt-chip bt-chip-done">{decided} decided</b>}
                    </span>
                    <span className="sb-title">Open the decision tree ›</span>
                  </button>
                );
              }
              const ask = b?.asks[id];
              if (ask) {
                const person = ask.hand;
                return (
                  <button key={id} type="button" data-id={id} className={`sb-sticky${ask.open ? " sb-asking" : " sb-decided"}${person ? " ic-person" : ""}${on}`} style={{ left: s.x, top: s.y }} onClick={() => setPicked(id)}>
                    <span className="sb-meta">{person && !ask.options.length ? `Note · ${ask.open ? "Open" : "Decided"}` : `Question · ${ask.open ? "Open" : "Decided"} · ${ask.options.length} option${ask.options.length === 1 ? "" : "s"}`}</span>
                    <span className={`sb-title${person ? " ic-hand" : ""}`}>{ask.text}</span>
                    <span className="sb-meta sb-sticky-by">
                      <Byline author={ask.author} prefix="" />
                    </span>
                  </button>
                );
              }
              const c = plan.cards[id];
              if (!c) return null;
              const busy = (working.has(id) ? " sb-working" : "") + (lit.has(id) ? " sb-lit" : "");
              const pencil = c.pencil ? " sb-pencil-card" : "";
              const linkedN = linksOf(id).length;
              const hand = fontOf("plan", c.by) === "hand" ? " ic-hand" : "";
              if (c.role === "work") {
                return (
                  <button key={id} type="button" data-id={id} className={`sb-tile sb-s-${c.state}${busy}${pencil}${on}`} style={{ left: s.x, top: s.y }} title={`${c.title} · ${c.pencil ? "proposed" : STATE_WORD[c.state]}${linkedN ? ` · ${linkedN} linked` : ""}`} onClick={() => setPicked(id)}>
                    <span className={`sb-title${hand}`}>{c.pencilEdit ? c.pencilEdit.name : c.title}</span>
                    {(linkedN > 0 || jobsOf(id).length > 0) && <span className="ic-badge">{jobsOf(id).length || linkedN}</span>}
                  </button>
                );
              }
              const draft = c.role === "goal" && c.state === "idle" ? " sb-draft" : "";
              const faded = layout.faded.includes(id) ? " sb-faded" : "";
              const asking = c.role === "goal" ? (openAsks[id] ?? 0) : (b?.byCard[id] ?? []).filter((q) => b!.asks[q]!.open).length;
              return (
                <button
                  key={id}
                  type="button"
                  data-id={id}
                  className={`sb-card sb-${c.role} sb-s-${c.state}${draft}${faded}${busy}${pencil}${on}`}
                  style={{ left: s.x, top: s.y }}
                  aria-pressed={id === goal ? sheet : undefined}
                  // On its own map, the initiative opens why it exists: its brief, stories and requirements.
                  onClick={() => (id === goal && why ? toggleWhy() : setPicked(id))}
                  // On the home map an initiative opens on a second press: the first shows what it is.
                  onDoubleClick={() => c.role === "goal" && !goal && !c.pencil && open(id)}
                >
                  <span className="sb-meta">
                    {c.role === "group" && <i className={`sb-dot sb-s-${c.state}`} />}
                    {metaOf(plan, c)}
                    {id === goal && storyCount > 0 && ` · ${storyCount} ${storyCount === 1 ? "story" : "stories"}`}
                    {linkedN > 0 && ` · ${linkedN} linked`}
                    {asking > 0 && (
                      <span className="sb-need">
                        {" "}
                        · {asking} open question{asking === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                  <span className={`sb-title${hand}`}>{c.pencilEdit ? c.pencilEdit.name : c.title}</span>
                  {c.pencilEdit && <span className="sb-meta sb-pencil-note">renamed, waiting on you</span>}
                  {c.role === "goal" && !goal && (plan.kids[id]?.length ?? 0) > 0 && (
                    <span className="sb-dots">
                      {plan.kids[id]!.map((k) => (
                        <i key={k} className={`sb-dot sb-s-${plan.cards[k]!.state}`} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </div>

      <div className="sb-bar sb-bar-left">
        <button type="button" className="sb-btn sb-where" aria-haspopup="true" aria-expanded={menu === "boards"} onClick={() => setMenu((m) => (m === "boards" ? null : "boards"))}>
          <span>{goal && plan ? plan.cards[goal]!.title : "All initiatives"}</span>
        </button>
        {plan && (
          <>
            <i className="sb-sep" />
            <button type="button" className="sb-btn" aria-haspopup="true" aria-expanded={menu === "needs"} onClick={() => setMenu((m) => (m === "needs" ? null : "needs"))}>
              Needs you{needs > 0 && <b className="sb-count">{needs}</b>}
            </button>
            {openTotal > 0 && (
              <button type="button" className="sb-btn" title="Go to the next open question" onClick={goNext}>
                Next ›
              </button>
            )}
          </>
        )}
        {(live.length > 0 || working.size > 0) && (
          <button type="button" className="sb-btn sb-livebtn" aria-haspopup="true" aria-expanded={menu === "live"} onClick={() => setMenu((m) => (m === "live" ? null : "live"))}>
            <i className="sb-dot sb-s-prog" />
            Working now · {Math.max(live.length, working.size)}
          </button>
        )}
        <button type="button" className="sb-btn sb-quietbtn" title="Find a card (⌘K)" onClick={() => setPalette(true)}>
          Find ⌘K
        </button>
      </div>

      {menu === "boards" && plan && (
        <div className="sb-menu">
          <button type="button" onClick={() => open(HOME)}>
            <span>All initiatives</span>
            <b>{plan.goals.length}</b>
          </button>
          {(["prog", "rest"] as const).map((part) => {
            const list = plan.goals.filter((g) => !plan.cards[g]!.pencil && (plan.cards[g]!.state === "prog") === (part === "prog"));
            if (!list.length) return null;
            return (
              <div key={part} className="sb-group-list">
                <h4>{part === "prog" ? "In progress" : "Everything else"}</h4>
                {list.map((g) => (
                  <button key={g} type="button" onClick={() => open(g)}>
                    <span>{plan.cards[g]!.title}</span>
                    <b>{plan.kids[g]?.length || ""}</b>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {menu === "needs" && plan && (
        <div className="sb-menu">
          {needs === 0 && <h4>Nothing about the plan needs you here</h4>}
          {planWaiting.length > 0 && (
            <div className="sb-group-list">
              <h4>Changes to the plan waiting on you · {planWaiting.length}</h4>
              {planWaiting.map((w) => (
                <div key={w.id} className="sb-row">
                  <span>{proposalAbout.get(w.id)}</span>
                  {w.rationale && <small>{w.rationale}</small>}
                  <span className="sb-row-btns">
                    <button type="button" className="sb-btn sb-small" onClick={() => void decideOne(w.id, "accept")}>
                      Accept
                    </button>
                    <button type="button" className="sb-btn sb-small" onClick={() => void decideOne(w.id, "reject")}>
                      Reject
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {goal && openHere.length > 0 && (
            <div className="sb-group-list">
              <h4>Open questions here · {openHere.length}</h4>
              {openHere.map((id) => (
                <button key={id} type="button" onClick={() => showAsk(id)}>
                  <span>{b!.asks[id]!.text}</span>
                  <b>{b!.asks[id]!.options.length || ""}</b>
                </button>
              ))}
            </div>
          )}
          {!goal && openTotal > 0 && (
            <div className="sb-group-list">
              <h4>Open questions, by initiative · {openTotal}</h4>
              {plan.goals
                .filter((g) => openAsks[g])
                .sort((x, y) => openAsks[y]! - openAsks[x]!)
                .map((g) => (
                  <button key={g} type="button" onClick={() => open(g)}>
                    <span>{plan.cards[g]!.title}</span>
                    <b>{openAsks[g]}</b>
                  </button>
                ))}
            </div>
          )}
          {(proposals?.others ?? 0) > 0 && <small className="sb-hint">{proposals!.others} other change{proposals!.others === 1 ? "" : "s"}, not about the plan, wait on you in Jamie.</small>}
        </div>
      )}

      {menu === "live" && (
        <div className="sb-menu">
          {working.size > 0 && (
            <div className="sb-group-list">
              <h4>On this map · {working.size}</h4>
              {[...working.entries()].map(([card, w]) => (
                <button key={card} type="button" data-job={w.job} onClick={() => openJob(w.job)}>
                  <span>{w.title}</span>
                  <b>{plan?.cards[card]?.title ?? ""}</b>
                </button>
              ))}
            </div>
          )}
          {live.length > 0 && (
            <div className="sb-group-list">
              <h4>Your jobs working now · {live.length}</h4>
              {live.map((j) => (
                <button key={j.job} type="button" data-job={j.job} onClick={() => openJob(j.job)}>
                  <span>{j.title}</span>
                  <b>open</b>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="sb-bar sb-bar-right">
        <div className="sb-seg" role="group" aria-label="How the cards are laid out">
          <button type="button" className="sb-btn" aria-pressed={!think} title="Laid out for you from the plan" onClick={() => setMode("map")}>
            Map
          </button>
          {goal && (
            <button type="button" className="sb-btn" aria-pressed={think} title="The questions and their options as a tree of decisions" onClick={() => setMode("think")}>
              Brainstorm{shelf.length > 0 && <b className="bt-segcount">{shelf.length}</b>}
            </button>
          )}
        </div>
        <i className="sb-sep" />
        <button type="button" className="sb-btn" aria-label="Zoom in" onClick={() => zoomAt(1.25, center().x, center().y)}>
          +
        </button>
        <button type="button" className="sb-btn" aria-label="Zoom out" onClick={() => zoomAt(0.8, center().x, center().y)}>
          −
        </button>
        <button type="button" className="sb-btn" onClick={() => fit(true)}>
          Fit
        </button>
      </div>

      {think && tree && b && (
        <div className="sb-bar bt-bar" style={{ left: 12 + inset }}>
          <span className="bt-bar-title">
            Brainstorm · {tree.all.open + tree.all.decided}
            <span className="bt-tally">
              <b className="bt-chip bt-chip-open">{tree.all.open} open</b>
              <b className="bt-chip bt-chip-done">{tree.all.decided} decided</b>
            </span>
          </span>
          <i className="sb-sep" />
          <div className="sb-seg" role="group" aria-label="Which questions">
            {(["all", "open", "decided"] as const).map((s) => (
              <button key={s} type="button" className="sb-btn" aria-pressed={showAsks === s} onClick={() => setShowAsks(s)}>
                {s === "all" ? "All" : s === "open" ? "Open" : "Decided"}
              </button>
            ))}
          </div>
          <i className="sb-sep" />
          <button type="button" className="sb-btn" title="Open every question shown, with its options" onClick={() => setExpanded(new Set(tree.everyAsk))}>
            Open all
          </button>
          <button
            type="button"
            className="sb-btn"
            title="Close every question; with none open, fold every milestone too"
            onClick={() => {
              if (expanded.size) setExpanded(new Set());
              else setFolded((f) => (f.size ? new Set() : new Set(Object.keys(tree.tally).filter((id) => id !== goal))));
            }}
          >
            {expanded.size ? "Close all" : folded.size ? "Unfold all" : "Fold all"}
          </button>
        </div>
      )}
      <svg className="sb-threads" ref={threads} aria-hidden="true" />
      {tracing && plan && goal && why && (
        <WhySheet
          plan={plan}
          why={why}
          goal={goal}
          trace={trace}
          serving={serving}
          fresh={presenter.fresh}
          act={act}
          onTrace={(t) => {
            setTrace(t);
            setPicked(null);
          }}
          onClose={() => setSheet(false)}
          onScroll={drawThreads}
        />
      )}
      <JamieDock
        about={about}
        subject={subjectTitle && subjectTitle.length > 48 ? `${subjectTitle.slice(0, 48)}…` : subjectTitle}
        open={chat}
        ask={jamieAsk}
        focusJob={focusJob}
        shift={inset}
        onOpen={() => {
          setSheet(false);
          setChat(true);
        }}
        onClose={() => setChat(false)}
      />

      {pickedCard && plan && pickedCard.pencil && (
        <div className="sb-detail sb-pencil-detail">
          <span className="sb-meta">Proposed · waiting on your yes or no</span>
          <h3>{pickedCard.title}</h3>
          <p>{pickedCard.pencil.title}</p>
          {pickedCard.pencil.rationale && <p>{pickedCard.pencil.rationale}</p>}
          <span className="sb-row-btns">
            <button type="button" className="sb-btn sb-primary" onClick={() => void decideOne(pickedCard.pencil!.proposalId, "accept")}>
              Accept
            </button>
            <button type="button" className="sb-btn" onClick={() => void decideOne(pickedCard.pencil!.proposalId, "reject")}>
              Reject
            </button>
          </span>
        </div>
      )}
      {pickedCard && plan && !pickedCard.pencil && (
        <div className="sb-detail">
          <span className="sb-meta">{metaOf(plan, pickedCard)}</span>
          {pickedCard.pencilEdit && (
            <div className="sb-pencil-box">
              <p>{pickedCard.pencilEdit.title}</p>
              <span className="sb-row-btns">
                <button type="button" className="sb-btn sb-small" onClick={() => void decideOne(pickedCard.pencilEdit!.proposalId, "accept")}>
                  Accept
                </button>
                <button type="button" className="sb-btn sb-small" onClick={() => void decideOne(pickedCard.pencilEdit!.proposalId, "reject")}>
                  Reject
                </button>
              </span>
            </div>
          )}
          <CardFacts card={pickedCard} roles={PLAN} act={act} />
          {working.has(pickedCard.id) && (
            <button type="button" className="sb-link sb-need" onClick={() => openJob(working.get(pickedCard.id)!.job)}>
              Working now: {working.get(pickedCard.id)!.title}
            </button>
          )}
          {pickedCard.role === "goal" && why?.brief[pickedCard.id] && <p className="sb-brief">{why.brief[pickedCard.id]}</p>}
          {pickedCard.role === "goal" && goal === pickedCard.id && why && (
            <button type="button" className="sb-btn" onClick={toggleWhy}>
              {sheet ? "Close why" : "Why: brief, stories, requirements"}
            </button>
          )}
          {pickedCard.role === "goal" && !goal && (
            <button type="button" className="sb-btn sb-primary" onClick={() => open(pickedCard.id)}>
              Open its map
            </button>
          )}
          {pickedCard.role !== "goal" && !goal && goalOf(plan, pickedCard.id) && (
            <button type="button" className="sb-btn" onClick={() => open(goalOf(plan, pickedCard.id)!)}>
              Open its initiative
            </button>
          )}
          {(plan.kids[pickedCard.id]?.length ?? 0) > 0 && (
            <>
              <span className="sb-meta">
                {pickedCard.role === "goal" ? "Milestones" : "Features"} · {plan.kids[pickedCard.id]!.length}
              </span>
              <ul className="sb-kids">
                {plan.kids[pickedCard.id]!.map((k) => (
                  <li key={k}>
                    <i className={`sb-dot sb-s-${plan.cards[k]!.state}`} title={STATE_WORD[plan.cards[k]!.state]} />
                    {layout?.spots[k] ? (
                      <button type="button" className="sb-link" onClick={() => show(k)}>
                        {plan.cards[k]!.title}
                      </button>
                    ) : (
                      <span>{plan.cards[k]!.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {why && pickedCard.role === "work" && (why.serves[pickedCard.id]?.length ?? 0) > 0 && (
            <>
              <span className="sb-meta">What it is for</span>
              {why.serves[pickedCard.id]!.map((r) => (
                <p key={r} className="sb-for">
                  {why.requirements[r]!.text}
                </p>
              ))}
            </>
          )}
          <BuildPanel
            card={pickedCard}
            {...((cardWork?.work?.[pickedCard.id] ?? work?.work?.[pickedCard.id]) ? { work: cardWork?.work?.[pickedCard.id] ?? work!.work[pickedCard.id]! } : {})}
            jobs={(cardWork?.jobs_by_ref?.[pickedCard.id] as CardJob[] | undefined) ?? jobsOf(pickedCard.id)}
            links={cardWork?.links?.[pickedCard.id] ?? linksOf(pickedCard.id)}
            loading={!cardWork}
            {...(why?.architecture[pickedCard.id] ? { architecture: why.architecture[pickedCard.id] } : {})}
          />
          {b && (b.byCard[pickedCard.id]?.length ?? 0) > 0 && (
            <>
              <span className="sb-meta">Questions about it</span>
              {b.byCard[pickedCard.id]!.map((q) => (
                <button key={q} type="button" className="sb-link" onClick={() => goTo(q)}>
                  {b.asks[q]!.open ? "" : "✓ "}
                  {b.asks[q]!.text}
                </button>
              ))}
            </>
          )}
          <span className="sb-row-btns">
            <button type="button" className="sb-btn sb-small" onClick={() => void addNote(pickedCard)}>
              + Sticky note
            </button>
            <button type="button" className="sb-btn sb-small" onClick={() => deleteCard(pickedCard)}>
              Delete
            </button>
          </span>
        </div>
      )}
      {/* A question is answered on the tree itself, never in a panel beside it. */}

      {isLoading && !plan && (
        <div className="sb-note">
          <h2>Reading the graph</h2>
          <p>Collecting initiatives, milestones and features.</p>
        </div>
      )}
      {error && !plan && (
        <div className="sb-note">
          <h2>The plan could not be read</h2>
          <p>{error instanceof Error ? error.message : String(error)}</p>
        </div>
      )}
      {plan && !plan.goals.length && (
        <div className="sb-note">
          <h2>No initiatives yet</h2>
          <p>Right-click to add one, or ask Jamie to plan one.</p>
        </div>
      )}
      {palette && plan && <Palette plan={plan} why={why ?? null} b={b ?? null} close={() => setPalette(false)} pick={pick} />}
      {ctx &&
        plan &&
        (() => {
          const card = ctx.id ? plan.cards[ctx.id] : undefined;
          const q = ctx.id ? b?.asks[ctx.id] : undefined;
          // On the desk of a goal's map, the menu is about that goal.
          const on = card && !card.pencil ? card : !ctx.id && goal ? plan.cards[goal] : undefined;
          return (
            <div className="sb-menu sb-ctx" style={{ left: ctx.x, top: ctx.y }} role="menu">
              {on && <h4>{on.title}</h4>}
              {q && <h4>{q.text}</h4>}
              {!q && (
                <button type="button" role="menuitem" onClick={() => void addCard("goal")}>
                  <span>Add initiative</span>
                </button>
              )}
              {on?.role === "goal" && (
                <button type="button" role="menuitem" onClick={() => void addCard("group", on)}>
                  <span>Add milestone</span>
                </button>
              )}
              {on?.role === "group" && (
                <button type="button" role="menuitem" onClick={() => void addCard("work", on)}>
                  <span>Add feature</span>
                </button>
              )}
              {on && (
                <button type="button" role="menuitem" onClick={() => void addNote(on)}>
                  <span>Add sticky note</span>
                </button>
              )}
              {on && (
                <button type="button" role="menuitem" onClick={() => (setPicked(on.id), askJamie(`Brainstorm this ${ROLE_WORD[on.role].toLowerCase()} with me: what are the open questions and the options for each?`))}>
                  <span>Brainstorm with Jamie</span>
                </button>
              )}
              {on && (
                <button type="button" role="menuitem" onClick={() => (setPicked(on.id), setCtx(null), setSheet(false), setChat(true))}>
                  <span>Ask Jamie about this</span>
                </button>
              )}
              {q && (
                <button type="button" role="menuitem" onClick={() => askJamie("Help me decide this question: lay out the options and what each leads to.")}>
                  <span>Work through it with Jamie</span>
                </button>
              )}
              {on && on.role === "goal" && !goal && (
                <button type="button" role="menuitem" onClick={() => (setCtx(null), open(on.id))}>
                  <span>Open its map</span>
                </button>
              )}
              {card && !card.pencil && (
                <button type="button" role="menuitem" onClick={() => deleteCard(card)}>
                  <span>Delete</span>
                </button>
              )}
            </div>
          );
        })()}
      {data?.truncated && <div className="sb-cut">This graph holds more than the canvas reads at once. Some cards are missing.</div>}
    </div>
  );
}
