---
title: Rate-limit no-backoff antipattern
description: >-
  Retrying spawns immediately after hitting Claude's rate limit produced 215+
  zero-cost spawns and 49% of all v1 Cycle 3 job failures. Parse resetsAt, set
  rateLimitPausedUntil, gate canSpawnAgent.
category: antipattern
keywords:
  - rate-limit
  - backoff
  - retry
  - zero-cost-spawns
  - usage-limit
  - 49-percent
  - resetsAt
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes:
  - agent-stuck-no-detection
  - claude-agent-sdk
  - unattended-scheduler
---

# Rate-limit no-backoff antipattern

In v1 Cycle 3, **28 of 57 job failures (49%)** were usage-limit failures — the most common single failure cause. Forge was retrying spawns immediately after hitting the limit, cycling through orchestration overhead on each attempt without any agent actually running. **215+ zero-cost spawn attempts** were observed in a single cycle.

Fix:

1. Parse the reset time from the rate-limit error.
2. Set a `rateLimitPausedUntil` timestamp on the scheduler.
3. Check it in `canSpawnAgent()` (or v2's equivalent claim-gate) before any new spawn.
4. Emit a single `worker.rate-limited` event logging the pause duration.

A ~50-line change would have eliminated ~49% of Cycle 3 failures at zero implementation-quality cost.

The Claude Agent SDK provides a structured `RateLimitEvent` with `resetsAt` timestamp — better than string-parsing CLI errors. v2 should consume this directly in the orchestrator's claim path: when a `result` message arrives with `subtype: 'error_max_budget_usd'` or a rate-limit error, parse the `resetsAt`, set the pause, and refuse to claim from `_queue/pending/` until then.

## Sources

- [`v1-themes-failure-modes.cycle.md`](../../_raw/v1-wiki/v1-themes-failure-modes.cycle.md) — full lesson + Cycle 3 stats.

## See also

- [[agent-stuck-no-detection]] — the other dominant waste category.
- [[claude-agent-sdk]] — where structured `RateLimitEvent` lives.
- [[unattended-scheduler]] — what enforces the gate.
