---
title: Unifier incomplete-delivery gate loop — 16 resume attempts on large permissions migration
description: The unifier fired 16 resume-branch-pushed events over ~2h 45m on a 65-commit permissions initiative; unifier.crash-retry and unifier.failed events present; PR opened 4 times; gate cleared only after second full dev-loop run and operator requeue.
category: antipattern
created_at: 2026-07-04T00:00:00.000Z
updated_at: 2026-07-04T00:00:00.000Z
---

## Pattern observed

Initiative: `INIT-2026-07-01-migrate-framework-security-permissions` (17 security/permissions types, 65 commits, 193 files).

Timeline:
- Dev-loop run 1 complete (2026-07-02T12:53): 88 files, 32 commits.
- Unifier entered loop: 16 `dev-loop.resume-branch-pushed` events from 2026-07-03T13:02 to 15:49 (~4 min per attempt).
- `unifier.crash-retry` and `unifier.failed` events emitted — unifier crashed at least once mid-loop.
- PR #48 opened 4 times total (reviewer re-triggered with each unifier pass).
- Loop cleared after dev-loop run 2 (WI-4/5 re-ran, large additional delivery: 193 files, 13168 ins, 6041 del).

## Why this matters

16 unifier resume cycles × ~4 min each = ~64 min of unifier spin + reviewer re-trigger overhead. Operator eventually requeued to break the loop. The `unifier.gate.incomplete-delivery` sub-check was the gate; the unifier could not self-satisfy it (likely SDKv2 dead-file deletion or validator-parity finding that required actual code changes, not just a rebase).

## Root cause hypothesis

The unifier's `incomplete-delivery` gate detected missing artefacts (dead SDKv2 files not deleted, or validator-parity gaps) that the unifier skill cannot fix autonomously — it can rebase and push but not write code. Each resume therefore re-pushed the same state and re-failed the same gate, burning tokens without progress.

## Fix direction

Two levers:
1. **Max-resume cap for unifier on `incomplete-delivery`**: after N consecutive `incomplete-delivery` failures (e.g. 3), halt and emit a human-gate event rather than retrying indefinitely.
2. **Live-acc WI gate should include dead-file check**: `go vet -tags all ./azuredevops/...` inside the per-WI gate catches orphaned tag-gated test files before the unifier sees them; if the dev-loop clears it, the unifier never hits the `incomplete-delivery` wall.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions/events.jsonl` (16 × `dev-loop.resume-branch-pushed`; `unifier.crash-retry`; `unifier.failed`; `unifier.gate.incomplete-delivery`)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions.md`
