---
title: Cwd hallucination depth — agent runs CLI but never writes, producing 0 writes across 5 iterations
description: WI-5 (cycle v3) showed cwd hallucination severe enough to prevent all file creation — 6 testRuns recorded but 0 writes and 0 files created across 5 iterations. The agent probed the CLI successfully but could not write the output to the correct path.
category: antipattern
created_at: '2026-05-26'
updated_at: '2026-05-26'
---

# Cwd hallucination depth — zero writes despite successful CLI probe

## Prior context

`2026-05-25-ralph-cwd-hallucination-per-iteration.md` documented WI-5 (cycle v2) where
cwd confusion caused 4 consecutive gate failures but the agent eventually succeeded (iter 5).
That theme noted `testRuns: 0` as a sign the agent never ran `node --test` before gating.

## New observation (cycle v3, WI-5)

Cycle v3 WI-5 (`tests/stats-golden.test.ts`) showed a deeper failure mode:

```
WI-5 tool-use across 5 iterations:
  reads:     66   (filesystem discovery + re-reading specs)
  writes:    0    (no files created)
  bashCalls: 54   (mostly ls/find/pwd discovery + CLI probe runs)
  testRuns:  6    (CLI was probed — but via bash, not node --test)
  gate:      fail × 5  ("Could not find 'tests/stats-golden.test.ts'")
  stop:      iteration-budget
```

The agent successfully ran `claude-trail stats <fixture>` to compute expected output
(hence `testRuns: 6`) but never wrote the test file. In each iteration:

1. First `Read` to `/workspaces/claude-trail/AGENT.md` (wrong — hallucinated).
2. 10–12 bash discovery commands (`ls /workspaces/`, `ls /`, `find / -name WI-5.md`).
3. Agent located real worktree path.
4. Probed CLI output (bash, not `node --test`).
5. Intended to write test file — but all `Write` attempts targeted either the wrong path
   or were never issued (the iteration ended mid-reasoning).

Iteration 3 first read: `/AGENT.md` (root). Iteration 4: `/workspaces/claude-trail/AGENT.md` again.
The confusion reset each iteration rather than converging.

## Why this is distinct from cycle v2

Cycle v2 WI-5: `testRuns: 0`, `writes: 0` — agent never ran anything, never wrote anything.
Cycle v3 WI-5: `testRuns: 6`, `writes: 0` — agent ran the CLI correctly but still wrote nothing.

The v3 failure mode is more insidious: the agent appeared to be making progress (CLI probing
succeeded) but the cwd confusion prevented translating that progress into file writes.

## Diagnostic signal

When a ralph WI iteration ends with `writes: 0` AND the gate fails with "Could not find
'<file>'", the agent has not created the required file regardless of what testRuns says.
`testRuns` counts `node --test` OR bash CLI invocations — it does not confirm file creation.

## Recommended fix (reinforcement of prior)

1. **Absolute cwd injection in ralph context**: `"Your worktree is at <abs-path>. All Read
   and Write calls MUST use this absolute path prefix."` — unchanged from prior recommendation.
2. **Write-liveness check**: if iteration ends with `writes: 0` and a new file was required by
   the WI spec, fail a liveness check immediately and inject path correction before next iteration.
3. **Distinguish CLI probe testRuns from node --test testRuns**: if `testRuns > 0` but `writes: 0`
   and gate fails on missing file, log a distinct event (`ralph.testRuns-without-write`) to aid
   detection.

## Sources

- `_logs/2026-05-26T08-17-13_INIT-2026-05-26-claude-trail-verify-cascade-v3/events.jsonl` — WI-5 iteration metadata (reads=66, writes=0, bash=54, testRuns=6)
- `brain/_raw/cycles/2026-05-26T08-17-13_INIT-2026-05-26-claude-trail-verify-cascade-v3.md` — cycle archive
- `brain/projects/claude-harness/themes/2026-05-25-ralph-cwd-hallucination-per-iteration.md` — prior cwd-hallucination theme (cycle v2)
