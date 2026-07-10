---
title: Milestone 1 delivered in single iteration across all 4 WIs
description: >-
  Milestone 1 (per-file churn, per-author churn, date-window) decomposed into
  4 dependency-ordered WIs all closed in 1 iteration each using TDD gate
  pattern; total 17 files, +1237 −70 lines in 27 minutes.
category: pattern
keywords:
  - milestone-1
  - single-iteration
  - TDD
  - churn
  - dependency-graph
created_at: 2026-07-10T11:08:20.000Z
updated_at: 2026-07-10T11:08:20.000Z
---

# Milestone 1 delivered in single iteration across all 4 WIs

## Pattern observed

Milestone 1 — code churn — had 4 dependency-ordered WIs:

- **WI-1** `src/churn.ts` (per-file churn pure module) — 1 iter, ~3m47s
- **WI-2** `src/stats.ts` + `src/format.ts` (per-author churn) — 1 iter, ~3m27s
- **WI-3** `src/cli.ts` (`--since`/`--until` window) — 1 iter, ~2m49s
- **WI-4** acceptance gate + docs/changelog — 1 iter, ~6m40s (depends on WI-1/2/3)

All 4 WIs completed in exactly 1 iteration. The `gate.expected-fail` → implement → `gate.pass` TDD pattern executed cleanly for each: separate test file per WI (`test/churn.test.ts`, `test/author-churn.test.ts`, `test/window.test.ts`) gave agents a clear pre-existing failure to drive against.

Final delivery: 17 files, +1237 −70 lines, 15 commits. `npm test` + `npm run acceptance` green.

## Why it worked

- **One test file per WI** — each agent had an unambiguous quality gate pointing at its own new test file; no collision with prior WI gates.
- **Pure modules** (WI-1, WI-2) are the easiest to build and test: no I/O, fixture-only. Complexity concentrated in WI-4 (acceptance + docs, 7 test runs).
- **Dependency graph** enforced sequential ordering — WI-4 ran only after WI-1/2/3 pushed their branches.

## Implications for future milestones

Milestone 2 (ownership/hotspots) and Milestone 3 (dashboard) follow the same project shape. Expect single-iteration delivery to hold as long as:
- WIs target separate test files (no shared gate overlap)
- Pure aggregation modules stay isolated from I/O in `src/git.ts`
- WI specs include concrete sentinel values (C9: non-default fixtures)

## Sources

- `_logs/2026-06-21T02-08-23_INIT-2026-06-21-gitpulse-code-churn/events.jsonl` — `ralph.end` events for WI-1 through WI-4 showing `iterations=1`
- `/home/parso/forge/brain/cycles/_raw/2026-06-21T02-08-23_INIT-2026-06-21-gitpulse-code-churn.md`
