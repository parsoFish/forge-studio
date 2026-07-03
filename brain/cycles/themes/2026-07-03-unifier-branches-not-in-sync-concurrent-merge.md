---
title: Unifier branches-not-in-sync fires 15× when a concurrent initiative merges to main mid-cycle
description: When a parallel initiative merges to main between dev-loop completion and unifier start, the unifier's main↔merge-base invariant check fires on every iteration; 15 consecutive fires required operator manual rebase + forge requeue --resume-from=unifier to unblock.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## What happened

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git` (terraform-provider-betterado)

Dev-loop completed at ~11:10 UTC Jul 2 (L2344: 35 files, +3876 −539, 25 commits).
At some point before ~23:54 UTC Jul 2, `INIT-2026-07-01-migrate-framework-release-folder-permissions` merged to main: `main` advanced from baseline `964a90d5` to `402ac9bb`.

Unifier first started at 23:44 UTC Jul 2. Gate `unifier.gate.branches-not-in-sync` fired:

```
local↔remote invariant violated: main (402ac9bb) != merge-base (964a90d5)
— main diverged from the pre-initiative state
```

Fires: 15 total across UWI-2, UWI-3 (from ~23:54 to ~00:39 UTC Jul 3).

The unifier attempted rebases inside its iterations (UWI-2 and UWI-3 both ran bash `git rebase` commands) but the gate continued to fire because the invariant check was structural (not cleared by the unifier's own branch rebases without a forge orchestrator acknowledgement).

**Unblock path:** Operator manually rebased the initiative branch onto the new main, then `forge requeue --resume-from=unifier`. UWI-4 passed the CI gate and opened the PR.

## Why 15 fires is notable

Each `branches-not-in-sync` fire terminates the current unifier iteration and spawns a new one. With the 3-minute UWI timeout per iteration, 15 fires × ~3 min = ~45 minutes of wall-clock waste plus whatever the unifier did within each iteration before hitting the gate. The recovery was correct but required operator attention on a Sunday night.

## Structural cause

The unifier's invariant is correct (it ensures the branch can cleanly fast-forward main). But it has no automated recovery: it does not know how to rebase the initiative branch onto the diverged main without forge orchestrator co-operation. The unifier can rebase inside a worktree, but cannot update the forge state machine's recorded `merge-base`.

## Mitigation options

1. **Automatic rebase on divergence (forge machinery):** when `branches-not-in-sync` is detected, attempt `git rebase origin/main` on the initiative branch, update the stored merge-base, and continue. Only applicable if the rebase is conflict-free. If conflict, escalate to operator.
2. **Detect concurrent merges earlier:** after dev-loop completion, before unifier starts, check if main has advanced. If so, rebase + update merge-base in the orchestrator before invoking the unifier.
3. **Accept operator path as designed:** the current `forge requeue --resume-from=unifier` path works; the cost is operator intervention. Document it as the recovery SOP.

Option 2 is the most conservative and easiest to implement: a one-time check in the orchestrator at the dev→unifier handoff, not inside the unifier loop.

## Prior occurrence

`brain/cycles/themes/2026-06-07-unifier-non-fast-forward-recovery.md` documents a single-fire recovery case. This is the same class of failure at 15× frequency, caused by the gap between dev-loop end (~11:10) and unifier start (~23:44) — ~12 hours during which the concurrent initiative merged.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git/events.jsonl` (L2698, L2820, L2895, L2980, L3065, L3127, L3182, L3258, L3317, L3385, L3439, L3481, L3531, L3566, L3626: 15 branches-not-in-sync fires)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git.md`
