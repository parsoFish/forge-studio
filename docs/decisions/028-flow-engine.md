# ADR 028 — Definition-driven flow engine

**Status:** Accepted — 2026-06-13. Implementation staged across the M1 run
model and the M3 engine + cutover (milestone plans now in git history).
Amends ADR 011 (queue serves flow runs), ADR 019
(resume points become `resumable` node flags), ADR 026 (gate send-back
generalised). Generalises the human moments of ADR 020/021/031 into declared
gates. The forge cycle's behaviour is preserved bit-for-bit; ADR 022's
harness is the cutover oracle.

## Context

`orchestrator/cycle.ts` hardcodes PM → dev-loop → unifier → PR → closure →
reflector. Studio requires arbitrary operator-authored flows. The brain
binds twelve hard constraints on any such engine — most critically: human
gates are structural, gates are orchestrator-verified, the system never
self-modifies while running, and resume never discards work.

## Decision

1. **`orchestrator/flow-runner.ts` interprets FlowDefinitions (ADR 027).**
   Node kinds:
   - **static** — spawn the agent from its definition (Ralph loop or
     single-pass per the agent's process); orchestrator-verified gate after.
   - **fanOut** — multiplicity resolved at runtime from the named upstream
     artifact: one instance per item, worktree each, `depends_on` DAG
     respected. This is today's per-WI dev-loop engine, invoked as a node
     executor — not a reimplementation.
   - **gate** — park the run as `gated`; surface the artifact; wait on the
     verdict endpoint. Approve continues; send-back appends typed work items
     to the flow's declared handler node (the ADR 026 UWI mechanism,
     generalised: review→unifier is the first instance).
2. **Existing phase functions become node executors.** `runCycle` shrinks to
   "load flow.yaml → flow-runner". No parallel old/new implementations
   survive cutover: the hardcoded sequence is deleted once
   `verify-cycle` routine AND release tiers pass on the engine path.
3. **Run = derived, never stored.** `orchestrator/run-model.ts` aggregates
   queue state + manifest + `events.jsonl` + artifacts dir into the run view
   (phases, phaseMeta, artifactsReady, gate, failedAt, origin). Read-only;
   zero new write paths. The event log's `phase` field carries the flow-node
   id (ADR 008 schema: enum widens to string).
4. **Budgets and safety live in the runner, not in prompts:**
   - flow `costCeilingUsd` — warn at 70%, stop at a clean phase boundary at
     100% (never mid-write);
   - per-node `wedgeKillMs` — heartbeat-without-tool-progress ceiling kills
     the node via a concurrent `Promise.race` timer (not post-execution),
     emits `phase.wedge-killed`, classifies resumable. The race unblocks the
     cycle even when the executor hangs forever (closes the 33h-wedge gap).
     SDK abort is threaded into PM and accepted (not yet chained in dev-loop's
     per-WI Ralphs — TODO);
   - rate-limit `resetsAt` gates every spawn;
   - iteration/turn budgets carry over from agent definitions unchanged.
5. **Resume** targets any node flagged `resumable`; worktree preserved;
   rebase-onto-main at resume start (ADR 019 semantics, generalised).
6. **Edit lock / versioning:** a flow with in-flight runs is read-only;
   saving creates `version: n+1`, used by new runs only. The runtime never
   modifies definitions (forge-never-self-modifies, applied to Studio).
7. **Triggers:** terminal states may enqueue another flow's run
   (`on: complete → flow`). `knowledge-ingest` is the second seed flow and
   the proof a non-cycle flow runs end-to-end.
8. **Claim refuses:** project not contract-ready (`forge preflight`,
   ADR 017), flow invalid/locked, zero-gate non-disposable flow. Every run
   is origin-tagged (`architect | human-directed`).
9. **Gate endpoints are generalised:** `POST /api/runs/:id/gates/:gateId`
   (approve | send-back{notes}); `/api/verdict` and `/api/plan-verdict`
   become aliases. Server-verified; no auto-approve code path exists.

## Consequences

- New flows are data: authoring one requires no orchestrator change, only
  definitions that pass `forge studio lint`.
- The scheduler/queue (ADR 011/012) is untouched in shape — `_queue/`
  directories now hold flow-run manifests; atomic-mv claims, heartbeats, and
  the two-sweep recovery work as-is.
- Human-moment screens (ADR 020/021/031) survive as renderers of declared
  gates; the unified artifact viewer routes them (roadmap M4).
- The harness suite must evolve with the engine: e2e-journey gains acts per
  surface; verify-cycle gates every milestone touching the execution path
  and is the only authority for deleting the hardcoded path.
- Exploration-type flows stay deferred (schema reserves `type:`); zero-gate
  autonomy stays rejected absent new evidence (v1 review-spin incident).

## Amendment (M8-0, 2026-06-14): node-executor registry

Consequence #1 ("new flows are data; no orchestrator change") was *stated but
not yet true*: `flow-runner.ts` dispatched nodes via a hardcoded `classifyNode`
switch, so a genuinely new node kind required editing the runner. M8-0 closes
the gap between the stated consequence and the implementation:

- **Classification is data, not control flow.** Node→kind resolution is two
  tables (`GATE_KIND`, `AGENT_KIND`) read by `resolveNodeKind()`; a gate always
  wins over the agent field. Adding an agent that reuses an existing executor
  kind is a one-line row.
- **Dispatch is a registry.** `DEFAULT_NODE_EXECUTORS: Record<NodeKind,
  NodeExecutor>` is looked up by kind — the `switch` is gone. The per-node loop
  builds a `NodeExecContext` and calls `executors[kind] ?? execUnknown`.
- **The seam is injectable.** `FlowRunArgs.nodeExecutors` merges over the
  defaults, so a flow or test registers/overrides node behaviour without
  touching the runner.

Cross-node outcome state is threaded through a single `NodeRunState` object
instead of loop-scoped `let`s. Behaviour is unchanged — 43 existing
flow-runner/conformance tests stay green and 2 new seam tests were added. The
`unifier` node remains a DAG marker (runUnifier still runs inside the dev-loop);
extracting it into an independently-dispatchable executor is the next M8-0 step.

## Amendment (M8-0, 2026-06-14): unifier is a real node

The node-executor registry (above) left one node a marker: the `unifier` ran
*inside* `runDeveloperLoop` and `execUnifier` only logged. This amendment makes
it a real, independently-dispatchable executor — completing ADR-028's promise
that every flow node is its own dispatch.

- **`runDeveloperLoop` → per-WI only** (returns `void`). The unifier tail
  (resume branch-push → `runUnifier` → `assertDevLoopCloseSync` →
  `emitDeliverySummary`) moved into a new exported `runUnifierPhase` in
  developer-loop.ts. `runUnifierPhase` emits its own `unifier-phase.start`
  boundary event (parent for the unifier's child events; lights the unifier hex).
- **`execUnifier`** runs `runUnifierPhase` (its own wedge detector) then the
  close-contract gates (items 4-8: commit boundary, close invariant, unifier
  delivery gate, non-empty guard, final CI). The combined order is byte-for-byte
  the pre-refactor sequence.
- **Resume** (`resumeFrom: 'unifier'`): the dev node still runs but self-no-ops
  the per-WI work (`toRun=[]`) and emits its start/end{resumed:true} events; the
  unifier node is the resume target. `execDev` does NOT short-circuit — doing so
  dropped the dev-loop phase-boundary events and left the dev hex stuck `active`
  on a resume cycle (caught by adversarial review before merge).

Verified by a 4-lens adversarial review (order / resume / blast-radius / events)
which found and fixed the resume event-emission regression. Full suite 1122 green.
