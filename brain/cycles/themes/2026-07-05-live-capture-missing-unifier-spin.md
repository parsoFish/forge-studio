---
title: Review gate blocked on absent live evidence causes unifier infinite-retry spin
description: When a review gate requires live evidence a dev-loop WI never captured (WI exhausted budget before capture), the scheduler's uniform retry loop spawns the unifier repeatedly until a single session produces the evidence — with no operator alert.
category: antipattern
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Review gate blocked on absent live evidence causes unifier infinite-retry spin

## What happened

In the core framework migration (INIT-2026-07-01-migrate-framework-core), WI-3 (`betterado_project_features`) exhausted its 5-iteration budget without capturing live evidence. The review gate `bash .forge/review-gate-r3.sh` checked for `MISSING-CAPTURE-resource_project_pipeline_settings` and reported failure:

```
GATE 1/4
MISSING-CAPTURE-resource_project_pipeline_settings
```

The gate failure was `gate.expected-fail`, which the scheduler treats identically to any other unresolved gate: requeue and retry. Over ~5 hours, the scheduler spawned:

- **19 unifier starts** with UWI-6 pending
- **55 `gate.expected-fail` events** for UWI-6

Each unifier session had no context from prior sessions (fresh-context subagent). Eventually one session produced the live capture and the gate passed. No operator alert was raised.

## Why this is worse than a code-bug gate failure

A code-bug gate failure gives the unifier actionable signals (test output, error messages) that differ iteration to iteration as the agent makes progress. A missing-live-capture gate failure gives `MISSING-CAPTURE-<label>` — identical on every retry until the capture happens. The agent cannot "make progress" toward the gate by reading error output; it must execute live Terraform.

## Impact

- ~5 hours of stall (19 unifier spawns × ~15 min each).
- 54% cost overrun ($84.56 vs $55 budget).
- Scheduler gave no signal that the situation required operator attention.

## Direction

Options (in increasing effectiveness):
1. Gate script should differentiate `MISSING-CAPTURE` vs other failures and emit a distinct event class that the scheduler can recognize.
2. Scheduler should detect N consecutive identical gate failures with no change in gate output and either pause + alert operator or escalate.
3. Raise iteration budget for WIs with live-acc gates so the dev-loop has a better chance of reaching the capture step before exhaustion — preventing the cascade entirely.

The trigger was budget exhaustion on WI-3; the spin was the consequence.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core/events.jsonl` — 55 `gate.expected-fail` events for UWI-6 from 2026-07-02T09:17:15 through 2026-07-03T14:45:27
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core.md`
