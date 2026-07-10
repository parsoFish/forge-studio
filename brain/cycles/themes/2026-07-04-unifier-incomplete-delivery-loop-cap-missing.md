---
title: Unifier has no cap on incomplete-delivery resume cycles — can spin indefinitely
description: On a large 65-commit initiative the unifier fired 16 resume-branch-pushed attempts over ~2h 45m against an incomplete-delivery gate it could not satisfy autonomously; no forge mechanism halted the loop; operator requeue was the only exit.
category: antipattern
created_at: 2026-07-04T00:00:00.000Z
updated_at: 2026-07-04T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions` (terraform-provider-betterado).

The unifier entered an `incomplete-delivery` gate failure loop:
- 16 × `dev-loop.resume-branch-pushed` (2026-07-03T13:02–15:49, ~4 min per cycle).
- `unifier.crash-retry` and `unifier.failed` events emitted — unifier crashed mid-loop.
- PR #48 re-opened 4 times (reviewer re-triggered on each unifier push).
- No forge-level cap prevented indefinite retry.
- Operator requeued to break the loop.

## Why this is a forge-machinery issue

The `incomplete-delivery` gate sub-check detects artefacts the unifier cannot produce (code changes, dead-file deletions, validator additions). Retrying the same unifier skill with the same branch state cannot clear a gate that requires dev-loop work. The unifier's resume loop is correct for transient failures (e.g. rebase conflicts, network); it is destructive for structural failures (missing artefacts). Forge has no discriminator between the two.

## Fix direction

Add a consecutive-failure counter to the unifier loop for `unifier.gate.incomplete-delivery`:
- After N consecutive failures (proposed: 3), halt with a `unifier.human-gate` event and surface the sub-check failure to the operator via notification.
- This prevents the 16-spin pattern and makes the gate failure immediately actionable.
- Does NOT affect the rebase/push-conflict resume path (different gate sub-check type).

## Precedent

`2026-06-11-unifier-wedge-33hr-no-tool-progress` — a different unifier wedge pattern (tool_use frozen). This is a distinct class: the unifier is making tool progress but cannot satisfy the gate — gate-loop vs tool-freeze.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions/events.jsonl` (16 × `dev-loop.resume-branch-pushed`; `unifier.crash-retry`; `unifier.failed`; `unifier.gate.incomplete-delivery`)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions.md`
