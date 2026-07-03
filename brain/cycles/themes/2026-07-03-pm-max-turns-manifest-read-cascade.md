---
title: PM max_turns failure from manifest-read cascade via headroom_retrieve/Task
description: When the PM's first tool calls spiral into repeated headroom_retrieve → Task → TaskOutput → Glob attempts to fetch the manifest, it can exhaust its turn budget before emitting any WIs; operator must requeue and the cycle is wasted.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## What happened

Cycle `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement`, first PM run (2026-07-01T21:59):

PM emitted `pm.empty-decomposition` with `result_subtype: error_max_turns`. In 22 tool calls it tried to read the initiative manifest via:
1. `headroom_retrieve` (hash-based lookup, returned nothing useful)
2. `Task` → Bash subagent (`cat <manifest>`) — waiting on TaskOutput
3. More `headroom_retrieve` calls with placeholder hashes
4. Another `Task` → Bash
5. Direct `Grep` on the manifest file
6. `Glob` on the worktree

No WIs emitted. Orchestrator classified terminal. Operator requeued.

Second run (2026-07-02T07:53) was SIGKILL'd (exit code 143) mid-exploration after 5 min 20 sec.

Third run succeeded but its WIs were rejected by the hidden-coupling validator. Fourth run (after operator added a decomposition annotation to the manifest) finally produced a valid graph.

**Net waste:** ~$3.2 across 4 PM runs. 4 operator requeue cycles.

## Root cause

The PM SKILL uses `headroom_retrieve` (prompt-cache context lookup) as the first-preference manifest reader. When the cache has no entry for the manifest path, the PM falls back to `Task`/`Bash` subagents — but managing the Task → TaskOutput sequence in a long context appears to consume turns rapidly, leaving no budget for WI writing.

The direct `Read` tool succeeds in later runs where `headroom_retrieve` succeeds or is skipped.

## Impact

- Each wasted PM run: $0.5–1, 5–10 min wall-clock, operator attention.
- Cycle had 3 failed PM runs before dev-loop could start (~18 hours elapsed from first enqueue to dev-loop start).

## Fix directions

1. PM SKILL: use `Read` directly for the manifest file as fallback if `headroom_retrieve` returns no result; cap headroom_retrieve retries at 1.
2. Reduce PM iteration budget for exploration; allocate more turns to writing.
3. PM SKILL: emit a partial WI graph if turns are nearly exhausted rather than emitting nothing.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement/events.jsonl` (events: `pm.empty-decomposition`, `failure_classification` × 3, `Claude Code process exited with code 143`)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement.md`
