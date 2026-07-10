---
title: PM error_max_turns on new-API exploration initiatives — 3rd recurrence
description: PM first run for INIT-2026-07-01-new-api-test hit error_max_turns before writing any WI; 6 Glob scans + client.go reads exhausted the turn budget; second run (re-queue) succeeded by reading manifest then writing WIs immediately. Same pattern seen in wiki and permissions migrations.
category: antipattern
created_at: 2026-07-10T12:31:01.000Z
updated_at: 2026-07-10T12:31:01.000Z
---

## Pattern

PM first invocation (2026-07-01T22:28):
- Read `spec-driven-work-items.md` (brain), `profile.md`
- Ran 6 `Glob` calls scanning the worktree
- Read `acceptancetests/package.go`, `client.go` (twice)
- Emitted `pm.empty-decomposition { result_subtype: error_max_turns }` at 22:30
- brainReads=5, writes=0

Orchestrator: `failure_classification: terminal, recoverable: false`.

Second run (2026-07-03T06:44) succeeded in ~5 min, emitted 6 WIs. Pattern: read manifest, read a few key files, write WIs incrementally.

## Recurrence

| Cycle | Initiative | Same pattern |
|---|---|---|
| 2026-07-01 | wiki migration | `error_max_turns`, operator re-queued |
| 2026-07-03 | permissions migration | `error_max_turns`, operator re-queued |
| 2026-07-01 | new-api-test | `error_max_turns`, operator re-queued |

At least 3 confirmed occurrences in the same project across consecutive cycles.

## Why it happens

New-API initiatives require the PM to discover what mock interfaces exist (`MockTestClient`, `test_sdk_mock.go`), how the client is registered, and what acceptance test patterns are used — before it can decompose. This exploration loop consumes turns before any WI write is attempted. The turn budget is a fixed cap; exploration without write commitment hits it.

## Fix direction

Two levers:
1. **Write-sooner prompt discipline:** PM SKILL should write the first WI file after reading ≤ 3 source files, not after full exploration. Remaining WIs can reference "see WI-1 pattern".
2. **Reduce turn consumption per tool:** Glob with a narrow pattern (e.g. `**/mock*`) vs scanning the full tree repeatedly.

The second-run success pattern (read manifest + 1-2 files → write immediately) is the model to enforce.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-test/events.jsonl` — `pm.empty-decomposition` at 2026-07-01T22:30:23, `failure_classification` event
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-test.md`
- Prior occurrences: `brain/projects/terraform-provider-betterado/themes/2026-07-03-pm-max-turns-on-wiki-migration-initiative.md`, `2026-07-05-pm-max-turns-large-package-migration.md`
