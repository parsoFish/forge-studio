---
title: Stale .forge/last-gate-failure.md poisons unifier orientation
description: .forge/last-gate-failure.md is gitignored and persists across unifier invocations; each new unifier session reads it as a live signal, spending ~15 tool calls re-orienting before determining it is a fossil from a prior run.
category: antipattern
created_at: 2026-07-04T01:02:34.000Z
updated_at: 2026-07-04T01:02:34.000Z
---

## Observed pattern

In the accounts-profile cycle, WI-3 failed at 17:16 (iter 5, iteration-budget exhausted) and wrote `.forge/last-gate-failure.md` with the gate output from that final failure. The unifier was then invoked as UWI-2 at 22:55 (~6h later). Because `.forge/` is gitignored, the file persisted unchanged.

Both UWI-2 and UWI-3 began by reading `last-gate-failure.md` and initially treated it as reflecting the current gate state — leading to misdiagnosis and wasted tool calls. UWI-2 iter 3 was the first session to explicitly confirm the file was stale (by re-running the gate and observing a different failure mode). Cost: ~15 tool calls per unifier session to re-orient.

Operator feedback confirmed: "the stale `last-gate-failure.md` misleading unifier orientation is the one still without a dedicated fix — it's the highest-priority remaining forge fix of the three."

## Why it recurs

- `.forge/` is gitignored — the file is never cleaned up by branch operations or fresh worktree creation
- Unifier prompt instructs reading `last-gate-failure.md` as initial orientation; no caveat about staleness
- The file's timestamp is not inspected by the unifier — it has no way to distinguish "written 6h ago by a different run" from "written 30s ago by this run's gate"

## Fix directions

1. **Clear at unifier start (structural fix):** The orchestrator should delete (or zero-length) `.forge/last-gate-failure.md` immediately before invoking each new unifier session. This is the load-bearing fix — zero stale reads.
2. **Document in unifier prompt (soft fix):** Add a caveat to the unifier PROMPT.md: "`last-gate-failure.md` may be stale from a prior iteration. Check its mtime vs the current timestamp before treating as authoritative." Lower-leverage but zero code change.
3. **Write a sentinel:** Orchestrator writes `.forge/unifier-session-id` at unifier start; unifier reads this and cross-checks it against the session ID embedded in `last-gate-failure.md` — discards the file if IDs don't match.

Fix #1 (delete-at-start) is simplest and eliminates the class entirely. Fix #2 is the fallback if the orchestrator change is deferred.

## Affected components

- Orchestrator: unifier-invocation path
- Unifier PROMPT.md / AGENT.md

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-accounts-profile/events.jsonl` — UWI-2 iter 3 metadata shows stale-file confirmation; roadblock #4 and #5 in retro.md
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-accounts-profile.md`
- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-accounts-profile/retro.md` — repeated actions #2, roadblocks #4/#5
