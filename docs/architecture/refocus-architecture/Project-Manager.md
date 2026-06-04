# Project Manager

> **Intent.** The autonomous phase that performs forge's **single decomposition**: it
> decomposes the initiative body's GWT ACs directly into **right-sized, outcome-defined
> work items** arranged in a dependency DAG so independent work can run in parallel.
>
> **Type:** autonomous (never asks the operator; infers and proceeds).
> **Realized via:** one SDK agent invocation
> ([orchestrator/phases/project-manager.ts](orchestrator/phases/project-manager.ts) +
> [orchestrator/pm-invocation.ts](orchestrator/pm-invocation.ts)) composing
> [skills/project-manager/SKILL.md](skills/project-manager/SKILL.md).

## Responsibilities

1. **Own all work-item sizing and gate selection** (locked decision). The architect hands
   down an initiative with GWT acceptance criteria; the PM is the *one* place that
   decomposes those ACs into outcome-sized WIs (no intermediate feature list).
2. Size each WI by its **verifiable outcome**, not by a file list — every WI ships with a
   single runnable `quality_gate_cmd` that fails on a clean tree and passes only when the
   acceptance criteria are met. *(Research: PR-count, not file-count, predicts difficulty;
   a WI that needs >1 PR is over-scoped.)*
3. Build the **dependency DAG**: any WI that produces an interface (type, API, schema) or
   owns a **hotspot file** (routes, config, registries) is a predecessor of its consumers,
   so parallel siblings never collide at merge.
4. Stay bound to the architect's initiative body (invent no new scope, drop none) and
   reconcile `files_in_scope` against the real worktree so paths are not hallucinated.
5. Read the cycle brain + the project's Brain 3 first (planner brain-first mandate).

## Inputs → Outputs

**Consumes:** `_queue/in-flight/<id>.md` (the manifest body: vision + GWT ACs + budgets);
the project worktree at HEAD; brain themes; a language-detected gate recipe.
**Produces:** `<worktree>/.forge/work-items/WI-*.md` (ADR 015 schema), `_graph.md`
(dependency view), `_decomposition.md` (AC→WI telemetry); PM phase events.

## Relationships

- **Upstream:** [Architect](docs/architecture/refocus-architecture/Architect.md) (coarse features) via the queue + [Orchestrator](docs/architecture/refocus-architecture/Orchestrator.md).
- **Downstream:** [Developer Loop](docs/architecture/refocus-architecture/Developer-Loop.md) reads the WIs in topological order; the unifier reads them for final assembly; the UI renders the WI hexes.
- **Reads:** Brain 2 (cycle patterns) + Brain 3 (project). **Composes skill:** `project-manager`.

## Boundaries (what this is NOT)

- Not a scope inventor — the initiative body is the *only* source of scope; the PM maps
  ACs to WIs and is the **sole** WI-sizer.
- Not interactive — fully unattended.
- Not the executor — it specifies outcomes + gates; the dev-loop implements.

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- ~~**[PM-1 · high]**~~ ✓ Resolved 2026-06-04: the architect no longer emits a `features[]`
  list; the PM decomposes the initiative's ACs directly into WIs (pairs with ARCH-3).
  `skills/project-manager/SKILL.md` should be updated to reflect direct-AC decomposition.
- **[PM-2 · high]** The user prompt is ~157 lines vs a 4-line intent: the gate rule is
  stated three times, hidden-coupling twice, and named past incidents are re-litigated
  inline. Collapse to point-at-the-validator; move war-stories to brain themes.
- **[PM-3 · med]** `files_in_scope` is contradictory — SKILL says advisory, the validator
  hard-rejects and the hidden-coupling check can fail the cycle. Resolve: keep
  **file-ownership of hotspot files** as the enforced merge-safety rule (research-backed),
  make non-hotspot scope advisory; reconcile the prose.
- **[PM-4 · med]** Dead exploration-mode branch (`detectManifestType` reads a `type` field
  the manifest schema lacks) + stale bench "single source of truth" headers (benchmarks/
  removed) + stale numeric "sizing band" in the phase doc (code removed 2026-05-25).
- **[PM-5 · low]** Dead telemetry/stubs: `bashCalls` counter (Bash disallowed),
  `requiredVerificationPaths` returns `[]` yet is still called by the dev-loop.
- **[PM-6 · med]** Not on the `PhaseAgentSpec` seam (hard-coded `PM_MODEL`, inline prompt)
  — see [Skill-Model.md](docs/architecture/refocus-architecture/Skill-Model.md).
