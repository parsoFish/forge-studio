---
title: Unifier oscillates between "pre-existing failures" and "regression introduced by this branch" diagnoses across iterations
description: Cycle v3 unifier spent 15 iterations alternating diagnoses — iteration 5 concluded "main is green, these are regressions" while later iterations concluded "these are pre-existing failures not in scope". No resolution reached; stop was iteration-budget.
category: antipattern
created_at: '2026-05-26'
updated_at: '2026-05-26'
---

# Unifier diagnosis oscillation — pre-existing vs. regression flip-flop

## Prior context

`2026-05-25-unifier-wedge-preexisting-test-failures.md` (cycle 6) documented a cleaner failure:
unifier diagnosed root cause correctly at iteration 1 ("these are pre-existing") but had no
escape hatch and retried 15 times anyway. The diagnosis was stable and correct.

## New observation (cycle v3)

Cycle v3 unifier showed a qualitatively different failure: the diagnosis itself was unstable.

| Iteration | Diagnosis |
|---|---|
| 1 | "All stats tests (56–70) pass. 3 failures (43, 72, 74) are pre-existing." |
| 2 | "Failures all pre-existing — expecting `_pr-metadata.json` fixture." |
| 3 | "All 4 failures need `tests/fixtures/cycle-INIT-FIXTURE-1/.forge/_pr-metadata.json`." |
| 4 | "Missing `_pr-metadata.json` fixture failure is pre-existing on main." |
| 5 | **"Main is green (0 failures). The 4 failures on this branch are regressions introduced by this initiative."** |
| 6–8 | Back to "failures are pre-existing, not in scope." |
| 9–10 | "Failures due to missing `_pr-metadata.json`." |
| 11–15 | Mix of both — no stable conclusion. |

## Root cause hypothesis

The unifier's `npm test` on main produced inconsistent results across iterations. Two plausible
explanations:

1. **Test isolation issues on main**: `npm test` on main branch (after stashing or branching)
   may have produced different failure counts depending on test ordering or filesystem state.
   A result of "0 failures on main" in iteration 5 was not reproducible in other iterations.

2. **Worktree state contamination**: switching between branch and main within the same worktree
   may have left uncommitted test files or fixtures that affected results. WI-5 never wrote any
   files, but earlier WIs wrote new test files — these may have been visible on main after
   the stash/checkout.

## Compound failure factor (WI-5 incomplete)

WI-5 failed to create `tests/stats-golden.test.ts`. The unifier therefore saw two categories
of failure: (a) the pre-existing `_pr-metadata.json` fixture issue and (b) the missing golden
test from WI-5. When the agent counted failures and compared to main, it sometimes counted
(a) only and sometimes (a)+(b), producing inconsistent totals that drove the oscillation.

## Why this is worse than cycle 6

- **Cycle 6**: stable (wrong) diagnosis, no mechanism to escape → 15 iterations.
- **Cycle v3**: unstable diagnosis, no mechanism to escape → 15 iterations + false "all-clear"
  on iteration 5 that would have caused a PR merge if the gate had not blocked it.

The iteration 5 false-all-clear is the most dangerous outcome: the agent believed it had
confirmed regressions introduced by this branch and attempted to fix them, potentially
introducing new changes to address a misdiagnosed root cause.

## Recommended fixes (delta from prior theme)

1. **Deterministic main-baseline capture**: capture `npm test` failure list on main ONCE at
   unifier start. Store as a frozen set. Compare each run's failures against this frozen set.
   Do not re-run on main in subsequent iterations.
2. **Failure-set stability check**: if the failing test names change between consecutive
   unifier iterations (on the same branch), emit `unifier.failure-set-unstable` and halt
   further diagnostic attempts.
3. **WI-scope awareness**: if a WI ended with `status: failed` and `writes: 0` for a required
   new file, note the missing file explicitly in the unifier context so the unifier can
   distinguish "gate fails because WI incomplete" from "gate fails because pre-existing failure."

## Sources

- `_logs/2026-05-26T08-17-13_INIT-2026-05-26-claude-trail-verify-cascade-v3/events.jsonl` — unifier iteration metadata (16 gate-failed, 15 iterations, last_assistant_text per iter)
- `brain/_raw/cycles/2026-05-26T08-17-13_INIT-2026-05-26-claude-trail-verify-cascade-v3.md` — cycle archive
- `brain/projects/claude-harness/themes/2026-05-25-unifier-wedge-preexisting-test-failures.md` — cycle 6 prior unifier-wedge theme
- `brain/projects/claude-harness/themes/2026-05-25-wi-gate-vs-unifier-gate-mismatch.md` — structural gate mismatch theme
