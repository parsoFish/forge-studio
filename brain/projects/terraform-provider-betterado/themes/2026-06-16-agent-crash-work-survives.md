---
title: Agent crash after work done — recovery marks already-complete
description: WI-3 had an agent crash (exit code 1) after the acceptance test was written and committed; recovery scan found gate already green and marked stop_reason already-complete with zero rework.
category: pattern
created_at: 2026-06-16T00:00:00.000Z
updated_at: 2026-06-16T00:00:00.000Z
---

## Observation

WI-3 (resource acceptance test) had `dev-loop.agent-crash-retry` at attempt 1 (Claude Code process exited with code 1) after ~9 minutes of zero-tool heartbeats. The crash occurred after the acceptance test file was written, formatted, and committed to the branch. On recovery, the orchestrator's scan found the gate already green (`gate.pass` recorded before the crash completed) and set `stop_reason: already-complete` with `iterations: 0` in the ralph.end event.

**The work survived the crash intact.** No rework was needed. The 9-minute gap was waiting time inside the agent (likely API call to live ADO in the acceptance test run), not a wedge.

## Implication for this project

Live acceptance tests (`TF_ACC=1`) against real ADO take ~23 seconds per test step. When a test step is running during a long API call, heartbeat silence is expected — not a sign of wedging. The orchestrator should not crash-detect based on heartbeat gaps alone during acceptance test execution.

## Sources

- `_logs/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source/events.jsonl` (`dev-loop.agent-crash-retry` at `2026-06-16T10:25:55.002Z`; ralph.end WI-3 at `2026-06-16T10:26:28.855Z` with `stop_reason: already-complete`)
- `/home/parso/forge/brain/cycles/_raw/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source.md`
