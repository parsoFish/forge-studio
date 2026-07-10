---
title: Unifier spins to budget exhaustion when main diverges — no rebase recovery
description: When another initiative merges to main during the dev-loop run, the unifier hits branches-not-in-sync on every iteration and exhausts its budget with no recovery; manual rebase + requeue is the only path.
category: antipattern
created_at: 2026-07-10T10:30:00.000Z
updated_at: 2026-07-10T10:30:00.000Z
---

## What happens

The unifier checks a local↔remote invariant: `main` HEAD must equal the worktree's
merge-base. If another initiative merges to `main` during the dev-loop run, the remote
`main` advances past the merge-base. The unifier emits `unifier.gate.branches-not-in-sync`
and cannot proceed. With no rebase path, it retries the same gate every iteration until
budget exhaustion, then emits `unifier.failed`.

## Evidence

`2026-06-17T21-21-21` cycle: 8 unifier iterations, all `branches-not-in-sync`,
error: `main (abd25a27) != merge-base (43c6bbad) — main diverged from the pre-initiative state`.
Cost of 8 idle iterations + the entire dev-loop's work stranded (PR never opened).

This is the same condition as `2026-06-07-resume-needs-rebase-concurrent-merge` — confirmed
recurrence.

## Recovery (manual)

1. Identify the stranded worktree branch.
2. `git -C <worktree> rebase origin/main` (resolve any conflicts).
3. `forge requeue --resume-from=unifier` — re-runs the unifier with the rebased branch.

## Fix direction (forge machinery)

The unifier should detect `branches-not-in-sync` on iteration 1 and immediately attempt
`git rebase origin/main` in the worktree. If rebase succeeds with no conflicts, continue.
If conflicts exist, emit `unifier.rebase-conflict` and terminate (manual intervention
required). Current behaviour (spin 8 iterations) wastes ~8 minutes and obscures the root
cause in the event log.

## Litmus (is this forge machinery?)

Yes — this is about the unifier's internal gate-and-retry loop, not about any
project-specific concern. Would be true for any project.

## Sources

- `_logs/2026-06-17T21-21-21_INIT-2026-06-17-release-stages-array-refactor/events.jsonl` (unifier events 22:31–22:53)
- `/home/parso/forge/brain/cycles/_raw/2026-06-17T21-21-21_INIT-2026-06-17-release-stages-array-refactor.md`
