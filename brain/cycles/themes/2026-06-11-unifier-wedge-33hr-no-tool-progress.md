---
title: Unifier wedge — tool_use frozen for 33 hours before crash
description: Second unifier invocation (UWI-2) stalled with tool_use_count frozen at 16 from 2026-06-08T12:08 to 2026-06-09T21:29 (~33 hours), heartbeating every 15s, then crashed "exited code 1" — worktree blocked for the full duration.
category: antipattern
created_at: 2026-06-11T12:30:00Z
updated_at: 2026-06-11T12:30:00Z
---

# Unifier wedge — tool_use frozen 33 hours before crash

## Observation

In INIT-2026-06-08-release-definition-approval-options-gates-comple, the second unifier invocation (UWI-2) launched to handle the live-credentials check task. After 16 tool calls (all Bash/Read), the process made no further tool use. Heartbeat events continued every ~15s for ~33 hours:

```
tool_use_count: 16, last_tool: Bash, since_ms: 120,060,784 (at 2026-06-09T21:28)
```

Eventually crashed with `runner_error: "Claude Code process exited with code 1"`, classified `failure_class: dev-loop-unifier-gate-failed`.

This blocked the PR from opening in the second cycle run — the first cycle run had already opened PR #16, but the second cycle restart ended with `delivery gate: unifier did not pass`.

## Root cause (hypothesis)

The unifier was investigating whether `secrets.env` creds were accessible (tool calls 13–16: `find secrets.env`, `grep TF_ACC`). After failing to find credentials, it appears to have gotten into a waiting state or infinite tool-call loop that the Claude Code process never resolved. No error was emitted until the process died.

## Consequence

The wedge did NOT corrupt the branch — `dev-loop.delivered` still showed 5 files, 716 insertions. The PR had already been opened (cycle run 1). The worktree was eventually realigned after the second cycle-closure picked up the merge on 2026-06-11.

## Mitigation

A hard no-progress timeout (e.g. 30 min of heartbeats without a new tool call) would kill this process instead of waiting 33 hours. The wedge-loop-detector was removed (Tier 2 thinning); this case argues for a lighter variant: kill the process if `since_ms` exceeds a configurable ceiling (e.g. 30 min = 1,800,000 ms).

## Sources

- `_logs/2026-06-08T11-43-56_INIT-2026-06-08-release-definition-approval-options-gates-comple/events.jsonl` — `EV_mq563o68_4tcqvcb9` (unifier.failed, crashed), heartbeat sequence `EV_mq563xu8_21l9dbqr` through `EV_mq75jz56_nv6nuafb`
- `brain/cycles/_raw/2026-06-08T11-43-56_INIT-2026-06-08-release-definition-approval-options-gates-comple.md`
