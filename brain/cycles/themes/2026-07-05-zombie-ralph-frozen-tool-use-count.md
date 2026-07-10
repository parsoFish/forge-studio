---
title: Zombie ralph agent heartbeats with frozen tool_use_count for 90+ minutes
description: A stale WI-3 ralph session persisted after the WI completed, heartbeating at tool_use_count=25/last_tool=Write for ~90 minutes while downstream WI-4 and the unifier ran — wedge detection did not fire because the session had made prior progress.
category: antipattern
created_at: 2026-07-05
updated_at: 2026-07-05
---

## Pattern

WI-3 (`betterado_extension_install` resource implementation) completed iteration 0 and committed. A second ralph agent for WI-3 had been spawned (likely from a prior PM run's leftover context or a parallel dispatch) and reached `tool_use_count=25` then stalled with `last_tool: Write`.

From EV_mr5kkgos events: WI-3 heartbeats continued at tool_use_count=25, last_tool=Write, with `since_ms` growing from ~1,029,122 (17 min) through ~5,391,373 (90 min) — the full duration of WI-4 execution + unifier execution — before the log ends.

The wedge detector did NOT fire for this session because `tool_use_count > 0` (prior progress was recorded). Only a no-tool-progress guard would catch this.

## Impact

- Zombie session consumed API quota and heartbeat bandwidth for ~90 min
- No code changes from the zombie (it was frozen at Write, likely waiting on a stale tool result)
- Pipeline correctness was not affected — the real WI-3 session had already committed

## Trigger

Appears to be a WI with multiple simultaneous ralph sessions. Root cause: the dev-loop orchestrator may have dispatched WI-3 from two different PM decomposition runs (runs 3 and 4 both accepted WI-3 as a work item), and the session from run 3 was not killed when run 4's decompose was accepted.

## Detection gap

`since_ms` in heartbeat grows monotonically but wedge detection uses "no tool calls in N seconds since start" — a session with tool_use_count=25 but frozen is not currently detectable as a wedge. A secondary signal: tool_use_count unchanging across 10+ consecutive heartbeats should trigger a frozen-session alert.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-gallery-extensionmanagement/events.jsonl` — EV_mr5kkgos_8zqmzz4b parent_event_id heartbeat chain (lines 1492–1588)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-gallery-extensionmanagement.md`
