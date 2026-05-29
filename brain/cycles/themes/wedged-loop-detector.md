---
title: No dedicated wedged-detector — iteration budget is the sole no-progress bound
description: >-
  A dedicated wedged/no-progress stop-condition shipped early in v2 but was
  REMOVED in the Tier 2 thinning (2026-05-26) as fragile. The iteration budget
  is now the only bound on a non-converging Ralph loop.
category: pattern
keywords:
  - wedged
  - stuck
  - no-progress
  - stop-condition
  - ralph
  - iteration-budget
  - removed
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-26T00:00:00.000Z
related_themes:
  - ralph-loop-pattern
  - quality-gates-orchestrator-verified
---

# No dedicated wedged-detector — iteration budget is the sole no-progress bound

Ralph runs until a stop condition fires. The conditions that ship in
`loops/ralph/stop-conditions.ts` are:

1. **Quality gates pass** — the work item's acceptance criteria are verified by the orchestrator (not the agent).
2. **Iteration budget exceeded** — `iteration_budget` from the manifest is reached.

(A synthetic `gate-too-loose` condition also exists: the runner emits it at
iter-0 if the gate passes *before* any agent work, signalling the WI's
`quality_gate_cmd` doesn't exercise its acceptance criteria.)

## The wedged-detector was removed (Tier 2 thinning, 2026-05-26)

Early v2 shipped a third condition — a **wedged / no-progress detector**: abort
after N consecutive iterations with no observable progress (no new commits, no
new test passes, no `fix_plan.md` diff). It was **removed**. Rationale (from
`loops/ralph/runner.ts`): the magic 3-iteration window was diagnostic guesswork
that false-fired on the unifier's legitimate read-only iterations — it had to be
disabled via `Infinity` for the unifier, which was the tell that the check was
fragile, not load-bearing.

The **iteration budget is the principled cap**: if an agent wedges, it eats its
budget and exits naturally on `iteration-budget`. No separate no-progress
heuristic is needed.

> Historical note: this theme previously described the wedged-detector as a live
> stop condition. Kept (rather than deleted) as the canonical record of *why* the
> dedicated detector no longer exists — so a future cold session doesn't re-add it.

## See also

- [[ralph-loop-pattern]] — the loop this guards.
- [[quality-gates-orchestrator-verified]] — the other primary stop condition.
