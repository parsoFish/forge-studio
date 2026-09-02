# `@forge/projects` — design

## Two faces, one verdict

[ADR 017](../../docs/decisions/017-forge-project-contract.md) derived C1–C6 from the
trafficGame arc: a project earns unattended development only by satisfying a
written, checkable set of preflight clauses. [ADR 034](../../docs/decisions/034-studio-aligned-contract.md)
found the contract living in two places that could disagree — `forge preflight`
checking the filesystem, and Studio's `ContractReadiness` panel checking five
object fields independently — and unified them into **one verdict, two faces**:
Face A is the authoring object (`northStar`, `instructions`, `demoProcess`,
`skills`, `kb`), Face B is the operational preflight (the C-clauses,
[`docs/forge-project-contract.md`](../../docs/forge-project-contract.md) C1–C10).
`project-config.ts` owns Face A's shape and validation; `preflight.ts` and its
seven `preflight-*.ts` clause modules own Face B. Both read the same
`.forge/project.json`, computed in one place, so "is this project ready?" has one
answer.

Hard clauses (C1, C2, C4, C7 when acceptance testing is required) decline the run
and name themselves; advisory clauses (C5, C6, C8–C10) warn without flipping the
verdict, because their check is heuristic or owned by forge rather than provable
by inspection (ADR 017). `runPreflight()` is pure — it returns a structured
report; `formatPreflightReport`/`buildVerdictEvent` render it and the caller
writes the event and sets the exit code, so an unattended caller can gate on it.
`contract-compliance-loop.ts`'s `runContractComplianceLoop` is the bounded,
deterministic convergence loop the onboarding agent drives a project through —
`runPreflight` → apply the AUTO-tier fixers → re-check → repeat — with the
authoritative "contract-green" signal always `runPreflight().ok`, computed here,
never an agent's self-report.

## Config lives in the project's own repo

[ADR 035](../../docs/decisions/035-forge-owned-central-artifacts.md) centralised
Brain 3 and development history into the forge repo, but its 2026-06-23 amendment
reversed the equivalent move for the contract itself: *"`.forge/project.json` is
the contract source (not a thin pointer to a central SSOT)."* `loadProjectConfig`
therefore reads `<projectRoot>/.forge/project.json` out of the **managed
project's own tree**, resolved through `@forge/kernel`'s `resolveProjectsDir` —
the seam [ADR 045](../../docs/decisions/045-operator-workspace-and-promotion.md)
designs the operator-workspace root for. This package does not implement that
promotion path; it consumes whatever root kernel resolves, which is why a project
onboarded under an operator workspace and one onboarded under the classic layout
look identical to everything in this package.

## The gate is structural, never executed, and reached through a port

SPEC.md §6: *"The gate is structural, never executed"* — `preflight.ts` asserts a
quality-gate command exists and is plausibly fast; it never runs it. And:
*"Flows reach the preflight through a port... a flow does not import the project
package."* [ADR 036](../../docs/decisions/036-orchestrator-owned-gate-execution.md),
amended 2026-08-31, records why this is an **injected dependency** rather than a
direct import: `orchestrator/flow-runner.ts` holds only the `ProjectGate { runPreflight }`
port (`@forge/kernel`); `orchestrator/phases/executor-deps.ts`'s
`createProjectGate()` is the one production wiring point that imports this
package's real `runPreflight` and hands it in. The ADR's earlier, stronger claim —
that the *absence* of an injection seam is what makes the gate unfakeable — did
not survive: a conformance test now injects a gate that always returns `ok: true`
to prove the port is real. What replaces it is narrower and true: exactly one
production caller wires the real preflight, and a test fails if the flow runner
ever re-imports it directly.

## Routes: the same injected-dependency shape, for the same reason

`routes.ts`'s `ProjectsRouteDeps` repeats this pattern for HTTP. Nine of this
package's sixteen carved routes need `seedProjectBrain` (`@forge/knowledge`),
`isContainedProjectRepoPath` (`@forge/flows`), `agentCapabilityDescriptor`
(`@forge/agents`), and legacy registry/spawn helpers — every one of them a
package `projects` (rank 2) may not import. The allow-graph
([ADR 046](../../docs/decisions/046-package-layout-and-boundary-lint.md)) ranks
`contracts ← kernel ← {library, knowledge, projects} ← agents ← sessions ← flows
← factory ← apps`; `knowledge` sits at the **same** rank as `projects` (siblings
must not know about each other), and `flows`/`agents` sit strictly above. Worse,
`scripts/check-boundaries.mjs` runs dependency-cruiser with
`tsPreCompilationDeps: true`, so even a **type-only** import of one of those
packages' types mints the identical `package-layer-order` violation a value
import would — there is no "just the type" escape hatch. `ProjectsRouteDeps`
therefore declares every one of its nine dependencies as an inline **structural**
function type, never as `import type` of the real implementation's own type.
`projectsRoutes(deps)` takes them as parameters; `apps/forge/routes.ts` — which
sits above every package and may import all of them freely — is the one
assembly point that supplies the real implementations, as an inline object
literal (not by naming `ProjectsRouteDeps`, which is why that type stays off the
public door: its only consumer today is this package's own contract test).

## What this package deliberately does not own

**Two flows-domain routes.** `GET /api/studio/projects/attention` and
`GET /api/studio/projects/:id/roadmap` read `@forge/flows` (queue, manifest,
scheduler, work-item, run-list-cache) through their handlers
(`buildProjectAttention` → `scanProjectManifests`, `buildProjectRoadmap`) — a
strictly higher rank than `projects`. Carving them here would mint a new
`package-layer-order` violation with no baseline to absorb it (the baseline is a
shrink-only ratchet; there is no `--write-baseline`). Both routes stay,
unchanged, in `cli/bridge-studio.ts`'s legacy dispatcher, and were handed to the
M4-flows lane rather than carved into a package not allowed to hold them.

**`preflight-fix-runner.ts`'s session half.** The interactive, agent-driven side
of the auto-fix loop is a **sessions kind** ([ADR 043](../../docs/decisions/043-generic-interactive-surface.md))
and lives in `packages/sessions/preflight-fix-runner.ts`, which deep-imports this
package's `runPreflight`, `ClauseId`, `ensureStudioBranch` and
`commitStudioChange` — a legal direction, since `sessions` (rank 4) sits above
`projects` (rank 2). This package owns only the deterministic half:
`contract-compliance-loop.ts`'s bounded convergence loop and the AUTO-tier
fixers it calls (`preflight-fix-auto.ts`). It has no interactive surface of its
own and mints none.

**The sessions-bound rows.** `demo-builder-runner.ts` and `instructions-runner.ts`
(also `packages/sessions`) hold their own session lifecycles but write through
this package's repo-transaction primitives (`ensureStudioBranch`,
`commitStudioChange`, `withStudioWrite`) rather than duplicating git plumbing —
the same rank-4-imports-rank-2 direction as the preflight-fix session half.

## Constraint blocks: read here, compiled elsewhere

`constraint-blocks.ts` parses a project's machine-readable constraint clauses
(`<!-- forge:constraint id: … applies_to: … -->`, [ADR 037](../../docs/decisions/037-compiled-wi-contracts.md))
and selector-matches them against a work item. `packages/flows/phases/wi-spec-compile.ts`
(rank 5) is the one caller that compiles matched clauses into a WI body — a legal
higher-rank import, and the reason `loadProjectConstraintBlocks` and
`selectorMatches` are on this package's public door rather than only its own
`constraint-author.ts` (which authors the source blocks, not their downstream
compilation).

## Contract stages import a sessions type, and it is already baselined

`contract-stages.ts` re-exports `ContractStageRow`/`ContractStageStatus` from
`@forge/sessions/studio/session-transcript.ts` — a rank-4 import from a rank-2
package, forbidden by the same rule §2 above states. This is a pre-existing,
baselined `package-layer-order` violation (`scripts/baselines/boundaries.json`),
not introduced by this PR and not fixed by it: fixing it means moving the type
down to `kernel` or `contracts`, a change to `contract-stages.ts`'s own imports
this exit row does not authorize. It is recorded here so the door's shape is not
mistaken for endorsement.
