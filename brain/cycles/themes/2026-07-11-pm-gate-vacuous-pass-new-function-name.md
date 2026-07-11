---
title: PM writes gate for test function that doesn't exist yet — vacuous gate-too-loose pass
description: PM names a specific test function (e.g. `go test -run TestResolveFrameworkAuth`) as the WI quality gate before the function exists; `go test` exits 0 with `[no tests to run]`; the gate reads exit-0 as PASS; 0 commits delivered; cycle classified terminal/non-recoverable.
category: antipattern
created_at: 2026-07-11
updated_at: 2026-07-11
---

## What happens

PM decomposes a "write X + tests" WI and writes the quality gate as:

```
go test -tags all -run TestResolveFrameworkAuth ./azuredevops/internal/provider/
```

The function `TestResolveFrameworkAuth` does not exist at the start of the WI. `go test -run <pattern>` with no matching function exits 0 and prints `[no tests to run]`. The gate reads exit-0 as PASS. Ralph delivers 0 files, 0 commits. The orchestrator classifies the cycle terminal/non-recoverable and restarts.

## Observed instance

INIT-2026-07-10-framework-auth-parity, Cycle 1: all 3 WIs passed their gates at iter 0 with 0 commits. Cost: ~$1.23 (PM) + dev-loop overhead, all wasted. Forge fix ba073ce applied before Cycle 2: gate tightened to require output files in `git diff main...HEAD` (expected-fail at iter 0 if absent).

## Why it recurs

PM cannot know at decomposition time whether a function name it invents matches what ralph will write. Without a check that the required output *files* exist in the branch diff, a test-run gate on a new function is always vacuously satisfiable before any code is written.

## Fix / mitigation

- Gate on output **files** in `git diff main...HEAD` (expected-fail until files are present) rather than a named test function.
- Or: WI spec must list `creates: [path/to/new_file.go]` and the gate composition requires those paths before running any test.
- Forge fix ba073ce is the implemented form: `gate.expected-fail` fires at iter 0 when required creates[] paths are absent from the diff.

## Sources

- `_logs/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity/events.jsonl` — Cycle 1 gate.pass events with `[no tests to run]`, failure_classification terminal/non-recoverable
- `brain/cycles/_raw/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity.md`
