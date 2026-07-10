---
title: Unifier crash-retry fires when Claude Code process exits before any tools run — retries are no-ops
description: UWI-4 unifier crashed twice (exit code 1) with tool_use_count=0; both crash-retries also crashed; only a full cycle restart resolved it.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking`.

**UWI-4 unifier** fired crash-retries at `attempt:1` and `attempt:2` (max_retries=2). In both cases, heartbeat events showed `tool_use_count:0` and `last_tool:""` up to the moment of crash. The retry mechanism re-launched the same unifier against the same UWI-4 spec; both retries also crashed immediately.

After 2 retries exhausted: unifier reported `status: crashed`, `failure_class: dev-loop-unifier-crashed`. The orchestrator emitted a delivery-gate error and the cycle ended without opening a PR.

**Resolution**: The next full cycle restart (triggered by forge serve / re-queue) succeeded: a fresh process started, tools ran normally.

## Diagnosis

Process-level crash (likely environment/session issue) rather than a logic failure. The retry mechanism is designed for transient gate failures or agent errors, not process-level crashes. Re-running the same binary against the same inputs cannot recover a process that crashes at launch.

## Impact

One wasted full cycle run; the branch was not lost (dev work was already committed), but a PR was not opened until the next cycle restart.

## Fix direction

Distinguish crash-before-first-tool (process crash) from crash-after-tools (logic failure). For process crashes (tool_use_count=0 at crash): skip retry and immediately escalate to cycle-restart rather than wasting 2 retry attempts.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking/events.jsonl` (EV_mr4zfyjy_m6103jh9, `unifier.crash-retry`, attempts 1 and 2; EV_mr4zfym1_km3lks24, `unifier.failed`, `status:crashed`)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking.md`
