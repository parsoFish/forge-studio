---
title: PM double instantiation — two parallel PM runs at cycle start waste ~$0.3+
description: Two PM invocations ran at 04:10:33 and 04:12:09 (90s apart) — both read brain pages and explored the worktree; the first was pre-empted without a pm.end event; the second completed and produced the WIs. No bad WIs emitted, but ~$0.3 wasted. Cause: cycle restart while PM was in-flight triggered a second PM spawn before the first closed.
category: antipattern
created_at: 2026-06-20
updated_at: 2026-06-20
---

# PM double instantiation — parallel PM runs at cycle start

## What happened

`INIT-2026-06-19-framework-state-upgraders` cycle started at `04:10:33`. Two PM invocations:

1. PM-1 started `04:10:33` — emitted `pm.brain-query` events (L37–L42), explored framework resource files, wrote no WIs, no `pm.end` event.
2. PM-2 started `04:12:09` — repeated brain queries and worktree exploration, then emitted WI-1 through WI-5 plus `pm.graph-emitted`.

The manifest shows `previous_failure_modes: [requeued-from-in-flight-2026-06-20, requeued-from-failed-2026-06-20]` — the cycle had previously been in-flight and failed/requeued twice. The first PM invocation was likely triggered by the scheduler on a prior resume attempt; when the cycle was requeued again, a second PM was spawned.

## Cost

PM-1 completed ≥6 brain queries (~$0.15) and worktree exploration before being pre-empted. PM-2 repeated the same brain reads. Combined waste: ~$0.3+ on duplicate exploration.

## No correctness harm

PM-2 produced valid WIs with correct dependency ordering. PM-1's partial exploration had no observable side effects (no WI files written from it). Both PMs independently converged on the same decomposition.

## Root cause

Scheduler resume triggered a second PM before confirming the first was dead. No idempotency guard on PM invocations — the scheduler assumes at most one PM is running per cycle; a crash/requeue race violates that assumption.

## Pattern to watch

If `pm.start` appears without a matching `pm.end` in the event log, a parallel instantiation occurred. Check `previous_failure_modes` — `requeued-from-in-flight` is the signal. The second PM's WIs are authoritative; the first's brain reads are pure waste.

## Sources

- `_logs/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders/events.jsonl` (L37–L42 PM-1 brain queries, L48 pm.graph-emitted from PM-2, manifest `previous_failure_modes`)
- `brain/cycles/_raw/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders.md`
