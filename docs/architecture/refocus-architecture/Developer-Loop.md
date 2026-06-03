# Developer Loop

> **Intent.** The autonomous developer experience: a **Ralph loop** that takes each work
> item the PM produced and drives it to completion via brute-repetition-with-memory over
> an SDK agent, until an **orchestrator-verified quality gate** passes.
>
> **Type:** autonomous. **Realized via:** a thin Ralph core
> ([loops/ralph/](loops/ralph/runner.ts)) + a per-WI orchestration wrapper
> ([orchestrator/phases/developer-loop.ts](orchestrator/phases/developer-loop.ts))
> composing [skills/developer-ralph/SKILL.md](skills/developer-ralph/SKILL.md).

## Responsibilities

1. Walk the WIs in **topological order**, each in the initiative worktree; skip
   dependents of a failed prerequisite; assert a **green baseline** before any work.
2. For each WI, iterate: read the stable per-WI brief + progress memory, act, then run the
   WI's `quality_gate_cmd` **orchestrator-side between iterations** (never trust the agent's
   "tests pass"). Stop on: gate-pass | iteration budget | cost budget.
3. **Verify quality discriminatingly** — gate-tightening catches hollow/false-passing
   gates (no-work-indicator scan + required-path diff check).
4. Keep the initiative branch **published** (push after each WI) so the review boundary
   always sees a synced, mergeable branch.
5. Carry **per-WI memory** across iterations (progress/learnings) so a capped iteration
   does not reset research to zero; re-stamp the brief per WI so WI-2 doesn't inherit WI-1's
   "I already have context" state.
6. Emit per-iteration cost/tokens/tool + per-WI delivery events; the **`dev-loop.delivered`
   git diff-stat is the authoritative completion signal**, not per-WI status counts.

## Inputs → Outputs

**Consumes:** `.forge/work-items/WI-*.md` (specs + per-WI gates); `.forge/project.json`
(baseline gate, demo shape); the worktree branch.
**Produces:** commits on the initiative branch (pushed); WI status; `AGENT.md` + per-WI
progress memory; `dev-loop.delivered` + per-iteration JSONL events.

## Relationships

- **Upstream:** [Project Manager](docs/architecture/refocus-architecture/Project-Manager.md) (WIs + gates).
- **Downstream:** the [unifier](docs/architecture/refocus-architecture/Review-Loop.md) runs as the final stage on the same worktree.
- **Reads:** the project's Brain 3 only (advisory) — **never** the forge brain (executor takes intent from the WI). **Composes skill:** `developer-ralph`.

## Boundaries (what this is NOT)

- Not a decomposer — it implements WIs as received; if a WI is unexecutable it reports it
  back as over-scoped, it does **not** silently re-plan (no double-decomposition).
- Not the quality authority's word — the gate is run by the orchestrator, not self-assessed.
- Not the merge surface — it delivers a branch; merging is the operator's.

## Net-new vs test-for-existing (sizing class)

From-scratch resource code needs a **higher per-iteration turn cap and a write-first
nudge** than tests-for-existing code: a too-tight cap ends the turn mid-research with
nothing persisted. The cost budget (not the turn cap) is the real bound. *(This was the
binding constraint in the betterado release-folder cycle.)*

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- **[DEV-1 · high]** Per-WI completion accounting goes **stale on resume** (recorded
  `failed:2` while the branch carried 11 passing tests). Make `dev-loop.delivered` (git
  diff) the single completion truth everywhere; on `complete:0` at resume, **disambiguate**
  real-delivery vs genuine-zero before proceeding (an empty branch must never open a PR).
- **[DEV-2 · high]** The per-WI agent is **not** on the `PhaseAgentSpec` seam (hard-coded
  `DEV_MODEL` + inline `buildDevSystemPrompt`), while the unifier in the same file is —
  two agent-spawn models in one file. See [Skill-Model.md](docs/architecture/refocus-architecture/Skill-Model.md).
- **[DEV-3 · med]** Dead/duplicated source-of-truth: `loops/ralph/PROMPT.md.tmpl` is dead
  in production (live path is `renderDevUserPrompt`) yet still receives fixes the live path
  misses; `loops/README.md` describes a removed `wedged` stop + `_adapters/` that don't
  exist. Collapse to one source.
- **[DEV-4 · med]** No explicit **wedge/stall circuit-breaker** (no-file-change-for-N,
  identical-error-for-M). Currently only the iteration budget bounds a spin. Research +
  forge's own v1 history make this the most expensive unattended failure mode.
- **[DEV-5 · low]** ~1265-line `developer-loop.ts` carries the per-WI loop *and* the entire
  unifier sub-phase; consider splitting the unifier out (see [Review-Loop.md](docs/architecture/refocus-architecture/Review-Loop.md)).
