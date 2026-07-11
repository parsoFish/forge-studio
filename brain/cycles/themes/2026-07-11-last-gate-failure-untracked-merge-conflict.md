---
title: .forge/last-gate-failure.md untracked file causes merge-conflict requeue
description: The untracked .forge/last-gate-failure.md file in the worktree blocks the WI fan-in merge, triggering dev-loop.merge-conflict-requeue and discarding the WI's work — a variant of the stale-last-gate-failure antipattern.
category: antipattern
created_at: 2026-07-11
updated_at: 2026-07-11
---

## What happened

WI-2 (tags analytics) completed its gate (gate.pass, iter 1). During fan-in, the merge step failed:

```
error: The following untracked working tree files would be overwritten by merge:
    .forge/last-gate-failure.md
```

The orchestrator emitted `dev-loop.merge-conflict-requeue` (attempt 1, max_retries:1) and discarded WI-2's work (`dev-loop.discarded`, files_changed:4, outcome:failed). WI-2 was re-run from scratch in a requeue; its work eventually landed via the unifier.

## Root cause

`.forge/last-gate-failure.md` is written by the gate runner when a gate fails, but it is gitignored (not committed). On requeue / branch merge, git's merge step sees it as an untracked file that would be overwritten and aborts. The file is not cleaned up before the merge attempt.

## Relation to prior antipattern

`2026-07-04-stale-last-gate-failure-poisons-unifier.md` documents `.forge/last-gate-failure.md` persisting across unifier invocations as stale signal. This is a different failure mode: the **untracked file blocks a merge outright**, causing a full WI re-run.

## Fix direction

Before any fan-in merge in the dev-loop, the orchestrator (or the pre-merge script) should delete or stash `.forge/last-gate-failure.md` if it exists as an untracked file in the worktree. Alternatively, add it to `.git/info/exclude` or clean it via `git clean -f .forge/last-gate-failure.md` before merge.

## Sources

- `_logs/2026-07-11T16-18-59_INIT-2026-07-11-init-2026-07-12-tags-command/events.jsonl` (line 202: dev-loop.merge-conflict-requeue)
- `/home/parso/forge/brain/cycles/_raw/2026-07-11T16-18-59_INIT-2026-07-11-init-2026-07-12-tags-command.md`
