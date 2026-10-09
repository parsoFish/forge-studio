# SPEC — the six contracts

Forge is a construction platform for agentic software factories. Six seams carry
everything it does; everything else is machinery in service of one of them.

This file states each seam as a contract: what the thing IS, what is guaranteed
about it, and what is forbidden. Each contract ends by naming the tests that
hold it; a clause no test holds is marked `review`. Decisions that are not seam
contracts live in [DECISIONS.md](./DECISIONS.md).

A contract here is binding on every package. A change that conflicts with one
updates this file in the same PR as the code, with the operator's approval.

| # | Seam | Owner package |
|---|---|---|
| 1 | [Agent](#1-agent) | `@forge/agents` |
| 2 | [Station](#2-station) | `@forge/flows` |
| 3 | [Artifact](#3-artifact) | `@forge/kernel` |
| 4 | [Knowledge](#4-knowledge) | `@forge/knowledge` |
| 5 | [Session](#5-session) | `@forge/sessions` |
| 6 | [Project](#6-project) | `@forge/projects` |

---

## 1. Agent

**An agent is a definition, not a code path.** A `SKILL.md` — persona, model
tier, and the allow-list of skills and tools it may use — IS the agent
. The
platform bakes execution machinery only: executors, gates, budgets, guards.

### Guarantees

- **One primitive runs every agent.** `runAgent` spawns from the definition.
  There is no privileged agent: an agent forge ships is Scope-2 data on the
  Scope-1 primitive, identical in kind to one an operator authors
 .
- **Fresh context per spawn.** An agent inherits neither its caller's reasoning
  nor a prior agent's. The caller binds the run — which worktree,
  which run id, which artifacts — and composes no prompt.
- **Dispatch is by declared data.** `runtime.loopStrategy` selects the execution
  path (`one-shot` → a single stream call; `ralph` → the iterate-until-done
  loop). The two strategies are two code paths chosen by a declared field, never
  by which agent it happens to be.
- **Budgets are declared numbers.** `budgets.maxTurns`, `maxBudgetUsd`,
  `maxBudgetUsdShare`, `wedgeKillMs` resolve generically. A cost cap is never a
  constant hand-coded per agent.
- **Capabilities are composed, not restated.** Shared capabilities are skills the
  agent invokes; a capability lives in one skill, not once per agent.
- **The runtime is swappable.** Spawns go through the pinned SDK query or the
  runtime-adapter registry, and every adapter passes the conformance suite.
- **Every spawn site honours bound hooks.** A file that can spawn an agent wires
  hook dispatch or carries a named exemption; a hook bound to an agent is never
  shown as carried while it cannot fire.
- **Guards are a closed vocabulary.** `composition.guards` resolves against a
  frozen set; an unknown guard is rejected naming the offending value and the
  allowed set.

### Forbidden

- Special-casing an agent by name or slug anywhere outside `@forge/factory`. A
  phase still special-cased by name is a migration not yet done, not an
  exception.
- Authoring prompt intent outside the agent definition.
- A spawn that emits no structured event to the JSONL event log.

**enforced by:** `packages/agents/tests/contract/pinned-sdk-query.enforce.test.ts` ·
`packages/agents/tests/contract/conformance.test.ts` ·
`packages/agents/tests/contract/hook-dispatch-coverage.test.ts` ·
`packages/agents/tests/contract/skill-md-fidelity.test.ts` ·
`packages/stations/tests/contract/band-def-generalisation.test.ts`; prompt intent
outside the definition and per-name special-casing: `review`.

---

## 2. Station

**A station is a node in a flow definition, executed by a runner that knows
nothing about which agent it is running.** `FlowDefinition` is data; the runner
interprets it.

### Guarantees

- **Three node kinds, no more.** `static` (spawn the node's agent, verify its
  gate), `fanOut` (multiplicity resolved at runtime from a named upstream
  artifact, one worktree per item, `depends_on` DAG respected), `gate` (park the
  run, surface the artifact, wait on the verdict endpoint).
- **The runner holds the port, not the phases.** A station is executed through
  `PhaseExecutor { run(nodeId, ctx) → CycleOutcome }`. The runner imports no
  phase; overrides are injected through `createPhaseExecutor({ overrides })`.
- **A run is derived, never stored.** The run view is aggregated from queue
  state, manifest, `events.jsonl` and the artifacts directory. Read-only; there
  is no second write path for run state.
- **Budgets and safety live in the runner.** Flow `costCeilingUsd` warns at 70%
  and stops at a clean node boundary at 100%, never mid-write. Per-node
  `wedgeKillMs` kills through a concurrent timer, emits `phase.wedge-killed`, and
  classifies the node resumable.
- **Gates are server-verified.** Approval and send-back arrive through the gate
  endpoint. **No auto-approve code path exists**.
- **Definitions are immutable while running.** A flow with in-flight runs is
  read-only; saving creates version *n+1*, used by new runs only. The runtime
  never modifies a definition.
- **A claim refuses** a project that is not contract-ready, an invalid or locked
  flow, or a zero-gate non-disposable flow.

### Forbidden

- A hardcoded station sequence beside the flow engine. No parallel old and new
  implementations survive a cutover.
- A gate that reports no checks counting as a pass. Never merge on absence of red.
- Resuming a node not flagged `resumable`.

**enforced by:** `packages/flows/tests/integration/claim-validator.test.ts` ·
`packages/flows/tests/unit/cost-ceiling-binds.test.ts` ·
`packages/flows/tests/unit/flow-budgets.test.ts`; no auto-approve path, definition
immutability and the three node kinds: `review`.

---

## 3. Artifact

**Every piece of inter-station data is markdown with YAML frontmatter, in a known
location, greppable**.
The event log is its machine-readable twin
.

### Guarantees

- **One shape.** Markdown body plus optional YAML frontmatter declaring type,
  owner, dependencies and status. Frontmatter is parsed with one library; an
  artifact is emitted by a direct file write.
- **One location per kind.** Project artifacts live in the project's repo, run
  state under `_queue/`, durable knowledge under `brain/`. A reader finds an
  artifact by its kind, never by search.
- **Human-editable at every boundary.** The operator can intervene by editing the
  file. An artifact format a human cannot edit is not an artifact.
- **Greppable.** `grep -r 'work_item_id: WI-42'` is a supported way to find one.
  A binary, a database row and a JSON blob nobody can read are all failures of
  this clause.
- **Every station transition emits a JSONL event** carrying the flow-node id in
  its `phase` field.
- **A work item is markdown with validated frontmatter.** Its id matches the one
  `WORK_ITEM_ID_PATTERN` in `@forge/contracts`; it carries at least one
  acceptance criterion and at least one worktree-relative `files_in_scope`, and
  `depends_on` is acyclic. A second copy of the id pattern is a defect.
- **Acceptance criteria are typed.** They are `{given, when, then}` frontmatter
  shared by every reader; a criterion that does not parse is an error, never an
  absence.
- **Cost is computed in one place.** One rule turns stream usage into a cost;
  no second cost arithmetic exists anywhere.

### Forbidden

- An artifact that is not greppable markdown.
- A skill invocation that logs no structured event to the JSONL event log.
- A second source of truth for a run's state beside the derived view.

**enforced by:** `packages/kernel/tests/unit/logging.test.ts` ·
`packages/flows/tests/integration/work-item.test.ts` ·
`packages/sessions/tests/unit/architect-plan.test.ts`; greppability and one cost
rule: `review`.

---

## 4. Knowledge

**Knowledge is three scoped graphs of markdown themes, read before planning and
written only by reflection**.

### Guarantees

- **Three scopes, fixed.** Brain 1 `brain/forge-dev/` (forge engineering) ·
  Brain 2 `brain/cycles/` (cross-cycle patterns, archives under `_raw/`) ·
  Brain 3 `brain/projects/<name>/themes/` — per project, held centrally in the
  forge repo.
- **Planners and reflectors read first.** A planner or reflector that does not
  query the brain before producing its plan must not ship.
- **Dev-loop and reviewer do not read Brains 1 and 2.** The planner has already
  encoded every relevant convention into the work items, which are the single
  source of intent. Brain 3 is advisory to them.
- **Reviewer grants are band-scoped.** A non-project knowledge base reaches the
  reviewer only through a `review-band` flow binding, and never reaches the
  dev-loop. Ingest happens only through reflection; Studio sessions edit a
  knowledge base's structure, never ingest into it.
- **A theme is markdown with a frontmatter contract** — the same artifact shape
  as §3, with keywords and related-theme links that keep the graph connected.
- **One backend seam.** Every **per-knowledge-base** read and write goes through
  `KbBackend`. A per-KB read path that bypasses it is a defect, not an
  optimisation. Cross-brain navigation (`loadBrainIndex`, the planner's index
  prefix) sits **above** the seam and is not bound to a single backend.
- **Never deleted.** Knowledge is superseded by a `status: historical` marker,
  never removed.

### Forbidden

- A planner or reflector skill that ships without a brain read.
- A knowledge write from anywhere but reflection or an operator-driven drain.
- A second knowledge store beside the three graphs.

**enforced by:** `packages/knowledge/tests/regression/kb-read-policy-guard.test.ts` ·
`packages/knowledge/tests/contract/kb-backend-conformance.test.ts` ·
`packages/sessions/tests/contract/no-direct-brain-dir-resolution.test.ts` ·
`packages/knowledge/tests/unit/brain-paths.test.ts` ·
`scripts/check-kb-ingest-affordance.mjs`; planner and reflector brain reads: `review`.

---

## 5. Session

**A session is an interactive surface authored as data and driven by one generic
runner**.

### Guarantees

- **One descriptor, one runner.** A session kind is a row of yaml — id, agent,
  title, stages, artifact kind, and a `turnSpec` phase table. `runInteractiveTurn`
  reads `status.phase`, looks up the phase row, runs the declared step, and
  advances to `next`. There is no per-kind runner.
- **Closed vocabularies with total lookups.** `style`, `step`, finalizer id and
  schema id each resolve against a deep-frozen vocabulary; an unknown value is
  rejected naming the offending value **and** the allowed set.
- **Loading is structural; validation is semantic.** `loadSessionKinds` parses
  and validates nothing semantic; all semantic enforcement lives in
  `validateSessionKinds`.
- **Affordances are derived, never authored.** A structured interview phase
  yields a question form; an `awaiting-*` phase yields a verdict affordance; a
  staging `writes:` yields a staged-file review. One authored field; the surface
  falls out of it.
- **One containment root per kind.** `turnSpec.kindDir` is the single containment
  segment; every write resolves under it and a path that escapes it is refused
 .
- **`cancelled` is sticky.** It is the one reserved terminal phase every kind
  shares; no status write moves a cancelled session to another phase.
- **A transcript is an artifact.** It obeys §3.

### Forbidden

- A bespoke runner for a new interactive kind. A new kind is a yaml row.
- An affordance authored per kind instead of derived from the phase table.
- A finalizer that writes outside its kind's containment root.

**enforced by:** `packages/sessions/tests/contract/session-kinds-vocab.test.ts` ·
`packages/sessions/tests/contract/session-kinds-affordances.test.ts` ·
`packages/sessions/tests/contract/session-kinds-containment.test.ts` ·
`packages/sessions/tests/regression/session-kinds-kinddir-kernel-predicate.test.ts` ·
`packages/sessions/tests/regression/interactive-session-cancel-sticky.test.ts`.

---

## 6. Project

**A project earns unattended development by satisfying a written, checkable
contract**.

### Guarantees

- **Two faces, one verdict, computed in one place.** Face A is the authoring
  object — north star, instructions, demo process, bound skills, bound
  knowledge. Face B is the operational preflight — the C-clauses. Readiness is
  one function, `projectReadiness` (`@forge/contracts`): Studio renders its
  verdict and the claim gate refuses on the same call over the definition the
  bridge serves Studio, so a project Studio shows as not ready cannot be
  claimed, and the refusal names each failing field or hard clause. The claim
  additionally requires the runnable-gate clause DEPS, which Studio shows
  beside the verdict.
- **The hard set is C1 (gate command), C2 (scratch hygiene), C4 (architecture
  context), DEPS and SKILLS.** Every other clause is advisory.
- **Hard clauses decline, advisory clauses warn.** A hard clause failure makes
  forge refuse the run, naming the clause. An advisory clause never flips the
  verdict, because its check is heuristic, unprovable by inspection, or owned by
  forge rather than the project.
- **The preflight is pure.** `runPreflight()` returns a structured report; the
  caller renders it, writes a `preflight.verdict` event, and sets the exit code —
  so an unattended caller can gate on it.
- **Checks use git truth, not file text.** Scratch hygiene is checked with
  `git ls-files` and `git check-ignore`, because a `.gitignore` entry is a no-op
  on an already-tracked file.
- **The gate is structural, never executed.** The preflight asserts a quality-gate
  command exists and is plausibly fast; it does not run it.
- **Flows reach the preflight through a port.** `ProjectGate { runPreflight }` is
  injected; a flow does not import the project package. Exactly one production
  caller wires the real preflight; the orchestrator runs the gate and the agent
  never certifies its own result (DECISIONS D-15).

### Forbidden

- Starting a run for a project whose hard clauses fail.
- A readiness signal computed in a second place.
- Auto-generating the operator's agent-instruction file. The clause requires a
  human-authored file's presence and nothing else.

**enforced by:** `packages/projects/tests/integration/preflight-gate.test.ts` ·
`packages/projects/tests/integration/preflight-repo.test.ts` ·
`packages/projects/tests/integration/preflight-instructions.test.ts` ·
`packages/flows/tests/contract/readiness-one-function.test.ts` ·
`packages/flows/tests/integration/claim-validator-readiness.test.ts`.
