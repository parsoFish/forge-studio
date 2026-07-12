---
title: Gate expected-fail is the correct signal for test-first WIs
description: 3/4 WIs hit gate.expected-fail (no-work-indicator) on iteration 0; in every case this correctly forced the agent to write the test file before exiting — no false positives.
category: pattern
keywords: [gate.expected-fail, no-work-indicator, test-first, iteration-0, dev-loop-gate, task-group]
related_themes: [gate-mechanics-index]
created_at: 2026-06-16T00:00:00.000Z
updated_at: 2026-06-16T00:00:00.000Z
---

## Pattern

For WIs whose acceptance criterion is "a new test file exists and runs clean", the per-WI quality gate will fire `gate.expected-fail` with `reject_reason: no-work-indicator` on the **first iteration** because the file doesn't exist yet. This is correct behaviour, not a false alarm.

The sequence:
1. Iteration 0 starts → gate runs → test file absent → `gate.expected-fail`
2. Agent writes the test file + implements the code
3. Iteration 1 → gate runs → file present, test runs → `gate.pass`

In the task-group acceptance + data source cycle (WI-1, WI-3, WI-4), all three test-first WIs followed this exact 2-step path. WI-2 (provider registration) passed immediately because the target test (`TestProvider_HasCorrectDataSources`) already existed before the WI ran.

## Implication

Do NOT count `gate.expected-fail` on iteration 0 as a red flag when the WI spec calls for writing a new file. The gate's tightening is a correctness property: it ensures the agent writes real work before closing the WI. The no-work-indicator check is the enforcement mechanism.

## Anti-implication

If `gate.expected-fail` fires on **iteration ≥ 1** for a test-first WI, that IS a signal of a problem (agent wrote a non-compiling file, wrong test name, or the gate cmd names a test that doesn't match what was written).

## Sources

- `_logs/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source/events.jsonl` (WI-1, WI-3, WI-4 gate.expected-fail events; WI-2 immediate gate.pass)
- `/home/parso/forge/brain/cycles/_raw/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source.md`
