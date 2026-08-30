# SPEC — the six contracts

Forge is a construction platform for agentic software factories. Six seams carry
everything it does; everything else is machinery in service of one of them.

This file states each seam as a contract: what the thing IS, what is guaranteed
about it, and what is forbidden. Each contract is transcribed from the ADR that
ratified the seam — the ADR carries the argument, this file carries the
obligation — and each ends by naming the test that holds it.

A contract here is binding on every package. A change to one is an ADR
amendment, not an edit to this file.

| # | Seam | Ratifying ADRs | Owner package |
|---|---|---|---|
| 1 | [Agent](#1-agent) | [024](docs/decisions/024-phases-as-subagents-invoking-skills.md), [003](docs/decisions/003-skills-not-self-baked-agents.md), [039](docs/decisions/039-ships-as-artifact.md) | `@forge/agents` |
| 2 | [Station](#2-station) | [028](docs/decisions/028-flow-engine.md), [036](docs/decisions/036-orchestrator-owned-gate-execution.md) | `@forge/flows` |
| 3 | [Artifact](#3-artifact) | [007](docs/decisions/007-markdown-artifact-flow.md), [008](docs/decisions/008-jsonl-event-log.md) | `@forge/kernel` |
| 4 | [Knowledge](#4-knowledge) | [018](docs/decisions/018-three-brain-model.md), [010](docs/decisions/010-brain-first.md), [035](docs/decisions/035-forge-owned-central-artifacts.md) | `@forge/knowledge` |
| 5 | [Session](#5-session) | [043](docs/decisions/043-generic-interactive-surface.md), [027](docs/decisions/027-studio-object-model.md) | `@forge/sessions` |
| 6 | [Project](#6-project) | [017](docs/decisions/017-forge-project-contract.md), [034](docs/decisions/034-studio-aligned-contract.md) | `@forge/projects` |

---

## 1. Agent

**An agent is a definition, not a code path.** A `SKILL.md` — persona, model
tier, and the allow-list of skills and tools it may use — IS the agent
([ADR 024](docs/decisions/024-phases-as-subagents-invoking-skills.md) §1). The
platform bakes execution machinery only: executors, gates, budgets, guards.

### Guarantees

- **One primitive runs every agent.** `runAgent` spawns from the definition.
  There is no privileged agent: an agent forge ships is Scope-2 data on the
  Scope-1 primitive, identical in kind to one an operator authors
  ([ADR 039](docs/decisions/039-ships-as-artifact.md) §1).
- **Fresh context per spawn.** An agent inherits neither its caller's reasoning
  nor a prior agent's (ADR 024 §2). The caller binds the run — which worktree,
  which run id, which artifacts — and composes no prompt.
- **Dispatch is by declared data.** `runtime.loopStrategy` selects the execution
  path (`one-shot` → a single stream call; `ralph` → the iterate-until-done
  loop). The two strategies are two code paths chosen by a declared field, never
  by which agent it happens to be (ADR 039 §2).
- **Budgets are declared numbers.** `budgets.maxTurns`, `maxBudgetUsd`,
  `maxBudgetUsdShare`, `wedgeKillMs` resolve generically. A cost cap is never a
  constant hand-coded per agent (ADR 039 §2).
- **Capabilities are composed, not restated.** Shared capabilities are skills the
  agent invokes; a capability lives in one skill, not once per agent (ADR 024 §1).
- **Guards are a closed vocabulary.** `composition.guards` resolves against a
  frozen set; an unknown guard is rejected naming the offending value and the
  allowed set.

### Forbidden

- Special-casing an agent by name or slug anywhere outside `@forge/factory`. A
  phase still special-cased by name is a migration not yet done, not an
  exception (ADR 039 §1).
- Authoring prompt intent outside the agent definition.
- A spawn that emits no structured event to the JSONL event log.

**enforced by: `packages/agents/contract.test.ts`**

---

## 2. Station

**A station is a node in a flow definition, executed by a runner that knows
nothing about which agent it is running.** `FlowDefinition` is data; the runner
interprets it ([ADR 028](docs/decisions/028-flow-engine.md) §1).

### Guarantees

- **Three node kinds, no more.** `static` (spawn the node's agent, verify its
  gate), `fanOut` (multiplicity resolved at runtime from a named upstream
  artifact, one worktree per item, `depends_on` DAG respected), `gate` (park the
  run, surface the artifact, wait on the verdict endpoint) — ADR 028 §1.
- **The runner holds the port, not the phases.** A station is executed through
  `PhaseExecutor { run(nodeId, ctx) → CycleOutcome }`. The runner imports no
  phase (`1.0.md` §4 M2 Lane B).
- **A run is derived, never stored.** The run view is aggregated from queue
  state, manifest, `events.jsonl` and the artifacts directory. Read-only; there
  is no second write path for run state (ADR 028 §3).
- **Budgets and safety live in the runner.** Flow `costCeilingUsd` warns at 70%
  and stops at a clean node boundary at 100%, never mid-write. Per-node
  `wedgeKillMs` kills through a concurrent timer, emits `phase.wedge-killed`, and
  classifies the node resumable (ADR 028 §4).
- **Gates are server-verified.** Approval and send-back arrive through the gate
  endpoint. **No auto-approve code path exists** (ADR 028 §9).
- **Definitions are immutable while running.** A flow with in-flight runs is
  read-only; saving creates version *n+1*, used by new runs only. The runtime
  never modifies a definition (ADR 028 §6).
- **A claim refuses** a project that is not contract-ready, an invalid or locked
  flow, or a zero-gate non-disposable flow (ADR 028 §8).

### Forbidden

- A hardcoded station sequence beside the flow engine. No parallel old and new
  implementations survive a cutover (ADR 028 §2).
- A gate that reports no checks counting as a pass. Never merge on absence of red.
- Resuming a node not flagged `resumable`.

**enforced by: `packages/flows/contract.test.ts`**

---

## 3. Artifact

**Every piece of inter-station data is markdown with YAML frontmatter, in a known
location, greppable** ([ADR 007](docs/decisions/007-markdown-artifact-flow.md)).
The event log is its machine-readable twin
([ADR 008](docs/decisions/008-jsonl-event-log.md)).

### Guarantees

- **One shape.** Markdown body plus optional YAML frontmatter declaring type,
  owner, dependencies and status. Frontmatter is parsed with one library; an
  artifact is emitted by a direct file write (ADR 007).
- **One location per kind.** Project artifacts live in the project's repo, run
  state under `_queue/`, durable knowledge under `brain/`. A reader finds an
  artifact by its kind, never by search (ADR 007).
- **Human-editable at every boundary.** The operator can intervene by editing the
  file. An artifact format a human cannot edit is not an artifact (ADR 007).
- **Greppable.** `grep -r 'work_item_id: WI-42'` is a supported way to find one.
  A binary, a database row and a JSON blob nobody can read are all failures of
  this clause.
- **Every station transition emits a JSONL event** carrying the flow-node id in
  its `phase` field (ADR 008; ADR 028 §3 widens the enum to string).
- **Cost is computed in one place.** One rule turns stream usage into a cost;
  no second cost arithmetic exists anywhere.

### Forbidden

- An artifact that is not greppable markdown.
- A skill invocation that logs no structured event to the JSONL event log.
- A second source of truth for a run's state beside the derived view.

**enforced by: `packages/kernel/contract.test.ts`**

---

## 4. Knowledge

**Knowledge is three scoped graphs of markdown themes, read before planning and
written only by reflection** ([ADR 018](docs/decisions/018-three-brain-model.md),
[ADR 010](docs/decisions/010-brain-first.md)).

### Guarantees

- **Three scopes, fixed.** Brain 1 `brain/forge-dev/` (forge engineering) ·
  Brain 2 `brain/cycles/` (cross-cycle patterns, archives under `_raw/`) ·
  Brain 3 `brain/projects/<name>/themes/` — per project, held centrally in the
  forge repo ([ADR 035](docs/decisions/035-forge-owned-central-artifacts.md)
  reverses ADR 018's location, not its scoping).
- **Planners and reflectors read first.** A planner or reflector that does not
  query the brain before producing its plan must not ship (ADR 010 as amended).
- **Dev-loop and reviewer do not read Brains 1 and 2.** The planner has already
  encoded every relevant convention into the work items, which are the single
  source of intent. Brain 3 is advisory to them.
- **A theme is markdown with a frontmatter contract** — the same artifact shape
  as §3, with keywords and related-theme links that keep the graph connected.
- **One backend seam.** Every read and write of a knowledge base goes through
  `KbBackend`. A read path that bypasses it is a defect, not an optimisation.
- **Never deleted.** Knowledge is superseded by a `status: historical` marker,
  never removed.

### Forbidden

- A planner or reflector skill that ships without a brain read.
- A knowledge write from anywhere but reflection or an operator-driven drain.
- A second knowledge store beside the three graphs.

**enforced by: `packages/knowledge/contract.test.ts`**

---

## 5. Session

**A session is an interactive surface authored as data and driven by one generic
runner** ([ADR 043](docs/decisions/043-generic-interactive-surface.md)).

### Guarantees

- **One descriptor, one runner.** A session kind is a row of yaml — id, agent,
  title, stages, artifact kind, and a `turnSpec` phase table. `runInteractiveTurn`
  reads `status.phase`, looks up the phase row, runs the declared step, and
  advances to `next`. There is no per-kind runner (ADR 043 §§1–2).
- **Closed vocabularies with total lookups.** `style`, `step`, finalizer id and
  schema id each resolve against a deep-frozen vocabulary; an unknown value is
  rejected naming the offending value **and** the allowed set (ADR 043 §1).
- **Loading is structural; validation is semantic.** `loadSessionKinds` parses
  and validates nothing semantic; all semantic enforcement lives in
  `validateSessionKinds` (ADR 043 §1).
- **Affordances are derived, never authored.** A structured interview phase
  yields a question form; an `awaiting-*` phase yields a verdict affordance; a
  staging `writes:` yields a staged-file review. One authored field; the surface
  falls out of it (ADR 043 §1).
- **One containment root per kind.** `turnSpec.kindDir` is the single containment
  segment; every write resolves under it and a path that escapes it is refused
  (ADR 043 §1).
- **A transcript is an artifact.** It obeys §3.

### Forbidden

- A bespoke runner for a new interactive kind. A new kind is a yaml row.
- An affordance authored per kind instead of derived from the phase table.
- A finalizer that writes outside its kind's containment root.

**enforced by: `packages/sessions/contract.test.ts`**

---

## 6. Project

**A project earns unattended development by satisfying a written, checkable
contract** ([ADR 017](docs/decisions/017-forge-project-contract.md),
[ADR 034](docs/decisions/034-studio-aligned-contract.md)).

### Guarantees

- **Two faces, one verdict.** Face A is the authoring object — north star,
  instructions, demo process, bound skills, bound knowledge. Face B is the
  operational preflight — the C-clauses. A project is flow-ready only when both
  pass; readiness is one boolean, computed in one place (ADR 034 §1).
- **Hard clauses decline, advisory clauses warn.** A hard clause failure makes
  forge refuse the run, naming the clause. An advisory clause never flips the
  verdict, because its check is heuristic, unprovable by inspection, or owned by
  forge rather than the project (ADR 017).
- **The preflight is pure.** `runPreflight()` returns a structured report; the
  caller renders it, writes a `preflight.verdict` event, and sets the exit code —
  so an unattended caller can gate on it (ADR 017).
- **Checks use git truth, not file text.** Scratch hygiene is checked with
  `git ls-files` and `git check-ignore`, because a `.gitignore` entry is a no-op
  on an already-tracked file (ADR 017 C2).
- **The gate is structural, never executed.** The preflight asserts a quality-gate
  command exists and is plausibly fast; it does not run it (ADR 017 C1).
- **Flows reach the preflight through a port.** `ProjectGate { runPreflight }` is
  injected; a flow does not import the project package (`1.0.md` §4 M2 Lane B).

### Forbidden

- Starting a run for a project whose hard clauses fail.
- A readiness signal computed in a second place, or surfaced without being
  enforced.
- Auto-generating the operator's agent-instruction file. The clause requires a
  human-authored file's presence and nothing else (ADR 017 C8).

**enforced by: `packages/projects/contract.test.ts`**
