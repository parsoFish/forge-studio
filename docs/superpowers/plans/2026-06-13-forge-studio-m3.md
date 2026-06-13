# Forge Studio M3 — Flow Engine (ADR-028): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The scheduler executes the forge cycle *from its `flow.yaml`* via a definition-driven `flow-runner.ts`. The hardcoded phase sequence in `cycle.ts` is replaced by a DAG walk over the FlowDefinition, with the existing phase functions invoked as node executors — bit-for-bit behaviour preserved. Runner-level budgets/safety (cost ceiling, wedge-kill, rate-limit) land. Generalised gate + run write endpoints. A second seed flow (`knowledge-ingest`) proves non-cycle flows run. This is the **riskiest milestone** — everything hides behind the equivalence oracle.

**Architecture:** Strangler. `orchestrator/flow-runner.ts` interprets a FlowDefinition (ADR-027 types, M0): walk nodes in topological order; `static` node → spawn its agent's executor; `fanOut` node → the existing per-WI dev-loop engine; `gate` node → park the run as `gated`, wait on the verdict endpoint. `runCycle` shrinks to "load `forge-cycle/flow.yaml` → `flow-runner`"; the phase functions (`runProjectManager`, `runDeveloperLoop`/`runUnifier`, `openPrInline`+`runClosure`, `runReflector`) become **node executors invoked unchanged**. The hardcoded sequence is deleted only when the engine path reproduces the hardcoded path's behaviour (equivalence tests + engine-path verify run).

**Tech Stack:** Existing TS ESM + node:test, the M0 registry (`loadFlowDefinition`, `validateFlow`), the M1 `run-model`, the M2 `bridge-studio` write seam. No new deps.

---

## Ground-truth facts (verified 2026-06-13 — do NOT re-derive)

**ADR-028 is Accepted** (`docs/decisions/028-flow-engine.md`) — the plan implements its 9 decisions exactly. Most-critical invariants: human gates structural + orchestrator-verified (no auto-approve code path), never self-modify while running, resume never discards work, budgets/safety in the runner not prompts.

**The hardcoded sequence (`runCycle`, `orchestrator/cycle.ts:65`, 999 LOC):**
- `CycleInput` (`cycle-context.ts:19`): `{initiativeId, manifestPath, projectRepoPath, worktreePath, cycleId?, dryRun?, confirmMerge?, resumeFrom?: 'unifier', qualityGateCmd?, eventTee?}`. Threaded unchanged to every phase.
- Sequence + call sites: synthetic architect events (`cycle.ts:119-147`, architect runs OUT-OF-CYCLE) → `runProjectManager(input, logger)` (`cycle.ts:211`, skipped on resumeFrom) → `runDeveloperLoop(input, logger)` (`cycle.ts:213`; **`runUnifier` is called INSIDE it at `developer-loop.ts:638`**) → `openPrInline(input, logger)` (`cycle.ts:266`, private, returns ReviewerOutcome) → `runClosure(input, logger, reviewerOutcome)` (`cycle.ts:275`) → `runReflector(input, logger)` (`cycle.ts:278`, only when `closure.merged`).
- Resume (`cycle.ts:176-210`): `resumeFrom==='unifier'` → preserve `.forge/{work-items,unifier-items}`, rebase preserved branch onto main, skip PM, dev-loop runs zero per-WI Ralphs + only unifier.
- Terminal-move authority: `closure.ts:79` `terminalMove()` (in-flight→done on confirmed merge, else →ready-for-review). Failure path: `scheduler.ts:636` →failed.

**Node-executor signatures (become flow-runner executors, UNCHANGED):**
- `runProjectManager(input: CycleInput, logger, options?={}): Promise<void>` (`project-manager.ts:82`) — writes `.forge/work-items/*.md`; throws on fail.
- `runDeveloperLoop(input, logger): Promise<{unifierSucceeded, unifierFailureClass, commitsAhead, filesChanged, insertions}>` (`developer-loop.ts:190`) — N per-WI Ralphs in topo order, then calls `runUnifier` internally.
- `runUnifier(input, logger, parentEventId): Promise<{succeeded, failureClass}>` (`developer-loop.ts:996`).
- `openPrInline(input, logger): Promise<ReviewerOutcome>` (`cycle.ts:460`, PRIVATE — must be exported or lifted for the runner).
- `runClosure(input, logger, reviewerOutcome): Promise<{outcome, merged}>` (`closure.ts:114`).
- `runReflector(input, logger, deps?={}): Promise<{reflection_status, lint_status}>` (`reflector.ts:103`, log-and-continue, never throws).
- Architect: `runArchitectTurn` (`architect-runner.ts`) runs OUT-OF-CYCLE via the bridge; `runCycle` only emits synthetic architect events. **The flow's `architect` gate node is satisfied before the queue run begins** (PLAN gate → promoteManifests → `_queue/pending/`). The flow-runner's cycle run STARTS at the `pm` node; the `architect` node is a no-op-in-queue marker (its gate already cleared). Keep this — do NOT try to run the architect inside flow-runner.

**Scheduler (`scheduler.ts`):** `serve()` (`:74`) → `runOne` (`:531`): listPending (deps-gated `:375`) → claim (pending→in-flight) → worktree add/reuse (resume check `:563`) → linkProjectDeps → annotateManifest → `await runCycle({...resumeFrom, eventTee})` (`:585`) → dispatchTerminalStatus. Heartbeat 30s (`:538`); recovery sweep 5min (`:249`). `maxConcurrentInitiatives=2`. `resumeFrom` from `manifest.resume_from` (`:695`).

**Safety GAPS M3-3 must close (verified absent today):**
- **NO cycle-level cost ceiling** — `costCeilingUsd: 25` in flow.yaml is metadata only; `CycleInput` has no `costBudgetUsd`; only PM/reflector self-bound their SDK calls; per-WI dev is `usd: Infinity` (C19).
- **NO wedgeKill** — `AgentBudgets.wedgeKillMs` exists in `types.ts:26` but is wired to nothing; wedge detection was REMOVED from `ralph/runner.ts` (`developer-loop.ts:1361` comment). No 33h-gap detection, no `agent_heartbeat` consumer.
- **NO rate-limit `resetsAt`** — does not exist anywhere. Only `StreamDeadlineError` (6-min idle, `stream-deadline.ts:42`, on PM/architect streams only) + transient auto-retry (`scheduler-dispatch.ts:158`, `MAX_AUTO_RETRIES=2`).
- Present already: idle-deadline (PM/architect), auto-retry (transient/terminal), heartbeat+stale-recovery, `withIdleDeadline`.

**Gates today:** review = cycle reaches `runClosure`, `confirmMerge` returns false (operator hasn't merged) → manifest →ready-for-review, worktree preserved; periodic `runFinalizeSweep` (5min) re-confirms merge → done → reflector. Auto-approve (verify harness) = inject `confirmMerge: () => true`. PLAN gate = architect `awaiting-verdict`, bridge `/api/architect/:sid/verdict` resumes. Send-back = appends UWIs to `.forge/unifier-items/` + enqueues `resume_from: unifier`.

**M0 flow definition (`studio/flows/forge-cycle/flow.yaml`):** nodes architect(gate:plan)/pm/dev(fanOut:work-items)/unifier(resumable)/review(gate:verdict)/reflect; edges + `costCeilingUsd:25`. `loadFlowDefinition` (`registry.ts:318`), `validateFlow(flow, agents)` (`validate.ts:134`, acyclic/fanOut/zero-gate). Types in `types.ts:48`.

**M2 write seam:** `cli/bridge-studio.ts` `handleStudioWriteRoutes` (PUT); CSRF `x-forge-csrf` required on all non-GET (`ui-bridge.ts`); `readJson` 1 MiB cap; origin allowlist. M3 POST routes plug in the same way + require the CSRF header.

**M1 run-model:** `orchestrator/run-model.ts` `buildNodeMapping(root)` already maps event phases → flow node ids (the engine will own this per ADR-028; today it's a hardcoded fallback table). The event log `phase` field already carries node-ish ids.

---

## Design decisions locked for M3

1. **Equivalence is the cutover oracle.** flow-runner v1 supports EXACTLY the node/edge/gate shapes the forge-cycle needs and must produce the SAME phase sequence + SAME events + SAME terminal moves as `runCycle` does today. Proven by: (a) unit tests asserting flow-runner walks `forge-cycle.yaml` into the identical executor call order with identical CycleInput threading; (b) an engine-path `verify:cycle` run matching the M2 baseline behaviour (same fresh-cycle execution — PM spawns, dev runs — and the SAME `gate-too-loose` outcome at base f61d186, proving behavioural identity; the orthogonal corpus-gate artifact is expected and is itself the equivalence signal). The hardcoded sequence is deleted ONLY after both pass.
2. **flow-runner owns the walk; phase fns are unchanged executors.** No phase function is rewritten. `flow-runner.ts` is a thin interpreter: resolve node order (topological over edges), dispatch each node to its executor by the agent slug / node kind, thread CycleInput. `runUnifier`-inside-`runDeveloperLoop` stays coupled for M3 (the `dev` fanOut node executor = `runDeveloperLoop` which still calls `runUnifier`; the flow's separate `unifier` node is satisfied by that internal call — document this as the M3 coupling, a clean split is deferred). The `review` gate node = `openPrInline` + park-for-verdict + `runClosure`.
3. **The architect node is pre-satisfied.** A queued run enters flow-runner at the first non-gate, non-architect node (`pm`). flow-runner emits the synthetic architect events (lifted from `cycle.ts:119-147`) then proceeds. No architect execution inside the runner.
4. **Budgets/safety are NEW runner code (M3-3), additive + opt-in via flow/agent fields:**
   - `costCeilingUsd` (flow): the runner tracks cumulative `cost_usd` from emitted events; at ≥70% emit `flow.cost-warn`; at ≥100% stop at the next clean phase boundary (after the current node completes, before the next spawns) — emit `flow.cost-ceiling-stop`, classify the run resumable, move to failed/ for operator. Never mid-write.
   - `wedgeKillMs` (agent budget): a per-node heartbeat-without-tool-progress timer. The runner watches the node's event stream; if no `tool_use`/`file_change` event for `wedgeKillMs` while `agent_heartbeat` still fires, abort the node, emit `phase.wedge-killed`, classify resumable. Closes the 33h gap. Default from the agent def's `budgets.wedgeKillMs` (M0 field); if unset, no wedge kill (back-compat).
   - rate-limit `resetsAt`: when an SDK call surfaces a rate-limit error carrying a reset time, the runner gates the NEXT spawn until `resetsAt` (sleep-or-park). Promoted from theme to engine code. (If the SDK error shape doesn't expose resetsAt cleanly, implement the gate seam + a conservative backoff and note the limitation.)
5. **Gate endpoints generalised (M3-4):** `POST /api/runs/:id/gates/:gateId` body `{verdict: 'approve'|'send-back', notes?}` — server-verified, the ONLY approve path. `/api/verdict` + `/api/plan-verdict` re-implemented as thin aliases over it. `POST /api/runs` (start a planned run, origin-tagged) + `POST /api/runs/:id/resume` (resume_from a resumable node). All require the CSRF header (M2 pattern).
6. **Claim refuses (M3-6):** at claim time, reject if project not contract-ready (`forge preflight` hard clauses), flow invalid/locked (validateFlow + edit-lock), or zero-gate non-disposable. `flow studio lint` already covers static validity; the claim-time check adds contract-ready + lock.
7. **Triggers + knowledge-ingest (M3-5):** on a terminal state, fire the flow's `triggers` (`on: complete → flow`) by enqueueing the target flow's run. `knowledge-ingest` = a new single-node seed flow (`studio/flows/knowledge-ingest/flow.yaml`, one `brain-ingest` agent node + a `disposable: true` or a gate — decide: knowledge-ingest has no human gate, so it MUST be `disposable: true` per the zero-gate rule). Proves a non-cycle flow runs end-to-end.

---

## Tasks

### Task 1: ADR-028 reference sync + flow-runner skeleton + node mapping (M3-1/M3-2 foundation)
**Files:** `orchestrator/flow-runner.ts` (new), `orchestrator/flow-runner.test.ts`, export `openPrInline` from cycle.ts (or lift to a module), `docs/decisions/028-flow-engine.md` (status note: implementation landing).
- [ ] Export `openPrInline` from `cycle.ts` (it's private at `:460`) so the runner can call it — minimal change, no behaviour change; add a test that the existing cycle still works.
- [ ] `flow-runner.ts`: `export async function runFlow(args: { flow: FlowDefinition; input: CycleInput; logger: EventLogger; deps?: FlowRunnerDeps }): Promise<CycleResult>`. `FlowRunnerDeps` injects the executors (`runProjectManager`, `runDeveloperLoop`, `openPrInline`, `runClosure`, `runReflector`) for testability — default to the real ones. Walk: topological order over `flow.nodes`/`flow.edges`; for each node, dispatch by kind (agent slug → executor; gate → park; architect → synthetic events). Thread CycleInput unchanged. Honour `resumeFrom` (skip to the resumable node).
- [ ] TDD: with mock executors, assert `runFlow(forge-cycle, input)` calls executors in the order pm → dev(+unifier internal) → openPrInline → closure → reflect, with the SAME CycleInput each, and emits synthetic architect events first. Assert resumeFrom='unifier' skips pm + per-WI dev. Assert a gate node parks (returns a `gated` result without calling downstream). This is the EQUIVALENCE spec.
- [ ] Spine green; commit `feat(flow-engine): flow-runner skeleton — DAG walk over flow.yaml with injected node executors (M3-1/2)`.

### Task 2: runCycle delegates to flow-runner (the cutover wiring, behind equivalence)
**Files:** `orchestrator/cycle.ts` (runCycle → load forge-cycle flow + runFlow), tests.
- [ ] `runCycle` loads `studio/flows/forge-cycle/flow.yaml` (loadFlowDefinition) and calls `runFlow({flow, input, logger})`. The phase-sequencing body of runCycle is REPLACED by the runFlow call; the synthetic-architect + resume + terminal-move logic moves into flow-runner (or stays in runCycle as pre/post around runFlow — keep terminal move in closure as today). Keep `CycleInput`/`CycleResult` identical.
- [ ] CRITICAL: the FULL existing cycle test suite must pass UNCHANGED (every cycle.ts test, every phase test). This is the equivalence proof at the unit level. If any test breaks, the runner isn't equivalent — fix the runner, not the test.
- [ ] Run-model's `buildNodeMapping` should now derive from the flow (it already tries; confirm it reads forge-cycle.yaml). 
- [ ] Spine green (851+); commit `feat(flow-engine): runCycle delegates phase sequencing to flow-runner (forge-cycle.yaml)`.

### Task 3: Runner budgets + safety (M3-3)
**Files:** `orchestrator/flow-runner.ts` (+ a `flow-budgets.ts` helper if it keeps the runner <800 LOC), tests.
- [ ] **costCeilingUsd**: the runner accumulates cost from events; ≥70% → `flow.cost-warn` event; ≥100% → stop at the next clean phase boundary, emit `flow.cost-ceiling-stop`, classify resumable, fail-move. TDD with a fake event stream crossing the thresholds.
- [ ] **wedgeKillMs**: per-node heartbeat-without-tool-progress timer; on breach abort the node, emit `phase.wedge-killed`, classify resumable. Default from the agent def's `budgets.wedgeKillMs`; unset → disabled. TDD with a fake clock + heartbeat-only stream (no tool events) past the ceiling → kill; with tool events → no kill.
- [ ] **rate-limit resetsAt**: a spawn-gate seam — before spawning a node's agent, if a prior rate-limit error recorded a `resetsAt`, wait until then (or a conservative backoff). TDD the gate logic (inject the clock + a recorded resetsAt).
- [ ] These are additive — a flow without ceiling/wedge fields behaves exactly as today. Confirm the forge-cycle run still passes the full suite.
- [ ] Spine green; commit `feat(flow-engine): runner cost-ceiling, wedge-kill, rate-limit gate (M3-3)`.

### Task 4: Run + gate write endpoints (M3-4)
**Files:** `cli/bridge-studio.ts` (POST routes in handleStudioWriteRoutes), `cli/ui-bridge.ts` (verdict/plan-verdict become aliases), `forge-ui/lib/studio-client.ts` (+ startRun/resumeRun/postGate), tests.
- [ ] `POST /api/runs` (start a planned run — stage the flow's manifest, origin-tag), `POST /api/runs/:id/resume` (resume_from a resumable node), `POST /api/runs/:id/gates/:gateId` `{verdict, notes?}` (the generalised gate — server-verified). Re-implement `/api/verdict` + `/api/plan-verdict` as thin aliases that call the generalised gate handler. All require `x-forge-csrf` (M2). Path/slug guards (M2 pattern).
- [ ] UI: enable the start-run CTA + resume button + cost gauge on the flow monitor (M1 rendered them disabled). The gate-approve already exists via the review screen — route it through the generalised endpoint.
- [ ] **security-review** the new write routes (gate endpoints are the approve path — auth surface). Address findings.
- [ ] TDD: start/resume/gate routes + the alias equivalence (old /api/verdict still works). Spine green; commit `feat(flow-engine): generalised run + gate write endpoints; verdict/plan-verdict aliases (M3-4)`.

### Task 5: Triggers v1 + knowledge-ingest seed flow (M3-5)
**Files:** `studio/flows/knowledge-ingest/flow.yaml` (new), `orchestrator/flow-runner.ts` (trigger firing on terminal), the brain-ingest agent (a SKILL.md — `skills/brain-ingest` exists; give it studio frontmatter if needed), tests.
- [ ] `knowledge-ingest/flow.yaml`: single `brain-ingest` agent node, `disposable: true` (no human gate → must be disposable per zero-gate rule), `goal`, `kb`. Passes `forge studio lint`.
- [ ] flow-runner: on a flow's terminal state, fire `flow.triggers` (`on: complete → flow`) by enqueueing the target flow's run (a manifest into pending/, origin-tagged). TDD the trigger firing (forge-cycle's `triggers: []` → no-op; a flow with a trigger → enqueues).
- [ ] Prove knowledge-ingest runs end-to-end as a node executor (the brain-ingest skill composed) — at least a unit/integration test that runFlow(knowledge-ingest) dispatches the brain-ingest node. (A real ingest run is optional; the structural proof is the bar.)
- [ ] Spine green; commit `feat(flow-engine): triggers v1 + knowledge-ingest seed flow (M3-5)`.

### Task 6: Flow lint + claim refusal (M3-6)
**Files:** `orchestrator/scheduler.ts` (claim-time refusal), `cli/preflight.ts` integration, `orchestrator/studio/validate.ts` (edit-lock/version check if not present), tests.
- [ ] At claim time (scheduler `runOne` before runCycle): refuse if the project isn't contract-ready (`runPreflight` hard clauses fail), the flow is invalid (`validateFlow` errors) or version-locked, or the flow is zero-gate non-disposable. Emit a clear refusal event + leave the manifest in pending (or move to failed with a clear reason). TDD each refusal.
- [ ] Edit-lock: a flow with an in-flight run is read-only; saving creates `version: n+1` (the PUT flows route — but flow editing is M4; M3 just enforces the lock seam so in-flight flows can't be mutated mid-run). Minimal: the runner records the flow version it started with; if the on-disk version changed mid-run, log a warning (full edit-lock UX is M4).
- [ ] Spine green; commit `feat(flow-engine): claim refuses non-contract-ready/invalid/zero-gate flows (M3-6)`.

### Task 7: Harness + cutover gate (M3-7)
**Files:** `scripts/e2e-journey.mjs` (start-run/gate-approve/resume/ceiling-warn beats), `docs/forge-studio/work-items.md`, DELETE the hardcoded phase sequence remnants in cycle.ts.
- [ ] e2e beats (emulated, like M1/M2): start-run (POST /api/runs via the CTA), gate-approve (the generalised endpoint), resume (resume button), cost-ceiling-warn (a seeded run crossing 70%). Soft-assert data-*.
- [ ] **Cutover:** once Tasks 2+3 pass the full unit suite AND an engine-path `verify:cycle` run reproduces the M2 baseline behaviour (PM spawns + dev runs fresh; same outcome at base f61d186 — I am authorized to run verify:cycle), DELETE any now-dead hardcoded sequencing in cycle.ts (the runner is the only path). Re-run the full suite + ui:journey.
- [ ] **verify:cycle (authorized):** run the engine-path routine tier. Expected: the cycle runs fresh through the flow-runner (architect synthetic → pm → dev → ...) — the equivalence signal is that it behaves identically to the M2 baseline (same fresh execution, same `gate-too-loose` corpus artifact at f61d186). Document the run. If a NEW failure mode appears (different from the M2 baseline), that's a real flow-runner regression → fix before cutover.
- [ ] Full spine + commit `feat(flow-engine): e2e beats + cutover — hardcoded sequence deleted, engine is the only path (M3-7)`; tick work-items M3.

## Task order
1 → 2 (the cutover wiring, gated by the full suite) → 3 (safety, additive) → 4 (write endpoints) → 5 (triggers) → 6 (claim refusal) → 7 (cutover gate + delete). 4/5/6 can overlap after 3. Task 2 is the linchpin — if the full existing suite doesn't pass unchanged after runCycle delegates to flow-runner, the runner isn't equivalent; do not proceed to delete anything until it does.

## Self-review notes
- ADR-028 decisions 1-9 → Tasks: D1 (node kinds) T1; D2 (cutover) T2+T7; D3 (run derived) already M1; D4 (budgets) T3; D5 (resume) T1/T2; D6 (edit-lock) T6; D7 (triggers) T5; D8 (claim refuses) T6; D9 (gate endpoints) T4. ✓
- The equivalence-first strategy (T2 must pass the full suite unchanged) is the safety mechanism for the riskiest milestone — no behaviour change is provable by the existing tests staying green.
- verify:cycle: the engine path must match the M2 baseline ($0.78, gate-too-loose at f61d186). That SAME outcome on the engine path = behavioural equivalence proven. A DIFFERENT outcome = regression. The orthogonal corpus-gate artifact is the control, not a blocker.
- Size: flow-runner.ts must stay <800 LOC (split budgets into flow-budgets.ts if needed). cycle.ts SHRINKS (good — it's at 999 LOC, over cap; the cutover brings it under).
