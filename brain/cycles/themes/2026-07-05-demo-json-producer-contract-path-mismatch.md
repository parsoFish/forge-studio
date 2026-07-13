---
title: demo.json producer/contract path mismatch causes pr-open failure
description: The unifier writes demo.json to `forge/history/<id>/demo/demo.json` but the review-node artifact contract requires `demo/<id>/demo.json`; the mismatch causes pr-open to fail with "DEMO.md / pr-description.md missing" even after packaging succeeds.
category: antipattern
created_at: 2026-07-05
updated_at: 2026-07-05
---

## What happened

In the pipelinesapproval initiative (2026-07-01), all 7 WIs completed cleanly and the unifier packaging commits landed on disk. The review node's pr-open step failed ~2 seconds after the packaging commit with "DEMO.md / pr-description.md missing". Initial read: filesystem race. Actual cause (confirmed same day in the betterado 2026-07 run-friction report (git history)):

- **Unifier wrote**: `forge/history/<initiative-id>/demo/demo.json`
- **Review node expected**: `demo/<initiative-id>/demo.json`

The paths differ; the review node's artifact contract checker cannot find the file. Operator recovered manually: `git push` + `gh pr create` with the existing `pr-description.md`, then moved the manifest from `_queue/failed/` → `_queue/ready-for-review/` by hand.

## Litmus test

If the pr-open node fails with "DEMO.md / pr-description.md missing" 2 seconds after a packaging commit succeeds:
1. Check the **path** the unifier wrote vs the **path** the review node's artifact resolver requires.
2. Not a race. The file exists — it's in the wrong location.

## Impact

- Blocked auto-PR open despite full clean delivery.
- Required manual operator recovery (~10 min).
- Same initiative; the recovery path is documented in the betterado 2026-07 run-friction report (git history) under "2026-07-04 — pr-open race" (corrected same day).

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelinesapproval/events.jsonl`
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelinesapproval.md`
- the betterado 2026-07 run-friction report (git history) (see "2026-07-04" entry + same-day CORRECTION)
