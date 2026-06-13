# Forge Studio M1 — Run Model + Read-Only Studio UI: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mocks' monitor surfaces become real over live data: a server-side run aggregator, bridge read routes, structured gate sub-check events, the Studio library page at `/`, the flow monitor at `/flows/[id]`, and e2e-journey acts covering both. Read-only — start/resume render disabled.

**Architecture:** `orchestrator/run-model.ts` (pure aggregation over queue + manifest + events.jsonl + artifacts dir, unit-tested against recorded real-cycle logs) → `cli/bridge-studio.ts` (boolean-returning route module plugged into `handleHttp`, the `handleArchitect` pattern) → new Next.js pages styled by the mock's `tokens.css` promoted to global CSS vars. Old dashboard moves to `/dashboard` and stays reachable until M4.

**Tech Stack:** Existing: TypeScript ESM + node:test, Next 14 App Router, React 18, ReactFlow 11 (NOT used for the monitor topology — static positioned hexes + SVG beziers like the mock), plain CSS vars from tokens.css. No new deps.

---

## Ground-truth facts (verified 2026-06-13 — do NOT re-derive)

**Queue / status mapping:** `_queue/{pending,in-flight,ready-for-review,done,failed}/<initiativeId>.md`; `QueueState` at `orchestrator/queue.ts:28`; moves owned by `queue.ts` (`claim:83`, `moveTo:103`, `recover:144`); `.heartbeat` sidecar per in-flight manifest. Status map: pending→`planned`, in-flight→`active`, ready-for-review→`gated`, done→`complete`, failed→`failed`.

**Events:** written by `orchestrator/logging.ts` (`createLogger:118`) to `_logs/<cycleId>/events.jsonl`. `EventLogEntry` shape at `logging.ts:66` (event_id, cycle_id, initiative_id, phase, skill, iteration?, event_type, cost_usd?, tokens_*, started_at, finished_at?, message?, metadata?). `Phase` strings (`logging.ts:10`): `orchestrator|brain|architect|project-manager|developer-loop|unifier|review-loop|closure|reflection`. `EventType` (`logging.ts:21`): `start|end|log|error|tool_use|iteration|file_change|test_run|phase_transition|agent_heartbeat|brain-query`.

**Key message strings** (grep-verified): `cycle.start` (metadata.origin), `cycle.end` (metadata.status), `failure_classification` (metadata: failure_mode/failure_kind/recoverable/reason/evidence_event_ids — emitted from `cycle.ts:638`), `usage_delta` (metadata per-WI token deltas, `developer-loop.ts:172`), `ralph.start/end` (metadata.iterations, stop_reason), `dev-loop.delivered` (metadata delivered stats, `developer-loop.ts:731`), `gate.pass/fail/expected-fail/errored` (metadata.work_item_id, iteration), `unifier.start/end/failed`, `unifier.gate.*` (five sub-gates below), `closure.*`, `reflector.start/end`, `tool.<name>` + `agent.heartbeat` + `file.<op>` (`tool-event-emit.ts:141-193`), `pm.brain-query` (`project-manager.ts:235`).

**Per-cycle dir:** `_logs/<cycleId>/` = `events.jsonl`, `report.md`, `work-items-snapshot/` (WI-*.md + _graph.md), `artifacts/` (DEMO.md/DEMO.html/demo.json/PLAN.html), `pr-description.md` (`cycle.ts:365-415` snapshotCycleArtefacts). cycleId = `<ISO-dashes>_<initiativeId>`.

**Failure classifier:** `orchestrator/failure-classifier.ts:15` → `{kind: 'transient'|'terminal', reason, recoverable, evidence_event_ids}`.

**Origin:** manifest frontmatter `origin: architect|human-directed` (`manifest.ts:35`), echoed in `cycle.start` metadata.origin.

**Real fixtures:** `_logs/2026-05-30T22-45-07_INIT-2026-05-31-task-group-unit-tests/events.jsonl` (463 lines) and `_logs/2026-06-05T11-31-43_INIT-2026-06-05-complete-release-definition/events.jsonl` (501 lines). `_logs/` is gitignored — Task 1 COPIES these two into `orchestrator/run-model.fixtures/` (committed).

**Unifier 5-gate** (`developer-loop.ts`, `composedUnifierGate:1515`): sub-checks `initiative_gate` (:1518), `demo_runs_clean` (:1541, excused when demoShape none), `pr_self_contained` (:1565), `branches_in_sync` (:1611), `incomplete_delivery` (:1632, two failure modes). Today only FAILURES emit events (`unifier.gate.*`); M1-3 adds one structured event per sub-check always.

**Bridge:** `cli/ui-bridge.ts` (1195 LOC). Dispatch = if/url chain in `handleHttp` (:456-639); sub-handler pattern: `if (await handleArchitect(req,res,ctx,url,method)) return;` — handlers return boolean. Studio module plugs in identically after `handleReflect`. Helpers: `sendJson(res,status,body):1163`, `readJson(req):1147`, `broadcast(msg):132`. WS: fs.watch on queue dirs → `{type:'cycle-list-changed'}`; 200ms tail of live events.jsonl → `{type:'event',cycleId,event}`; snapshot on connect.

**forge-ui:** Next 14 / React 18 / ReactFlow 11 / inline styles (no global css yet). `app/page.tsx` (610 LOC) = dashboard. Components: AgentGraphCanvas(673), HexDetailDrawer(202), ActivityPanel(411), StageHex(170), FileHeatmap(117), lib/phases.ts (`derivePhaseStates`, PHASE_ORDER, canonicalPhase — 'closure'→'review-loop'), lib/wi-status.ts (`derivePerWiStatus`, `rollupStatus`, 5-state vocab), lib/dep-layout.ts (`topoLevels`), lib/bridge-client.ts (513 — `subscribe`, `resolveBridgeUrl`, fetch helpers). Bridge URL via `/api/forge-config` reading `FORGE_BRIDGE_URL`.

**Mock spec sources** (the implementer MUST read these files — they are the product spec): `mockups/agent-flow-builder/index.html` (library), `flow-builder.html` (monitor tab: run rail NEEDS YOU/ACTIVE/FAILED/QUEUED/COMPLETE, summary strip, topology hexes via `--hex-clip`, phase drawer with liveness/wedged banner/iter pips/brain-reads/delivered/gate sub-checks/artifact chips/log tail+stderr filter, event tail), `shared/tokens.css` (design tokens incl. `--c-project #5cc8ff / --c-agent #ff9e4a / --c-flow #b78cff / --c-kb #4ade80 / --c-artifact #fbbf24`, hex-clip polygon, 5-state status colours), `shared/data.js` (Run shape: status `active|gated|complete|failed|planned`, phases{}, phaseMeta{costUsd,lastProgressMin,retries,model,iter?,iterBudget?,brainReads?,delivered?,wedged?}, artifactsReady{type→'view'|'gate'}, gate, gateNote, failedAt, failNote, origin), `shared/shell.js` (nav: Library/Flows/Agents/Projects/Knowledge).

**e2e-journey** (`scripts/e2e-journey.mjs`, 1223 LOC): 23 beats in 3 acts; seeding helpers `cycleEvent/unifierEvent/archEvent/moveManifest/writeDemoJson`; soft-collect `check/countAtLeast`; `frame()` screenshots; video via Playwright recordVideo; `startWatch()` spawns `forge watch --no-open` with `FORGE_ARCHITECT_NO_SPAWN=1`; cleanup in finally. New beats slot inside main()'s try block.

**M0 building blocks now on main:** `orchestrator/studio/registry.ts` (loadFlowDefinition, listAgentDefinitions — agent frontmatter carries `phase` per agent), `studio/flows/forge-cycle/flow.yaml` (nodes architect/pm/dev/unifier/review/reflect; review is gate-only), `studio/catalog.yaml`, `studio/projects.yaml`, kb.yaml ×2, `cli/studio-lint.ts` Finding conventions.

---

## Design decisions locked for M1

1. **Run shape (server)** — `orchestrator/run-model.ts` exports:

```typescript
export type RunStatus = 'planned' | 'active' | 'gated' | 'complete' | 'failed';
export type RunPhaseStatus = 'pending' | 'active' | 'complete' | 'retrying' | 'failed';

export type RunPhaseMeta = {
  costUsd: number;
  retries: number;
  model?: string;
  lastProgressAt?: string;          // ISO — UI computes "Nm ago"
  wedged?: boolean;                 // no tool progress ≥30min while active
  iter?: number;
  iterBudget?: number;
  brainReads?: number;
  delivered?: { files: number; insertions: number; commits: number };
  gateChecks?: { id: string; pass: boolean; detail?: string }[];  // unifier node, from M1-3 events
};

export type Run = {
  id: string;                        // cycleId (or initiativeId for planned runs with no cycle yet)
  flowId: string;                    // 'forge-cycle' (only flow in M1)
  initiativeId: string;
  initiative: string;                // manifest title
  status: RunStatus;
  origin: 'architect' | 'human-directed';
  costUsd: number;
  startedAt?: string;
  phases: Record<string, RunPhaseStatus>;       // keyed by FLOW NODE id
  phaseMeta: Record<string, RunPhaseMeta>;
  artifactsReady: Partial<Record<'plan' | 'work-items' | 'pr' | 'demo' | 'verdict' | 'reflection', 'view' | 'gate'>>;
  gate?: string;                     // node id awaiting human ('review')
  gateNote?: string;
  failedAt?: string;                 // node id
  failNote?: string;
  workItems?: { id: string; status: RunPhaseStatus }[];  // fanOut materialisation for the dev node
};
```

2. **Node↔phase mapping** — flow node id → event-log Phase comes from the M0 registry: node.agent → SKILL.md frontmatter `phase` (architect→architect, project-manager→project-manager, developer-ralph→developer-loop, developer-unifier→unifier, reflector→reflector[events use `reflection`! map both via canonicalization]). Gate-only node `review` maps to event phases `review-loop`+`closure`. Hardcode the canonicalization table in run-model.ts with a comment pointing at ADR-028 (engine will own it in M3): `reflection→reflect-node`, `closure/review-loop→review-node`, `orchestrator/brain → ignored for phase status`.

3. **Bridge seam** — new file `cli/bridge-studio.ts`: `export async function handleStudioRoutes(req, res, ctx, url, method): Promise<boolean>` + one-line plug in handleHttp after handleReflect. ui-bridge.ts grows by ~3 lines only (stays under control; full split deferred to M2 when write routes land).

4. **WS deltas** — no new message types. The UI recomputes runs by re-fetching `/api/runs` on `cycle-list-changed` and applies `{type:'event'}` pushes to the open run's drawer/tail live. (Roadmap's "WS push extended with run-model deltas" satisfied by event passthrough + changed signals; new delta messages would duplicate state the UI can derive. Note in commit message.)

5. **UI shell** — `forge-ui/app/globals.css` created from mock tokens.css (vars verbatim + hex-clip + status/badge/dot classes, fonts fall back to system stacks — do NOT add Google-font deps); imported in root layout. New `components/StudioNav.tsx` (Library/Flows/Agents/Projects/Knowledge + dashboard link; non-existent pages render as disabled "M2/M4/M5" chips). Old dashboard: `app/page.tsx` MOVES to `app/dashboard/page.tsx` unchanged; new `app/page.tsx` = library. Old pages untouched otherwise.

6. **Monitor topology** — NOT ReactFlow: static layout from flow.yaml via `topoLevels` (x = level, y = lane), hex divs with `--hex-clip` + `data-status`, SVG bezier edges with artifact labels, fanOut node expands to N WI hexes from `run.workItems`. Matches the mock's `.mon-node` rendering and keeps the page simple; ReactFlow reuse is for the M4 BUILD tab decision (ADR-030).

7. **Phase log route** — `/api/runs/:id/phases/:node/log?stderr=1` returns the tail (last 200) of that node's events as `{lines: {at, kind, text}[]}` where kind ∈ `info|tool|cost|stderr|retry` derived from event_type/message (error→stderr, tool_use→tool, usage_delta/cost events→cost, retry-classified→retry). Stderr filter is server-side param AND client toggle.

---

## Tasks

### Task 1: `orchestrator/run-model.ts` + fixtures (M1-1)

**Files:** Create `orchestrator/run-model.ts`, `orchestrator/run-model.test.ts`, `orchestrator/run-model.fixtures/{trimmed real logs + synthetic manifests}`; copy the two real events.jsonl fixtures listed above (verify no secrets inside first: grep for `token|key|Authorization`).

- [ ] Step 1 (TDD): tests first against the real fixtures: aggregateRun() on the 463-line cycle log + a fabricated queue layout (tmp dir with _queue/done/<init>.md manifest + _logs/<cycleId>/) asserts: status complete; phases all complete; per-phase costUsd sums match manually-computed totals from the fixture (compute with `node -e` while writing the test, hardcode expected); origin architect; artifactsReady from artifacts dir contents; phaseMeta.iter/iterBudget from ralph events; brainReads from pm.brain-query + tool.Read-on-brain events; delivered from dev-loop.delivered metadata. Plus synthetic small fixtures for: active (in-flight + recent heartbeat), gated (ready-for-review → gate 'review', demo artifactsReady 'gate'), failed (failure_classification event → failedAt + failNote + recoverable), wedged (active, last tool_use 31+ min before "now" — aggregateRun takes `nowMs` param for determinism), planned (pending manifest, no cycle log → minimal Run).
- [ ] Step 2: implement. API: `listRuns(root, nowMs): Run[]` (walk all queue dirs; join newest cycle log per initiative via cycleId suffix match) + `aggregateRun(root, queueState, manifestPath, nowMs): Run`. Pure file reads, no caching (bridge adds none in M1 — logs are small; note perf deferral). Reuse `parseManifest` from orchestrator/manifest.ts; reuse studio registry for flow/node mapping; PORT the phase-status derivation semantics from forge-ui/lib/phases.ts + wi-status.ts (server copies, same tests style — UI versions stay for the old dashboard until M4).
- [ ] Step 3: suite + build green; commit `feat(studio): run-model aggregator over queue+events+artifacts (M1-1)`.

### Task 2: structured gate sub-check events (M1-3)

**Files:** Modify `orchestrator/phases/developer-loop.ts` (composedUnifierGate region only); test in `orchestrator/phases/developer-loop.gate-events.test.ts` (or extend existing developer-loop test file if one covers the gate — check first).

- [ ] Each of the 5 sub-checks emits exactly one `event_type:'log'`, `message:'unifier.gate.sub-check'`, `metadata:{check_id:'initiative_gate'|'demo_runs_clean'|'pr_self_contained'|'branches_in_sync'|'complete_delivery', pass:boolean, detail:string}` event — ALWAYS (pass and fail), emitted at the point each sub-check resolves; existing failure events unchanged (additive only).
- [ ] TDD: test drives composedUnifierGate via its existing seam (read how current tests fake the gate inputs; if untestable without heavy scaffolding, extract the smallest emit helper and unit-test that + assert call sites by grep-test). Run-model Task 1's gateChecks parser reads these (update its test fixture with sub-check lines).
- [ ] Suite green; commit `feat(studio): unifier 5-gate emits structured per-sub-check events (M1-3)`.

### Task 3: bridge read routes (M1-2)

**Files:** Create `cli/bridge-studio.ts` + `cli/bridge-studio.test.ts`; modify `cli/ui-bridge.ts` (~3 lines: import + dispatch line after handleReflect).

- [ ] Routes (all GET, sendJson, 404 on unknown id, 400 on bad input — explicit errors):
  - `/api/runs` and `/api/runs?flow=forge-cycle` → `{runs: Run[]}` via listRuns
  - `/api/runs/<id>` → `{run: Run}`
  - `/api/runs/<id>/phases/<node>/log?stderr=1` → `{lines}` per design §7
  - `/api/studio/agents` → `{agents: AgentDefinition[]}` (listAgentDefinitions, body included)
  - `/api/studio/flows` → `{flows: FlowDefinition[]}`
  - `/api/studio/projects` → `{projects}` (registry + per-project `.forge/project.json` northStar/kb fields when readable)
  - `/api/studio/kbs` → `{kbs: KbDescriptor[] + counts {index,themes,raw} from brain dir listing}`
  - `/api/studio/catalog` → catalog.yaml content
- [ ] TDD: spin the route handler against a tmp forge-root fixture (reuse run-model fixtures), call handleStudioRoutes with mocked req/res (follow existing cli/ test patterns), assert payload shapes + boolean returns + 404 passthrough (returns false for non-studio URLs).
- [ ] Suite green; commit `feat(studio): bridge read routes for runs + studio definitions (M1-2)`.

### Task 4: UI shell + library page (M1-4)

**Files:** Create `forge-ui/app/globals.css`, `forge-ui/components/StudioNav.tsx`, `forge-ui/lib/studio-client.ts` (fetch helpers + types mirroring Run/definitions), `forge-ui/app/dashboard/page.tsx` (MOVED old app/page.tsx, only the import paths and a "← Studio" link adjusted), new `forge-ui/app/page.tsx` (library); modify `app/layout.tsx` (import globals.css).

- [ ] Library page per mock index.html (READ IT): hero (skip the concept diagram in M1 — render the operator pulse panel only; diagram is decorative), four sections Projects/Agents/Flows/KBs with cards per mock spec (fields, truncations, badges, type colours), flow cards show live strip + gated/failed chips from `/api/runs`, pulse counts (gated/active/flows/agents). Data: studio-client fetches on mount + re-fetch on `cycle-list-changed` via existing subscribe(). All data-* mirrored: `data-page="library"`, `data-page-ready`, per-section `data-section/data-count`, per-card `data-card-type/data-card-id`, pulse `data-pulse-gated/active/flows/agents`. "+ New" buttons render disabled with title "M2".
- [ ] Old dashboard reachable at `/dashboard` (verify manually via dev server: both pages render, WS still works on dashboard).
- [ ] `npm run build` green (Next build catches page errors); commit `feat(studio-ui): tokens + nav shell + library page; dashboard moves to /dashboard (M1-4)`.

### Task 5: flow monitor page (M1-5)

**Files:** Create `forge-ui/app/flows/[id]/page.tsx` + components `forge-ui/components/studio/{RunRail,MonitorSummary,FlowTopology,PhaseDrawer,EventTail}.tsx`; extend `lib/studio-client.ts`.

- [ ] Per mock flow-builder.html monitor tab (READ IT): tabs bar renders Build tab disabled ("M4"); run rail grouped NEEDS YOU/ACTIVE/FAILED/QUEUED/COMPLETE; gated banner; summary strip (cost/elapsed/tally/run badge; cost gauge hidden — no ceiling enforcement until M3, render when flow.costCeilingUsd with warn colours); topology per design §6 (hex frames `data-status`, gated node needs-you tag, fanOut → WI hexes from run.workItems, bezier edges + artifact labels, ember animation complete→active); phase drawer (meta row status/model/cost/retries; liveness dot + wedged banner; iter pips + brain-reads line; delivered strip; gate sub-checks from phaseMeta.gateChecks; artifact chips linking `/api/artifact/<cycleId>/<file>` for view — gate chips link `/review/<cycleId>` until M4's viewer; log tail from the phases log route with stderr toggle; resume + start buttons rendered DISABLED with title "M3"); live event tail (subscribe() filtered to selected run's cycleId, cap 100).
- [ ] data-* contract: `data-page="flow-monitor"`, `data-flow-id`, `data-active-run`, rail cards `data-run-id/data-run-status`, topology `data-mon-node/data-node-id/data-status`, drawer `data-drawer-open/data-drawer-run/data-drawer-node`, summary `data-run-cost-usd`, tail `data-tail-count`.
- [ ] Next build green; manual smoke vs a seeded run (use the run-model fixture cycle copied under _logs/ temporarily, or drive scripts/e2e seeding helpers manually); commit `feat(studio-ui): flow monitor — run rail, topology, phase drawer, event tail (M1-5)`.

### Task 6: e2e-journey acts + spine (M1-6)

**Files:** Modify `scripts/e2e-journey.mjs` (navigation updates for `/dashboard` + new beats), `docs/forge-studio/work-items.md` (tick M1).

- [ ] Update all existing beats that navigate to `/` → `/dashboard` (the moved page keeps its data-* contract — assertions unchanged).
- [ ] New ACT IV — Studio monitor (after beat 21, before end card): beat 22 library (`/`): assert `data-page-ready`, 4 sections with `data-count` ≥1 each (flows ≥1 incl. forge-cycle; agents = 5 studio agents; projects ≥1; kbs 2), pulse counts; flow card live strip while the seeded cycle is gated → "needs you" chip. Beat 23 monitor (`/flows/forge-cycle`): rail shows the seeded run under NEEDS YOU; topology renders ≥6 `data-mon-node` (incl. ≥1 WI hex); click unifier hex → drawer `data-drawer-open=true`, gate sub-checks visible (seed sub-check events via unifierEvent with the M1-3 metadata shape), log tail non-empty; stderr toggle flips line count; event tail `data-tail-count` >0. Re-number end card. frame() each new beat.
- [ ] Full spine: `npm test` + `npm run build` + `forge brain lint` + `forge studio lint` + `npm run ui:journey` (exit 0, video produced). Paste counts.
- [ ] Commit `feat(studio): e2e-journey Act IV — library + monitor beats (M1-6)`; tick work-items doc.

## Task order

1 → (2, 3 after 1) → 4 → 5 (needs 3) → 6 (needs 4+5). Tasks 2 and 3 can run in either order after 1; everything else sequential.

## Self-review notes

- Roadmap M1 ws-1→Task 1, ws-2→Task 3, ws-3→Task 2, ws-4→Task 4, ws-5→Task 5, ws-6→Task 6. Exit criteria: monitor parity during a real cycle (operator-verified next real cycle; harness parity via Act IV), ui:journey green, run-model suite green vs real fixtures. ✓
- UI plan references mock files as the visual spec instead of duplicating full page code — deliberate deviation from the no-placeholder rule, the mocks are committed artifacts and are the contract (gap-matrix completeness rule).
- verify:cycle NOT required: only M1-3 touches the execution path and it is additive event emission; flagged for the next operator-gated run regardless.
