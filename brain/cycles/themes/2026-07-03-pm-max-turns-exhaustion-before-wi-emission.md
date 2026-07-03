---
title: PM max_turns exhaustion before WI emission — wasted $1.45 with 0 output
description: PM run 1 consumed its full turn budget exploring the manifest and worktree without writing any work items; requeue recovered cleanly in run 2.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build` (build package migration).

PM run 1 started normally — read brain (5 brain reads, including `profile.md`), read the manifest, explored the worktree (read `provider.go`, scanned `azuredevops/internal/service/build/`, probed the gap matrix). It exhausted its turn budget before emitting any WI files. Result: `error_max_turns`, $1.45 spent, 0 WIs produced.

Operator requeued. PM run 2 succeeded cleanly: 5 WIs, 1 iteration, $1.87.

## Classification

This is NOT a wedge event (tool_use_count was progressing). The PM was doing real work — just too much exploration before writing. At no point did it start emitting WIs then stop; it explored first to exhaustion.

## Structural context

The PM's turn budget is finite. A PM that reads many brain pages + reads many project files + drafts multiple WIs can hit the ceiling. Large migration initiatives with many resources-in-scope amplify this risk: the PM must read the gap matrix doc, enumerate registrations in `provider.go`, cross-reference the profile's migration checklist, and write 5+ WI files.

## Recovery

Requeue → PM run 2 is the correct path and worked here. The PM had enough context from the brain to succeed on the second attempt (no manifest change needed).

## Direction

Two mitigations:
1. **Increase PM turn budget** for initiatives whose manifest signals a large decomposition (e.g. `complexity: high` or `expected_work_items: N>3`).
2. **PM should write WIs incrementally** — emit each WI file as soon as it's ready rather than drafting all WIs before writing. This survives a mid-session cutoff.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build/events.jsonl` (PM run 1 end event with `error_max_turns`)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build.md`
