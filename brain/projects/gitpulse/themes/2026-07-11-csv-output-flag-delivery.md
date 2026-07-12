---
title: --csv flag added via 7 CSV renderers in format.ts; acceptance gate extended
description: >-
  The --csv flag follows the --json renderer-pair pattern: csvEscape helper +
  7 pure renderers in format.ts, CLI switch in cli.ts. 4-WI TDD chain; each
  WI gate-passed in 1 iteration. WI-3 re-implemented once due to fan-in merge
  conflict; unifier absorbed WI-4 scope in 1 iteration.
category: pattern
keywords:
  - csv-output
  - csvEscape
  - renderAuthorsCsv
  - format.ts
  - cli.ts
  - acceptance-gate
  - renderer-pair
  - single-iteration
related_themes: [2026-06-21-json-output-flag-delivery, 2026-06-21-acceptance-gate-covers-only-headline-output, 2026-07-11-tags-command-delivery]
created_at: 2026-07-11T00:00:00.000Z
updated_at: 2026-07-11T00:00:00.000Z
---

# `--csv` flag: delivery pattern

## What was built

- `src/format.ts`: `csvEscape(field: string): string` — RFC-4180 escaping (~10 lines, no deps). Plus 7 CSV renderers: `renderAuthorsCsv`, `renderChurnFileCsv`, `renderChurnAuthorCsv`, `renderOwnershipCsv`, `renderHotspotsCsv`, `renderCompareCsv`, `renderSummaryCsv`. Multi-table renderers use blank-row section separation. All numeric values drawn from pre-aggregated data — no re-computation.
- `src/cli.ts`: `--csv` flag added (same pattern as `--json`); mutual-exclusion guard (exit 1 + stderr if both `--csv` and `--json` supplied); switch in compare and summary paths.
- `test/format-csv.test.ts`: 60 unit tests (5 for csvEscape, 55 for renderers).
- `test/cli-csv.test.ts`: 19 unit tests for CLI wiring and mutual exclusion.
- `test/acceptance/run.ts`: extended with `--csv` and `--csv --compare` fixture assertions.

## WI decomposition

- WI-1: csvEscape + format-csv.test.ts (5 ACs). 1 iter, $0.39.
- WI-2: 7 CSV renderers (9 ACs). 2 iter (gate.expected-fail iter=0, gate.pass iter=1), $1.13.
- WI-3: CLI wiring + cli-csv.test.ts (4 ACs). Implemented twice due to fan-in merge conflict (untracked `.forge/last-gate-failure.md`). First session $0.76 (discarded); second session $0.64 (discarded). Unifier absorbed.
- WI-4: Acceptance fixture (4 ACs). `ralph.skipped` (prerequisite-failed cascade from WI-3). Unifier absorbed.

## Architecture note

`format.ts` owns both human (`renderSummary`) and machine (`serializeSummary` for JSON, renderer suite for CSV) outputs. All are pure functions of aggregated data types. Single switch in `cli.ts`. Extending the Summary shape adds CSV output automatically — no per-table maintenance.

## Sources

- `_logs/2026-07-11T14-57-10_INIT-2026-07-11-csv-output-flag/events.jsonl` — `ralph.end` WI-1 (iter=1, cost=$0.39), `ralph.end` WI-2 (iter=1, cost=$1.13), `unifier.end` (iter=1, stop=quality-gates-pass, cost=$5.73), `dev-loop.delivered` (files=9, +1436/-2)
- `/home/parso/forge/brain/cycles/_raw/2026-07-11T14-57-10_INIT-2026-07-11-csv-output-flag.md`

## See also

- [[2026-06-21-json-output-flag-delivery]] — `--csv` extends the `--json` symmetric renderer-pair pattern
- [[2026-06-21-acceptance-gate-covers-only-headline-output]] — this delivery extended the read-back acceptance gate
- [[2026-07-11-tags-command-delivery]] — tags reuses the CSV renderer family (tagsToCSV)
