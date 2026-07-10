---
title: Rate-limit crash at iter 0 cascades prerequisite-failed to all dependent WIs
description: When ralph crashes before executing any tool (rate-limit hit at iteration 0), the orchestrator marks the WI failed and cascades prerequisite-failed to all dependent WIs — requiring a full restart cycle rather than a targeted retry.
category: antipattern
created_at: 2026-07-04T01:02:34.000Z
updated_at: 2026-07-04T01:02:34.000Z
---

## Observed pattern

In the accounts-profile cycle (2026-07-03T12:50), ralph hit "You've hit your limit · resets 12:10am (Australia/Brisbane)" immediately after the initial gate check — before executing any tool_use. The orchestrator retried 2× (max_retries=2), each time getting the same rate-limit exit. Result:

```
WI-1: status=failed, stop_reason=crashed, iterations=0, tool_use.reads=0, brainReads=0
WI-2: ralph.skipped (reason=prerequisite-failed)
WI-3: ralph.skipped (reason=prerequisite-failed)
```

Orchestrator classified: `failure_mode=terminal, recoverable=false`.

The actual work (all 3 WIs) was deferred to the next scheduler pickup ~4h later. The WI decomposition, worktree, and all PM work were intact — only the rate-limit prevented execution.

## Why this is costly

- All WIs fail even though WI-2 and WI-3 might have had no rate-limit issue
- Recovery requires a full cycle restart (operator action or scheduler timeout)
- The `terminal/non-recoverable` classification is wrong — rate-limit is time-bounded, not a code defect

## Evidence lines

- L82 (developer-loop WI-1 end): `status=failed, stop_reason=crashed, runner_error.message="Claude Code process exited with code 1"`
- L69,74,80 (developer-loop logs): `"You've hit your limit · resets 12:10am (Australia/Brisbane)"` — rate limit hit
- L86, L88: `ralph.skipped` for WI-2, WI-3 with `reason=prerequisite-failed`
- L91: orchestrator `failure_classification` → `terminal`

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-accounts-profile/events.jsonl`
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-accounts-profile.md`
