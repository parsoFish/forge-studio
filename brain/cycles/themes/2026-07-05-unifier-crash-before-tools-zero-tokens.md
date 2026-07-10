---
title: Unifier process exits code 1 before any tool calls — zero tokens, immediate crash
description: >-
  UWI-1 first invocation crashed exit-code-1 with 0 input/output tokens and 0
  tool calls. Two auto-retries both crashed identically. Second full invocation
  (UWI-1 retry session) succeeded. Pattern: unifier process-level failure before
  Claude Code runtime reaches first tool, unrelated to WI state.
category: antipattern
created_at: 2026-07-05T00:00:00.000Z
updated_at: 2026-07-05T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess`.

**First UWI-1 invocation (2026-07-03T12:49):**
- `unifier.start` fired; usage_delta showed 0 input + 0 output + 0 cache tokens.
- `unifier.crash-retry` fired twice (attempts 1 and 2); both also showed 0 tokens.
- Branch was pushed (`unifier.branch-pushed`) before the unifier process entered tool-use.
- `unifier.failed` with `stop_reason: crashed`, `iterations: 0`.

**Second UWI-1 invocation (2026-07-03T22:41):**
- Process started normally, executed 45+ tool calls in 1 iteration, committed demo + PR description, completed UWI-1.

## Characteristics

- Crash happens at process spawn, not mid-execution.
- Zero tokens consumed ≠ "nothing ran" — branch push (git) already happened before crash.
- Auto-retry (2 attempts, max_retries=2) does not recover when the crash root cause is process-level.
- Recovery requires waiting for a full new session (next cycle.start / forge requeue --resume-from=unifier).

## Related

Similar to `2026-07-05-zombie-ralph-frozen-tool-use-count` (Ralph frozen, no tool progress) — both are process-level failures invisible to the retry loop. The unifier case is faster-failing (immediate crash vs. frozen heartbeat) but equally unrecoverable via auto-retry.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess/events.jsonl` (unifier events at 2026-07-03T12:49–12:50)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess.md`
