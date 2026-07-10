---
title: Unifier crash on main-divergence invariant — resume_from:unifier recovers at low cost
description: When a sibling initiative merges to main between cycle start and unifier phase, the invariant check fires and kills the unifier; recovery via resume_from:unifier skips ralph entirely and costs only ~1 unifier iteration.
category: pattern
created_at: 2026-06-08T00:00:00.000Z
updated_at: 2026-07-10T10:08:05.000Z
---

# Unifier crash on main-divergence invariant

## What happens

Sequence:
1. Cycle starts. All ralph WIs complete (branch pushed).
2. Sibling initiative merges to `main` (race condition during unifier run).
3. Orchestrator checks invariant: `main (HEAD) != merge-base (at cycle start)`.
4. Unifier emits `dev-loop.branch-divergence` + `failure_classification: terminal, recoverable: false`.
5. Cycle is requeued with `resume_from: unifier`.

On the next run:
- PM is skipped (manifest already has WIs).
- Ralph is skipped (`resume_from: unifier` — ralph WIs already committed on branch).
- Unifier runs 1 iteration, pushes, PR opened.

## Evidence

`INIT-2026-06-08-release-definition-artifact-trigger-enhancements` run 1:
- L254: `unifier.failed`, status=crashed.
- L255: `dev-loop.branch-divergence`.
- L256: `local↔remote invariant violated: main (229f9523) != merge-base (6957854d)`.
- L257: `failure_classification: terminal, recoverable: false`.

Run 3 (recovery): L9151 unifier.end cost_usd=1.22, status=complete. L9153 dev-loop.delivered files_changed=6.

## Cost model

```
If resume_from:unifier is set on the manifest:
  Total additional cost = 1 PM run (if re-decomposition needed) + 1 unifier run
  In this case: $0.96 (2nd PM) + $1.22 (unifier) = $2.18
  vs a full restart: $0.69 (PM) + $2.06 (ralph) + unifier = much higher
```

## Key conditions

- `resume_from: unifier` works ONLY when ralph WIs are already committed on the branch.
- If ralph WIs were in-flight at the crash, the branch may be dirty and require ralph re-run.
- The invariant check triggers when `origin/main` HEAD differs from the merge-base recorded at cycle start.

## Sources

- `_logs/2026-06-08T11-54-58_INIT-2026-06-08-release-definition-artifact-trigger-enhancements/events.jsonl` (L254-L257: crash; L9149-L9153: recovery)
- `brain/cycles/_raw/2026-06-08T11-54-58_INIT-2026-06-08-release-definition-artifact-trigger-enhancements.md`
