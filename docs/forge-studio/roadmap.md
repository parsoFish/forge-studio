# Forge Studio — Roadmap

> Strangler pattern: forge keeps shipping real cycles at every milestone.
> Each milestone ends with the full regression spine green:
> `npm test` + `npm run build` + `forge brain lint` + `npm run ui:journey`,
> and — wherever the execution path is touched — the operator-gated
> `npm run verify:cycle`. A milestone is not done until its features appear
> in the e2e-journey (demos-as-evidence rule).

Milestones are dependency-ordered but internally decomposable into
forge-sized initiatives (large bundles: functionality + tests together).
Where forge builds itself, the architect→PM machinery does the decomposition;
this roadmap fixes scope, boundaries, and exit criteria.

---

## M0 — Definitions as data (foundation, no behaviour change)

**Goal:** the four object schemas exist, are validated, and describe today's
forge exactly. Nothing reads them on the hot path yet.

Workstreams:

1. **ADR-027: object model + storage** — agent = extended SKILL.md
   frontmatter; flow.yaml; project.json extensions; kb.yaml; catalog.yaml;
   id/slug rules; the one-canonical-writer rule. Amends ADR-024 (agent
   definition) and ADR-018 (kb descriptor).
2. **`orchestrator/studio/registry.ts` + `validate.ts`** — load, validate,
   serialize all definition types (gray-matter/js-yaml, same stack as
   manifests). Validation: agent readiness (6 checks), flow structural rules
   (DAG acyclic, agents exist, zero-gate rejection unless disposable,
   fanOut references a real upstream artifact), kb scope enum, catalog
   integrity (model→sdk refs).
3. **Seed data** — frontmatter added to the six existing SKILL.md files
   (purpose/composition/runtime/brainAccess/interactivity/budgets, mirroring
   today's `*-invocation.ts` specs verbatim); `studio/flows/forge-cycle/flow.yaml`
   describing the current cycle; `studio/catalog.yaml`; `kb.yaml` in the three
   brains; `studio/projects.yaml` registry.
4. **Spec derivation test** — for each phase, `PhaseAgentSpec` derived from
   SKILL.md frontmatter deep-equals the hardcoded spec in its invocation
   file. This test is the no-drift lock until M3 deletes the hardcoded specs.
5. **CLI:** `forge studio lint` — validate all definitions (joins the
   standing gate set).

**Exit criteria:** all definitions lint clean; derivation test green;
zero behaviour change (verify-cycle not required — hot path untouched).

---

## M1 — Run model + Studio read-only UI (see everything, edit nothing)

**Goal:** the mocks' *monitor* surfaces become real, driven by live data.
Highest leverage per line: it is almost entirely a read layer over
events.jsonl + queue state the system already writes.

Workstreams:

1. **`orchestrator/run-model.ts`** — the run aggregator (architecture §1
   "Run"): queue dirs + manifest + events.jsonl + artifacts dir → the mock's
   Run shape (status, phases, phaseMeta incl. iter/budget/brainReads/
   delivered/lastProgress, artifactsReady, gate, failedAt, origin). Unit
   tests against recorded real-cycle event logs (betterADO archives in
   `_logs/`/`brain/cycles/_raw/` provide fixtures).
2. **Bridge read routes** — `/api/runs`, `/api/runs/:id`,
   `/api/runs/:id/phases/:node/log` (with stderr filter),
   `/api/studio/*` GETs, `/api/studio/catalog`. WS push extended with
   run-model deltas.
3. **Structured gate sub-check events** — the composed 5-gate emits one
   event per sub-check (id, pass/fail, detail) so the drawer can show
   *which* check is stuck (brain: which-sub-check observability).
4. **UI: library page (`/`)** — four sections + operator pulse, cards with
   live strips/gated chips, all data-* mirrored. Existing dashboard remains
   reachable until M4 completes the fold-in.
5. **UI: flow monitor (`/flows/[id]`, monitor tab only)** — run rail grouped
   by status, summary strip, topology from flow.yaml rendered with existing
   hex components, phase drawer (status/model/cost/retries, liveness +
   wedged banner, iteration pips, brain-reads line, delivered stats, gate
   sub-checks, artifact chips, log tail + stderr filter), live event tail.
   Resume/start buttons render disabled (write paths are M3).
6. **e2e-journey act:** library + monitor beats over a seeded synthetic run
   (same emulation pattern as today).

**Exit criteria:** during a real cycle, the operator can watch the entire
run on the new monitor with parity to (or better than) the old dashboard;
ui:journey green with new acts; run-model unit suite green against real
fixtures.

---

## M2 — Builders: Agents + Projects (first write surfaces)

**Goal:** agents and projects become editable objects through the UI;
definitions begin to *drive* the hot path (specs read from files).

Workstreams:

1. **Agent builder UI (`/agents/[id]`)** — full mock spec: catalog palette
   (search/collapse/used-dimming), 4 typed drop zones with kind rejection,
   name/purpose/process/interactivity, SDK picker (non-Claude disabled),
   fixed/range strategy UI (range selectable, stored, enforced M6),
   sub-agent model, knowledge-access cards, YAML preview, readiness panel,
   used-in-flows, dirty/discard/unsaved-guard, `?id=` routing.
2. **Bridge write routes** — `PUT /api/studio/agents/:id`,
   `PUT /api/studio/projects/:id` through registry serializer + server-side
   validation. **security-review skill before merge** (first write surface).
3. **Invocation files read definitions** — `pm-invocation.ts`,
   `dev-invocation.ts`, `unifier-invocation.ts`, `reflector-invocation.ts`
   derive specs from SKILL.md frontmatter (derivation test from M0 flips
   from "deep-equal both sources" to "file is the only source").
   `brainAccess` drives the existing enforcement (PM 0-reads abort keys off
   `mandatory`).
4. **Architect → PhaseAgentSpec** — `architect-runner.ts` adopts the derived
   spec (model tiering + allowedTools), closing the last ADR-024 gap.
5. **Project builder UI (`/projects/[id]`)** — north star (+140 counter),
   instructions + readback, demo-process timeline (typed steps, drag-reorder,
   presets), skills binding, KB bind/create, contract readiness driven by
   `forge preflight` via bridge, used-by-flows, Ctrl+S.
6. **Project config extensions consumed** — `instructions` injected into
   agent context (generalising `standing_work_item_acs`); `demoProcess` +
   `skills[]` composed by the unifier/demo path (closes the `demo.skill`
   known-gap §2026-05-31); contract-ready check enforced at claim time.
7. **e2e-journey acts:** edit-an-agent (composition + save + readiness),
   edit-a-project (north star + demo steps + flow-ready).

**Exit criteria:** a real cycle runs with every phase spec sourced from
SKILL.md files and project instructions flowing into agents —
**verify:cycle (routine tier) passes**; builders fully functional in
ui:journey; security review clean.

---

## M3 — Flow engine (ADR-028): definition-driven execution

**Goal:** the scheduler executes the forge cycle *from its flow.yaml*.
The single riskiest milestone; everything in it hides behind the
verify-cycle oracle.

Workstreams:

1. **ADR-028** — engine semantics: node kinds (static, fanOut, gate),
   orchestrator-verified gates, resumable boundaries, triggers, budgets,
   edit-lock/versioning, terminal moves. Updates ADR-019/026 references.
2. **`orchestrator/flow-runner.ts`** — walk the DAG; existing phase
   functions (`project-manager.ts`, `developer-loop.ts` incl. unifier,
   `openPrInline`, closure, `reflector.ts`) become node executors invoked by
   the runner. `runCycle` shrinks to "load flow.yaml → flow-runner". No
   parallel old/new implementations left behind after cutover.
3. **Budgets + safety in the runner** — flow `costCeilingUsd` (warn 70%,
   stop at clean phase boundary 100%); per-node `wedgeKillMs` heartbeat-
   without-tool-progress kill (closes 33h-wedge gap; emits
   `phase.wedge-killed` + classifies resumable); rate-limit `resetsAt` spawn
   gate (promoted from theme to engine code).
4. **Write endpoints** — `POST /api/runs` (start planned run; origin-tagged),
   `POST /api/runs/:id/resume` (any `resumable` node),
   generalised `POST /api/runs/:id/gates/:gateId` with `/api/verdict` +
   `/api/plan-verdict` re-implemented as aliases over it. UI enables the
   start-run CTA, resume button, cost gauge.
5. **Triggers v1** — on-terminal-state enqueue of target flow;
   `knowledge-ingest` becomes the second seed flow (single brain-ingest
   node) proving a non-cycle flow runs end-to-end.
6. **Flow lint joins preflight** — claim refuses: project not contract-ready,
   flow version locked/invalid, zero-gate non-disposable.
7. **e2e-journey:** start-run, gate-approve, resume, ceiling-warn beats
   (emulated); **verify:cycle release tier** (full greenfield) — the cutover
   gate for deleting the hardcoded phase order.

**Exit criteria:** verify:cycle routine AND release tiers pass on the
engine path; hardcoded phase sequence deleted; a second flow definition
(knowledge-ingest) runs unattended; cost ceiling + wedge kill demonstrated
in harness.

---

## M4 — Flow builder canvas + unified artifact viewer

**Goal:** flows become authorable; every artifact type gets the one viewer
with gate bar. The remaining mock UI lands.

Workstreams:

1. **ADR-030 canvas spike + decision** — react-flow/xyflow vs extending the
   hex canvas; mock interaction spec is the acceptance bar (drag-create,
   ports/bezier edges, edge artifact labels + picker, mini-panel, autolayout,
   clear, keyboard map, reject states).
2. **Flow builder (`/flows/[id]`, build tab)** — full authoring against
   `PUT /api/studio/flows/:id` with versioning + edit-lock UX (banner when
   runs in flight); trigger management with a real flow picker; goal warning;
   project/kb binding.
3. **Unified artifact viewer (`/artifact?run&type&mode`)** — breadcrumb,
   artifact trail from run model, renderers: plan (goal/scope/non-goals/ACs/
   decomposition via dep-layout), work-items, PR snapshot, demo
   (DemoComparison), verdict, reflection; gate bar state machine
   (idle→approved/sent-back, decisions-resolved-before-approve) on the
   generalised gate endpoint; approval stamp; empty state.
4. **Fold-in + retirement** — `/review/[cycleId]` and the architect PLAN-gate
   iframe route through the viewer; old screens redirect; e2e-journey
   updated to the new routes; `tab=monitor` deep links consumed.
5. **e2e-journey:** author-a-flow act (drag agent, draw edge, label artifact,
   save, version bump) + gate-via-viewer acts replacing old review beats.

**Exit criteria:** the operator can build a new flow in the UI and run it
(engine from M3); all six artifact types render in the viewer; both human
gates operate through it; ui:journey fully migrated; verify:cycle routine
tier re-run (gate path touched).

---

## M5 — Knowledge Bases as objects

**Goal:** the brain becomes browsable, guidable, and health-visible — the
mock's knowledge page over real brains.

Workstreams:

1. **KB read API** — descriptors, graph (brain filesystem markdown +
   frontmatter layers → nodes/edges with index/theme/raw), node article rendering (markdown +
   `[[wiki-link]]` resolution, touched-by from frontmatter/git), health
   (`forge brain lint` as API: layer balance, orphans, link density,
   staleness).
2. **KB viewer (`/knowledge/[id]`)** — force-directed graph (d3-force or
   sigma.js), pan/zoom/drag/hover-adjacency, node article panel with
   inbound/outbound chips, scope-grouped selector, legend/counts, health
   panel + suggested-ingest action (queues an ingest run via triggers).
3. **Human guidance loop** — `POST guidance` writes `_guidance/*.md`
   (node-linked or floating); `brain-ingest` skill consumes + deletes them;
   guidance nodes render amber-diamond until ingested.
4. **Mechanical scope guard** — ingest validates category→brain routing
   against `kb.yaml` scope (closes brain gap #8); KB create from project
   builder scaffolds brain + descriptor.
5. **Reflection → KB links** — reflector lessons carry `target: <kb-node>`
   so the reflection renderer's KB badges resolve (artifact viewer M4 hook).
6. **e2e-journey:** browse-KB + pin-guidance acts.

**Exit criteria:** all three brains (+ project brains) browsable; guidance
round-trip proven (pin → ingest → themed); lint-as-API parity with CLI;
ui:journey green.

---

## M6 — Multi-runtime + model range (ADR-029)

**Goal:** the agent-builder's runtime promises become real beyond Claude.

Workstreams:

1. **ADR-029 + adapter seam** — extract the adapter interface from
   `createClaudeAgent` (spawn, heartbeat, idle-deadline, usage-delta, tool
   events); `loops/_adapters/claude/` is moved code, behaviour-identical
   (verify:cycle routine tier guards the move).
2. **Second adapter** — one of Codex/Gemini/local chosen by operator
   priority; conformance suite (the adapter contract tests) gates it.
   New external dep = ask-first per CLAUDE.md.
3. **Model `strategy: range`** — router in the adapter layer: cheapest
   capable tier first, escalate on gate failure; per-run cost attribution
   unchanged.
4. **UI enablement** — SDK picker options unlocked per installed adapter;
   range strategy live.

**Exit criteria:** an agent on a non-Claude SDK completes a node in a real
flow run; range-strategy agent demonstrably routes down-tier (event log
evidence); verify:cycle both tiers green.

---

## M7 — Consolidation + productionisation ([ADR 031](../decisions/031-studio-consolidation.md))

**Goal:** make Forge Studio the **one product**. M0–M6 landed the new surfaces
alongside the ones they replace (strangler); M7 rips out the legacy and
productionises the launch. Not a feature build except the architect rebuild
(operator-chosen).

Workstreams (dependency-ordered):

1. **ADR-031 (gate)** — Studio sole surface; `/dashboard` deleted; architect
   rebuilt in Studio; CLI full removal; `forge studio` launcher. Amends 023,
   notes 020/021.
2. **Harness → Studio selectors (precedes deletion)** — e2e-journey beats 0–21
   re-homed from `/dashboard` to the `/flows/forge-cycle` monitor; green on
   unmodified `main` proves the Studio monitor has parity before anything is cut.
   Cross-project `[data-project-group]` assertion dropped (decision 2).
3. **Delete `/dashboard` + the dashboard-exclusive component/lib cluster** —
   `AgentGraphCanvas`/`HexDetailDrawer`/`ActivityPanel`/`FileHeatmap`/
   `ArchitectLauncher`/`SchedulerBanner` + cycles-tab + dead lib; sever the
   `hex-detail`→`bridge-client` type first. Keep `phases`/`dep-layout`/
   `status-colors` (Studio-shared).
4. **Fold `/review` + `/reflect` into `/artifact`** — repoint the live Studio
   "Open gate →" links; redirect/delete the wrappers.
5. **Rebuild the architect interview + PLAN gate inside Studio** — native
   surfaces replacing `/architect/[sessionId]`; preserve the P1–P4
   architect-observability assertions; bridge unchanged.
6. **CLI full removal** — migrate `verify:cycle` onto the bridge verdict POST;
   bridge calls daemon helpers directly (stop spawning `forge start`); delete
   `start`/`stop`/`pause`/`resume`/`status`/`review --approve`, internalise
   `architect run`. Keep the runtime spine.
7. **`forge studio` canonical launcher** — deterministic health-probe readiness +
   structured ready signal; `forge watch` a one-milestone deprecated alias; the
   harness `startWatch` reads the signal instead of scraping stdout.

**Exit criteria:** `/dashboard` + the dual CLI gone; Studio is the only run view +
operator API; `forge studio` brings up a ready UI deterministically; full spine
green (`npm test` + build + `forge brain lint` + `forge studio lint` +
`npm run ui:journey`) and `verify:cycle` re-run (the approve/execution path is
touched in M7-5).

---

## Cross-cutting tracks (run alongside every milestone)

- **Harness evolution:** e2e-journey gains acts the same PR that lands a
  surface; verify-cycle stays the only real-capability gate (ADR-022).
- **ADR hygiene:** conflicts update the ADR first (ADR-010/018/019/020/021/
  024/026 all get touched as noted).
- **Brain feedback:** the 10 logged brain gaps (multi-flow isolation, agent
  versioning, KB sharing, gate policy, …) get themes as milestones answer
  them; reflection after each forge-on-forge cycle.
- **Known-gaps burn-down:** M2 closes `demo.skill`; M3 closes wedge-kill +
  cost-ceiling + merge-boundary live-acc gate (runner enforces per-WI
  outcomes before PR); report-regeneration + lint-in-per-WI-gate scheduled
  with M3's runner work.
- **Size discipline:** any file the work pushes past 800 LOC splits in the
  same PR (`ui-bridge.ts` is already at 1,195 — splits when studio routes
  land in M1/M2).

## Sequencing rationale

M0→M1 front-loads *visibility* (cheapest, zero-risk, immediately useful for
operating today's forge). M2 makes definitions load-bearing while the
execution order is still hardcoded (small blast radius). M3 is the risky
cutover, taken only with builders + run model already proven and
verify-cycle as oracle. M4–M5 are UI-heavy and ride on stable engine + data.
M6 last: largest external-dependency surface, zero value until flows exist
to put runtimes in.
