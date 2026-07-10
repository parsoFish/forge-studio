---
title: Missing live-capture causes infinite scheduler spin — 19 unifier restarts over 5 hours
description: When a review gate requires a live evidence capture that dev-loop never produced, the scheduler treats each gate.fail as an ordinary code bug and keeps requeueing the unifier; no mechanism detects or surfaces the absent-capture root cause.
category: antipattern
created_at: 2026-07-05T04:00:00.000Z
updated_at: 2026-07-05T04:00:00.000Z
---

## What happened

In the core-package migration cycle (INIT-2026-07-01-migrate-framework-core), WI-3 (`betterado_project_features`) exhausted its iteration budget without running the live acceptance test or calling `CaptureLiveEvidence`. The review gate (`review-gate-r3.sh`) requires a capture for each migrated resource. GATE 1/4 emitted:

```
MISSING-CAPTURE-resource_project_pipeline_settings
```

The gate exited non-zero. The scheduler classified this as a normal gate failure and requeued the unifier. This repeated **19 times** over ~5 hours (2026-07-03T12:47 → 2026-07-03T14:53):

- Each unifier spawn: fresh context (no memory of prior attempts)
- Each spawn: same `gate.expected-fail` on startup → crash-retry (2 attempts) → `unifier.failed`
- 38 `unifier.crash-retry` events; 19 `unifier.failed` events
- 55 total `gate.expected-fail` events on UWI-6 across all spawns

Eventually a single unifier session ran long enough to produce the missing evidence, and the gate passed.

## Why this is a forge problem

The scheduler has one gate-failure classification: "retry". It does not distinguish between:
- **Code bug**: agent made a code error; next iteration can fix it
- **Missing live capture**: required evidence file was never created; an agent in an isolated worktree context cannot produce it without running the live test

Both emit `gate.fail` (or via crash: `unifier.failed`). The scheduler's retry loop is appropriate for code bugs; it is an infinite burn loop for missing captures.

## Cost

19 × ~15-minute unifier spawn overhead ≈ 4–5 hours wall-clock. The live-capture spin was the primary driver of the 54% cost overrun ($84.56 vs $55 budget).

## Recommended fix

Detect the `MISSING-CAPTURE-<type>` pattern in gate output (it is emitted by `review-gate-r3.sh` as a distinct token, not a generic failure string). On detection:
- Surface a specific alert (`live-capture-missing`) to the operator
- **Do not requeue** the unifier indefinitely; pause and require operator action

Alternatively: raise iteration budget for WIs whose `quality_gate_cmd` includes a live acceptance test, reducing the probability that the WI exhausts budget before capture.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core/events.jsonl` — UWI-6 events 2026-07-03T12:47–14:53; `unifier.crash-retry` count=38, `unifier.failed` count=19
- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core/user-feedback.md` — operator Q3 answer
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core.md`
