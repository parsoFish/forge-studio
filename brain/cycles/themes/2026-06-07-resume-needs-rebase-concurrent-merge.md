---
title: Long-stalled initiatives conflict with concurrent merges on resume
description: An initiative that stalls in queue accumulates conflict risk; when another initiative merges to main during the stall, the queued branch cannot auto-rebase on resume and is classified terminal/non-recoverable.
category: antipattern
created_at: '2026-06-07'
updated_at: '2026-06-07'
---

# resume-needs-rebase — concurrent merge during initiative stall

## Observation

Compact-flag initiative had `previous_failure_modes: [transient, requeued-from-failed-2026-05-30, requeued-from-failed-2026-05-30]` — stalled since 2026-05-30, re-queued twice. When it finally ran on 2026-06-07, the cycle completed normally (PR opened). The orchestrator then attempted to resume/close the cycle. Rebase onto `origin/main` failed:

```
error: could not apply 18318c7... feat: add --compact flag to claude-trail
Resolve all conflicts manually...
```

Another initiative had merged to main during the stall. The `cycle.resume-needs-rebase` error was classified as `terminal / non-recoverable`. The PR is open but the branch is behind main.

## Structural hazard

The longer an initiative waits in queue, the more merges accumulate on main, and the higher the probability that its branch conflicts on rebase. Initiatives with `previous_failure_modes` entries are at elevated risk.

## Mitigation options

1. **Shorter stall windows**: prioritise requeued initiatives; cap stall duration.
2. **Auto-rebase on enqueue**: when a previously-failed initiative is re-enqueued, rebase its preserved branch onto current main before it re-enters the queue.
3. **Human rebase signal**: `resume-needs-rebase` events should surface to the operator immediately (currently logged but only visible via `forge status` or event log inspection).

## Outcome this cycle

PR is open but branch conflicts with main. Manual rebase required by operator before merge. Feature was correctly delivered; the conflict is a post-delivery operational hazard, not a dev-loop failure.

## Sources

- `_logs/2026-06-07T22-31-02_INIT-2026-05-30-claude-trail-compact-flag/events.jsonl` — `cycle.resume-needs-rebase`, `failure_classification` events
- `brain/cycles/_raw/2026-06-07T22-31-02_INIT-2026-05-30-claude-trail-compact-flag.md`
