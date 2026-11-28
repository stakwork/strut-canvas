/**
 * stadeum/canvas on a strut server, the way it runs on a box: installed from
 * this directory (`file:`) into a strut started in this process from a
 * checkout of stakwork/strut's main (`STRUT_DIR`, default `../strut`, with
 * its install), on a LadybugDB file. Then driven as its users drive it: the
 * Canvas Planning job through the `canvas` workflow (read, write, brainstorm),
 * a person through the app's `ops` workflow (choose, remove, restore), and
 * the app's page through its grants. No model runs: the job agent's decisions
 * are written here as the plans and drafts it would send.
 *
 *   STRUT_DIR=../strut npm test
 *
 * On Neo4j, as a Stadeum box runs it, against a throwaway server:
 *
 *   CANVAS_TEST_NEO4J_URI=bolt://localhost:7689 CANVAS_TEST_NEO4J_PASSWORD=… STRUT_DIR=../strut npm test
 *
 * It writes into the server's default namespace, so give it an empty one.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STRUT = resolve(process.env["STRUT_DIR"] ?? "../strut");
for (const k of ["GITHUB_TOKEN", "GH_TOKEN"]) delete process.env[k];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = async <T = any>(path: string): Promise<T> => (await import(pathToFileURL(join(STRUT, "src", path)).href)) as T;

const HERE = resolve(".");
const APP = "stadeum/canvas/canvas";
const CANVAS = "stadeum/canvas/canvas";
const OPS = "stadeum/canvas/ops";
const IMPLEMENT = "stadeum/canvas/implement";
const JOB = "job-canvas-test";

describe("stadeum/canvas", () => {
  let root = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let strut: any, tools: any, store: any;
  let appIdentity: (name: string, version: string) => string;
  let STEP_RUN = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let graph: any;
  let appVersion = "";
  /** What GET /packages says a call on the box records onto. */
  let calls: unknown;

  /** A run of one of the package's workflows, as a person. Its output, or it throws with the run's error. */
  const run = async (workflow: string, input: Record<string, unknown>, actor = "ada") => {
    const r = await strut.run(workflow, input, { actor, principal: actor });
    if (r.status !== "success") throw new Error(String(r.error?.message ?? JSON.stringify(r.error)));
    return r.output.result ?? r.output;
  };
  const canvas = (input: Record<string, unknown>) => run(CANVAS, { job: JOB, ...input }, "ada");
  const ops = (input: Record<string, unknown>) => run(OPS, input, "ada");
  /** A call from the app's page, as its viewer. */
  const page = async (type: string, config: Record<string, unknown>) => {
    const t = tools.buildAppTools({ apps: strut.apps, registry: strut.getRegistry(), services: strut.services, actor: "ada", admin: false, runStepDeps: { store, workspace: strut.workspace } });
    return t[STEP_RUN].execute({ type, config, app: appIdentity(APP, appVersion) }, { toolCallId: "t", messages: [] }) as Promise<{ error?: string; result?: any }>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const find = async (type: string): Promise<any[]> => (await page("graph/find", { node_type: type, where: { removed_at: null }, limit: 500 })).result?.nodes ?? [];
  /** A step run over HTTP with the deployment key, as the voice service calls it for the person recording. Its output, or it throws with the step's error. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = async (type: string, config: Record<string, unknown>, actor = "ada"): Promise<any> => {
    const key = `key-${randomBytes(8).toString("hex")}`;
    process.env["STRUT_API_KEY"] = key;
    try {
      const res = await strut.app.request(`/steps/${encodeURIComponent(type)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-strut-actor": actor },
        body: JSON.stringify({ config }),
      });
      const body = await res.json();
      if (res.status !== 200 || body.error || body.status === "error") throw new Error(String(body.error?.message ?? body.error ?? JSON.stringify(body)));
      return body.output ?? body;
    } finally {
      delete process.env["STRUT_API_KEY"];
    }
  };

  before(async () => {
    delete process.env["STRUT_API_KEY"];
    root = await mkdtemp(join(tmpdir(), "strut-canvas-test-"));
    store = new (await from("store.ts")).MemoryRunStore();
    const { createStrut } = await from("createStrut.ts");
    const { openGraphBackend } = await from("graph/backend.ts");
    const { PRIVATE_NAMESPACE } = await from("graph/ladybug/namespaces.ts");
    const { GraphWorkspaceStore } = await from("graph/workspace-store.ts");
    const { kitForTests } = await from("test-util/app-kit.ts");
    tools = await from("apps/tools.ts");
    STEP_RUN = tools.STEP_RUN_TOOL;
    appIdentity = (await from("auth.ts")).appIdentity;
    // A LadybugDB file, or a throwaway Neo4j when CANVAS_TEST_NEO4J_URI names one (empty it first: the suite writes into it).
    const neo4j = process.env["CANVAS_TEST_NEO4J_URI"];
    graph = neo4j
      ? await openGraphBackend({ kind: "neo4j", uri: neo4j, user: "neo4j", password: process.env["CANVAS_TEST_NEO4J_PASSWORD"] ?? "", namespace: "default" }, { embeddings: false })
      : await openGraphBackend({ kind: "ladybug", path: join(root, "graph.lbug"), namespace: PRIVATE_NAMESPACE }, { embeddings: false });
    strut = await createStrut({
      workspace: new GraphWorkspaceStore(graph, { materializeDir: join(root, "steps"), appsDir: join(root, "apps") }),
      dataDir: root,
      store,
      kit: await kitForTests(),
      serveUi: false,
      enableChat: false,
      autoResume: false,
      // The app grants these and compiles in strut/jamie's chat (which imports strut/views).
      orchestrator: true,
      builder: true,
      systemWorkflows: false,
      browserWorkflows: false,
      privacyWorkflows: false,
      mediaWorkflows: false,
      // Strut's own pages, `Job` among them, which Canvas Planning goes under.
      concepts: { personal: false, claims: false },
      stt: false,
      earnings: false,
      staff: false,
      worker: false,
      git: { local: false },
    });
    // Installed by a person, as a box's admin does: the key, and their actor.
    const key = `key-${randomBytes(8).toString("hex")}`;
    process.env["STRUT_API_KEY"] = key;
    try {
      const res = await strut.app.request("/packages/install", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-strut-actor": "root" },
        body: JSON.stringify({ ref: `file:${HERE}` }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.deepEqual(body.warnings, []);
      const listed = await strut.app.request("/packages", { headers: { authorization: `Bearer ${key}`, "x-strut-actor": "root" } });
      calls = ((await listed.json()) as { packages: { package: string; calls?: unknown }[] }).packages.find((p) => p.package === "stadeum/canvas")?.calls;
    } finally {
      delete process.env["STRUT_API_KEY"];
    }
    appVersion = (await strut.apps.manifestOf(APP)).version;
  });
  after(async () => {
    await strut?.close?.().catch(() => {});
    await graph?.close?.().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  // Filled in as the plan is written, read by the tests after.
  const ids: Record<string, string> = {};

  it("installs its app, built against this strut's kit, and its pages under Job", async () => {
    assert.match(appVersion, /^v\d+$/);
    // A recorded group call is a Call Canvas job, shown in the call as the canvas.
    assert.deepEqual(calls, { kind: "Call Canvas", app: APP });
    const found = await run("stadeum/canvas/canvas", { mode: "read" });
    assert.equal(found.level, "top");
  });

  it("writes a plan the job decided: an initiative, its why, its road", async () => {
    const out = await canvas({
      prompt: "Plan self-serve onboarding",
      plan: {
        new_initiative: { name: "Self-serve onboarding" },
        brief: { title: "Teams set up alone", text: "New teams wait days for a person to set them up." },
        stories: [{ text: "As a new admin I set up my workspace alone", requirements: ["Setup takes under ten minutes", "No call with us is needed"] }],
        milestones: ["Guided setup", "Invites"],
        features: [{ milestone: "Guided setup", name: "Setup checklist", satisfies: ["Setup takes under ten minutes"] }],
      },
    });
    assert.equal(out.action, "write", JSON.stringify(out));
    ids["initiative"] = out.initiative_ref;
    const read = await canvas({ mode: "read", about: ids["initiative"] });
    const ini = read.initiative;
    assert.equal(ini.node.name, "Self-serve onboarding");
    assert.equal(ini.node.status, "planned");
    assert.equal(ini.briefs.length, 1);
    assert.equal(ini.stories[0].requirements.length, 2);
    assert.deepEqual(ini.milestones.map((m: { name: string; sequence: number }) => [m.name, m.sequence]), [["Guided setup", 1], ["Invites", 2]]);
    const f = ini.milestones[0].features[0];
    assert.equal(f.name, "Setup checklist");
    assert.equal(f.status, "planned");
    assert.equal(f.satisfies.length, 1);
    ids["milestone"] = ini.milestones[0].ref_id;
    ids["invites"] = ini.milestones[1].ref_id;
    ids["feature"] = f.ref_id;
    ids["req"] = read.requirements.find((r: { text: string }) => r.text === "Setup takes under ten minutes").ref_id;
    ids["req2"] = read.requirements.find((r: { text: string }) => r.text === "No call with us is needed").ref_id;
    // The app reads the same plan with its own grants.
    assert.deepEqual((await find("Initiative")).map((n) => n.name ?? n.properties?.name), ["Self-serve onboarding"]);
  });

  it("refuses a second initiative of the same name, and takes statuses as people say them", async () => {
    await assert.rejects(canvas({ plan: { new_initiative: { name: "self-serve  Onboarding" } } }), /DUPLICATE_INITIATIVE/);
    await assert.rejects(ops({ op: "add", kind: "initiative", text: "Self-serve onboarding" }), /already an initiative named/);
    await canvas({ about: ids["initiative"], plan: { edits: [{ ref_id: ids["milestone"], field: "status", value: "in progress" }] } });
    const st = await ops({ op: "set_status", ref_id: ids["feature"], value: "done" });
    assert.equal(st.status, "done");
    await ops({ op: "set_status", ref_id: ids["feature"], value: "BLOCKED", reason: "waiting on design" });
    const read = await canvas({ mode: "read", about: ids["feature"] });
    const m = read.initiative.milestones[0];
    assert.equal(m.status, "active");
    assert.equal(m.features[0].status, "done");
    assert.equal(m.features[0].blocked, true);
    await assert.rejects(ops({ op: "set_status", ref_id: ids["feature"], value: "someday" }), /is not a status/);
  });

  it("writes a brainstorm draft about a card, refusing a broken one whole", async () => {
    const effects = (score: number) => [{ name: "Faster start", description: "Teams start the same day.", score, requirement: ids["req"] }];
    const ratings = { fast: 0.5, good: 0.2, cheap: -0.1 };
    // Two recommended options under one question: refused, nothing written.
    await assert.rejects(
      canvas({
        about: ids["milestone"],
        prompt: "How should guided setup work?",
        brainstorm: {
          actions: [
            { op: "add", tmp: "q1", parent: null, kind: "question", text: "How is setup guided?", made_by: "model", criteria: "speed, effort", reversibility: "two_way" },
            { op: "add", tmp: "o1", parent: "q1", kind: "option", text: "A checklist", made_by: "model", makes: ["Checklist"], effects: effects(0.6), ratings, recommended: true },
            { op: "add", tmp: "o2", parent: "q1", kind: "option", text: "A wizard", made_by: "model", makes: ["Wizard"], effects: effects(0.4), ratings, recommended: true },
          ],
        },
      }),
      /refused and nothing was written.*recommended options/,
    );
    assert.equal((await find("Question")).length, 0);

    const out = await canvas({
      about: ids["milestone"],
      prompt: "How should guided setup work? Maybe just a video",
      brainstorm: {
        actions: [
          { op: "add", tmp: "q1", parent: null, kind: "question", text: "How is setup guided?", made_by: "model", criteria: "speed, effort", reversibility: "two_way" },
          { op: "add", tmp: "o1", parent: "q1", kind: "option", text: "A checklist", made_by: "model", makes: ["Checklist"], effects: effects(0.6), ratings, recommended: true },
          { op: "add", tmp: "o2", parent: "q1", kind: "option", text: "Just a video", made_by: "user", quote: "just a video", makes: [], effects: effects(-0.3), ratings },
        ],
      },
    });
    assert.equal(out.action, "brainstorm", JSON.stringify(out));
    ids["question"] = out.root;
    assert.match(out.outline, /How is setup guided\?/);
    assert.match(out.outline, /A\. A checklist \[model, open, recommended\]/);
    // The app's side panel.
    const tree = await page("stadeum/canvas/brainstorm-tree", { root: ids["question"] });
    assert.equal(tree.error, undefined, tree.error);
    const [q, a, b] = tree.result.nodes;
    assert.equal(q.kind, "question");
    assert.equal(a.label, "A");
    assert.equal(a.recommended, true);
    assert.deepEqual(a.ratings, { fast: 0.5, good: 0.2, cheap: -0.1 });
    assert.deepEqual(a.effects.map((e: { direction: string; score: number }) => [e.direction, e.score]), [["pro", 0.6]]);
    assert.equal(b.made_by, "user");
    assert.deepEqual(b.effects.map((e: { direction: string }) => e.direction), ["con"]);
    ids["optionA"] = a.ref_id;
    // A later turn reads the tree it continues.
    const again = await canvas({ mode: "read", about: ids["question"] });
    assert.equal(again.root, ids["question"]);
    assert.equal(again.brainstorms.length, 1);
  });

  it("lets a person add an option, choose one, and take it back", async () => {
    const added = await ops({ op: "add_option", parent: ids["question"], text: "Pair with a teammate" });
    assert.equal(added.root, ids["question"]);
    await ops({ op: "choose", ref_id: ids["optionA"] });
    let t = (await page("stadeum/canvas/brainstorm-tree", { root: ids["question"] })).result;
    assert.equal(t.state, "decided");
    assert.equal(t.nodes.find((n: { ref_id: string }) => n.ref_id === ids["optionA"]).state, "chosen");
    assert.equal(t.nodes.find((n: { ref_id: string }) => n.ref_id === added.ref_id).made_by, "user");
    await ops({ op: "unchoose", ref_id: ids["optionA"] });
    t = (await page("stadeum/canvas/brainstorm-tree", { root: ids["question"] })).result;
    assert.equal(t.state, "open");
    await assert.rejects(ops({ op: "choose", ref_id: ids["question"] }), /only an option is chosen/);
  });

  it("records a choice a person said aloud on a call, and only then", async () => {
    const effects = [{ name: "Quick", description: "Done in a day.", score: 0.5, requirement: ids["req"] }];
    const ratings = { fast: 0.5, good: 0.1, cheap: 0.3 };
    const call = [
      "[14:02] Cleo: what about a short tour instead?",
      "[14:03] Jamie: I can put a tour on the canvas.",
      "[14:03] Ben: we're agreed, the tour it is. Jamie, put that down",
    ].join("\n");
    const draft = (speaker: string, quote: string) => ({
      actions: [
        { op: "add", tmp: "t", parent: ids["question"], kind: "option", text: "A short tour", made_by: "user", quote: "a short tour", speaker: "Cleo", makes: [], effects, ratings },
        { op: "choose", option: "t", speaker, quote },
      ],
    });
    // Words that are not that speaker's, Jamie's own, or a chat with no speakers: refused whole.
    await assert.rejects(canvas({ about: ids["question"], prompt: call, brainstorm: draft("Cleo", "the tour it is") }), /not on a line of Cleo's/);
    await assert.rejects(canvas({ about: ids["question"], prompt: "we're agreed, the tour it is", brainstorm: draft("ada", "the tour it is") }), /not on a line of ada's/);
    assert.equal((await find("Option")).filter((o) => o.properties.text === "A short tour").length, 0);

    const out = await canvas({ about: ids["question"], prompt: call, brainstorm: draft("Ben", "we're agreed, the tour it is") });
    assert.equal(out.action, "brainstorm", JSON.stringify(out));
    assert.match(out.outline, /A short tour \[user, chosen, Cleo\].*\(chosen by Ben: "we're agreed, the tour it is"\)/);
    let t = (await page("stadeum/canvas/brainstorm-tree", { root: ids["question"] })).result;
    assert.equal(t.state, "decided");
    const tour = t.nodes.find((n: { text: string }) => n.text === "A short tour");
    assert.equal(tour.state, "chosen");

    // Decided: a second choice waits for a person to take the first back.
    await assert.rejects(
      canvas({ about: ids["question"], prompt: call, brainstorm: { actions: [{ op: "choose", option: ids["optionA"], speaker: "Ben", quote: "the tour it is" }] } }),
      /already has a chosen option/,
    );
    await ops({ op: "unchoose", ref_id: tour.ref_id });
    t = (await page("stadeum/canvas/brainstorm-tree", { root: ids["question"] })).result;
    assert.equal(t.state, "open");
    // Taken back, the words go with it.
    const read = await canvas({ mode: "read", about: ids["question"] });
    assert.match(read.outline, /A short tour \[user, open, Cleo\]/);
    assert.doesNotMatch(read.outline, /chosen by/);
  });

  it("removes a card with everything under it, and puts it back", async () => {
    const r = await ops({ op: "remove", ref_id: ids["invites"] });
    assert.equal(r.removed.length, 1);
    let read = await canvas({ mode: "read", about: ids["initiative"] });
    assert.deepEqual(read.initiative.milestones.map((m: { name: string }) => m.name), ["Guided setup"]);
    assert.equal((await find("Milestone")).length, 1);
    await ops({ op: "restore", ref_id: ids["invites"] });
    read = await canvas({ mode: "read", about: ids["initiative"] });
    assert.deepEqual(read.initiative.milestones.map((m: { name: string }) => m.name), ["Guided setup", "Invites"]);
    // A milestone takes its features and the brainstorm about it along, and brings them back.
    const m = await ops({ op: "remove", ref_id: ids["milestone"] });
    assert.deepEqual(new Set(m.removed.map((x: { node_type: string }) => x.node_type)), new Set(["Milestone", "Feature", "Question", "Option", "Effect"]));
    assert.equal((await find("Question")).length, 0);
    await ops({ op: "restore", ref_id: ids["milestone"] });
    assert.equal((await find("Question")).length, 1);
    assert.equal((await find("Feature")).length, 1);
  });

  it("implements a feature only once it has an architecture, and keeps its work from being removed", async () => {
    await assert.rejects(run(IMPLEMENT, { feature: ids["feature"], dry_run: true }), /has no architecture yet/);
    await canvas({ about: ids["feature"], plan: { architectures: [{ feature: ids["feature"], name: "A checklist page over the setup steps", summary: "One page, each step a row." }] } });
    const dry = await run(IMPLEMENT, { feature: ids["feature"], dry_run: true });
    assert.match(dry.title, /^Implement: Setup checklist \[/);
    // Code in a repository unless the architecture says otherwise: a Code Change job.
    assert.deepEqual([dry.builds_in, dry.workflow, dry.repos], ["repo", "job", []]);
    // The planning job says where it is built; the person may switch at Implement.
    await canvas({ about: ids["feature"], plan: { architectures: [{ feature: ids["feature"], name: "A checklist page over the setup steps", builds_in: "repo", repos: ["https://example.com/team/app"] }] } });
    const inRepo = await run(IMPLEMENT, { feature: ids["feature"], dry_run: true });
    assert.deepEqual([inRepo.workflow, inRepo.repos], ["job", ["https://example.com/team/app"]]);
    const here = await run(IMPLEMENT, { feature: ids["feature"], dry_run: true, builds_in: "strut" });
    assert.deepEqual([here.builds_in, here.workflow, here.repos], ["strut", "builder", []]);
    const arch = (await canvas({ mode: "read", about: ids["feature"] })).initiative.milestones[0].features[0].architecture[0];
    await ops({ op: "edit", ref_id: arch.ref_id, field: "builds_in", value: "workflow" });
    assert.equal((await run(IMPLEMENT, { feature: ids["feature"], dry_run: true })).workflow, "builder");
    await assert.rejects(ops({ op: "edit", ref_id: arch.ref_id, field: "builds_in", value: "somewhere" }), /builds_in is repo .* or strut/);
    await assert.rejects(canvas({ about: ids["feature"], plan: { architectures: [{ feature: ids["feature"], name: "x", builds_in: "strut", repos: ["https://example.com/a/b"] }] } }), /has no repos/);
    // A job on the feature (as `implement` records it) is work: the feature, and what it is under, cannot be removed.
    await strut.workspace.publishWorkflowByContent("test/record", `steps:\n  - id: s\n    type: stadeum/canvas/job-started\n    config: ${JSON.stringify({ feature: ids["feature"], job: "job-build-1" })}\n`);
    const rec = await strut.run("test/record", {}, { actor: "ada", principal: "ada" });
    assert.equal(rec.status, "success", JSON.stringify(rec.error));
    await assert.rejects(ops({ op: "remove", ref_id: ids["feature"] }), /work_started/);
    await assert.rejects(ops({ op: "remove", ref_id: ids["req"] }), /work_started/);
    await assert.rejects(canvas({ about: ids["initiative"], plan: { deletes: [ids["milestone"]] } }), /work_started/);
    // A requirement no feature satisfies is not work.
    const r = await ops({ op: "remove", ref_id: ids["req2"] });
    assert.equal(r.removed.length, 1);
  });

  it("keeps a recorded call's facts beside its transcript, lists it, and stores its summary", async () => {
    const CALL = "call-rec1";
    const SUMMARIZE = "stadeum/canvas/summarize";
    // The call's scribe job, as voice starts it: a run under the job (no model runs here).
    const started = await strut.run(CANVAS, { mode: "read" }, { actor: "ada", principal: "ada", job: CALL, title: "Call, 27 Nov 15:02" });
    assert.equal(started.status, "success");
    const t0 = Date.parse("2026-11-27T15:02:00Z");
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    const line = (n: number, s: number, speaker: string, text: string, identity?: string) => ({ n, at: at(s), speaker, source: speaker === "Jamie" ? "jamie" : "voice", text, ...(identity ? { identity } : {}) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listed = async (): Promise<any> => (await page("stadeum/canvas/calls", {})).result?.calls.find((c: { job: string }) => c.job === CALL);
    /** A run launched detached, followed to its end: its events. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ended = async (workflow: string, runId: string): Promise<any[]> => {
      for (let i = 0; i < 300; i++) {
        if (await store.getRunSummary(workflow, runId)) return store.getRunEvents(workflow, runId);
        await new Promise((ok) => setTimeout(ok, 100));
      }
      throw new Error(`run ${runId} of ${workflow} did not end`);
    };

    const first = await server("stadeum/canvas/transcript-append", {
      job: CALL,
      lines: [line(1, 0, "Ada Park", "Let's ship the checklist first.", "box_ada"), line(2, 20, "Ben Ortiz", "Agreed. I'll write the invite emails.", "box_ben"), line(3, 30, "Jamie", "Noted.")],
    });
    assert.equal(first.count, 3);
    assert.equal(first.summarizing, undefined);
    // While it records: who spoke so far (never Jamie), not done, no summary, the job's own title.
    let c = await listed();
    assert.deepEqual(c.people, [{ name: "Ada Park", identity: "box_ada" }, { name: "Ben Ortiz", identity: "box_ben" }]);
    assert.deepEqual([c.done, c.lines, c.summary, c.title], [false, 3, undefined, "Call, 27 Nov 15:02"]);

    // The recording stops: the summary's run starts, once.
    const last = await server("stadeum/canvas/transcript-append", { job: CALL, lines: [line(4, 600, "Ada Park", "Who owns pricing?", "box_ada")], end: true });
    assert.match(String(last.summarizing), /\S/);
    const again = await server("stadeum/canvas/transcript-append", { job: CALL, lines: [], end: true });
    assert.equal(again.summarizing, undefined);
    // It read the call and got as far as the model, which this test has none of.
    const events = await ended(SUMMARIZE, last.summarizing);
    assert.ok(events.some((e) => e.type === "step.end" && e.output?.lines === 4 && e.output?.names === "Ada, Ben"), JSON.stringify(events).slice(0, 900));
    c = await listed();
    assert.deepEqual([c.done, c.lines, c.startedAt, c.endedAt, c.summary], [true, 4, at(0), at(600), undefined]);

    // What the summary's writer is given…
    const facts = await server("stadeum/canvas/call-facts", { job: CALL });
    assert.deepEqual([facts.names, facts.length, facts.lines, facts.done], ["Ada, Ben", "about 10 minutes", 4, true]);
    assert.equal(facts.text.split("\n")[0], "1 [Ada Park] Let's ship the checklist first.");
    // …and what it wrote, as the workflow's last step keeps it: checked, then shown by the list.
    await assert.rejects(server("stadeum/canvas/call-summary", { job: CALL, title: " " }), /no title/);
    await assert.rejects(server("stadeum/canvas/call-summary", { job: JOB, title: "x" }), /not a recorded call/);
    await server("stadeum/canvas/call-summary", {
      job: CALL,
      title: '"Checklist first, then invites"',
      discussed: ["- Shipping the checklist before invites", " "],
      decided: ["The checklist ships first"],
      actions: [{ who: "Ben", items: ["Write the invite emails"] }, { who: "Ada", items: [] }],
      open: ["None"],
      facts: facts.facts,
    });
    c = await listed();
    assert.equal(c.title, "Checklist first, then invites");
    assert.deepEqual(c.summary.discussed, ["Shipping the checklist before invites"]);
    assert.deepEqual(c.summary.actions, [{ who: "Ben", items: ["Write the invite emails"] }]);
    assert.deepEqual(c.summary.open, []);
    assert.deepEqual(c.people.map((p: { name: string }) => p.name), ["Ada Park", "Ben Ortiz"]);

    // The page may start a summary itself (Summarize on a call that has none).
    const launched = await page("run/launch", { workflow: SUMMARIZE, input: { job: CALL } });
    assert.match(String(launched.result?.runId), /\S/, JSON.stringify(launched));
    await ended(SUMMARIZE, launched.result.runId);
  });

  it("ships its pages", async () => {
    for (const name of ["Canvas Planning", "Brainstorm", "Brainstorm Method", "Brainstorm Framing", "Call Canvas", "Call Summary"]) {
      const text = await readFile(join(HERE, "concepts", `${name}.md`), "utf8");
      assert.match(text, new RegExp(`^---\\nname: ${name}\\n`));
      assert.doesNotMatch(text, /\bHive\b|org_id|HiveInitiative|InitiativeFeature/);
    }
  });
});
