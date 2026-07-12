---
title: --json flag added via serializeSummary in format.ts; acceptance gate extended
description: >-
  The --json flag serialises the full Summary struct as stable JSON; unit tests
  cover AC1-AC4; acceptance suite asserts AC5 sentinels against the deterministic
  fixture repo. 2 WIs, 1 iter each, zero wedge.
category: pattern
keywords:
  - json-output
  - serializeSummary
  - format.ts
  - cli.ts
  - acceptance-gate
  - single-iteration
related_themes: [2026-07-11-csv-output-flag-delivery, 2026-06-21-acceptance-gate-covers-only-headline-output]
created_at: 2026-06-21T00:00:00.000Z
updated_at: 2026-06-21T00:00:00.000Z
---

# `--json` flag: delivery pattern

## What was built

- `src/format.ts`: `serializeSummary(s: Summary): string` — `JSON.stringify(s, null, 2)`. Pure function. No transformation needed; `Summary` already matches the documented 8-key shape.
- `src/cli.ts`: `--json` added to arg parser (same pattern as `--top`); `json: boolean` threaded to renderer call; `serializeSummary` called instead of `renderSummary` when `json === true`. USAGE string updated.
- `test/json-output.test.ts`: 22 unit tests via `runCli(['--json', …])` stubs. Asserts `JSON.parse(stdout)` shape (not string match) — robust to whitespace. Covers AC1 (valid JSON, 8 keys), AC3 (errors to stderr), AC4 (unknown flag rejection).
- `test/acceptance/run.ts`: extended with `--json` block: 5 sentinel assertions (totalCommits===4, byAuthor[0].author==='Ada Lovelace', byAuthor[0].commits===3, firstDate==='2021-03-01', lastDate==='2021-03-07') + 8-key shape loop. Closes the acceptance gap for JSON output identified after M2.

## WI decomposition

- WI-1: implementation + unit tests (format.ts + cli.ts + json-output.test.ts). 5 ACs, 1 iter.
- WI-2: acceptance suite extension. 3 ACs, 1 iter.
- Both stop_reason: `quality-gates-pass`.

## Why the symmetric-renderer pair works

`format.ts` owns both human (`renderSummary`) and machine (`serializeSummary`) renderers. Both are pure functions of `Summary`. Single call-site switch in `cli.ts`. Future Summary additions appear in JSON output automatically (additive, no maintenance layer needed).

## Sources

- `_logs/2026-06-21T08-01-50_INIT-2026-06-21-json-output-flag/events.jsonl` — `ralph.end` WI-1 (iter=1, stop=quality-gates-pass), `ralph.end` WI-2 (iter=1, stop=quality-gates-pass), `dev-loop.delivered` (files_changed=8)
- `/home/parso/forge/brain/cycles/_raw/2026-06-21T08-01-50_INIT-2026-06-21-json-output-flag.md`

## See also

- [[2026-07-11-csv-output-flag-delivery]] — `--csv` follows the same symmetric renderer-pair pattern
- [[2026-06-21-acceptance-gate-covers-only-headline-output]] — this delivery closed the JSON acceptance-gate gap
