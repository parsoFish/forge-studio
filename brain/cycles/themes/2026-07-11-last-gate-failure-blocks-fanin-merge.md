---
title: .forge/last-gate-failure.md untracked file blocks dev-loop fan-in merge
description: >-
  After a per-WI gate run, .forge/last-gate-failure.md lands on disk but is
  gitignored (untracked). When the dev-loop fan-in rebases the WI branch onto
  accumulated prior-WI commits, git refuses with "untracked working tree files
  would be overwritten by merge", triggering dev-loop.merge-conflict-requeue
  and forcing a full WI re-implementation.
category: antipattern
keywords:
  - last-gate-failure
  - fan-in
  - merge-conflict
  - requeue
  - gitignored
  - untracked
created_at: 2026-07-11T00:00:00.000Z
updated_at: 2026-07-11T00:00:00.000Z
---

# `.forge/last-gate-failure.md` untracked file blocks dev-loop fan-in merge

## What happens

1. Ralph runs the per-WI quality gate. Gate exits 1. Forge writes `.forge/last-gate-failure.md` to the worktree. The file is gitignored — it is **untracked** (not staged, not committed).
2. Gate eventually passes. Ralph commits, marks the WI complete.
3. The dev-loop fan-in tries to rebase the WI branch onto the accumulated commits from prior WIs (to build the stacked branch).
4. `git merge` (ort strategy) detects that `.forge/last-gate-failure.md` exists in the working tree and would be overwritten by the incoming tree. It aborts: `"error: The following untracked working tree files would be overwritten by merge: .forge/last-gate-failure.md"`.
5. The orchestrator emits `dev-loop.merge-conflict-requeue` (attempt=1/max_retries=1) and re-runs the entire WI session from scratch.

## Cost

- One full WI re-implementation (≥1 iter, same work twice).
- In INIT-2026-07-11-csv-output-flag: WI-3 re-run cost ~$1.40 + ~6 min.
- The discarded session's commits are never used — the second session re-derives all edits independently.

## Root cause

`.forge/last-gate-failure.md` is written to the worktree root on a gate failure, survives to the fan-in boundary, and is never cleaned up. Because it is gitignored, git's merge cannot track it as a known file and refuses to clobber it.

## Relation to prior findings

`2026-07-04-stale-last-gate-failure-poisons-unifier` identified the same file as stale context that misdirects the unifier. This is a separate manifestation: the file blocks git mechanics before the unifier even starts.

## Fix direction

Fan-in merge preamble should `rm -f .forge/last-gate-failure.md` (or any `.forge/` scratch file that is gitignored) before invoking git merge/rebase. Alternatively, write the file to a tmpdir outside the worktree.

## Sources

- `_logs/2026-07-11T14-57-10_INIT-2026-07-11-csv-output-flag/events.jsonl` — `dev-loop.merge-conflict-requeue` event for WI-3 (merge_detail: "untracked working tree files would be overwritten by merge: .forge/last-gate-failure.md")
- `/home/parso/forge/brain/cycles/_raw/2026-07-11T14-57-10_INIT-2026-07-11-csv-output-flag.md`
