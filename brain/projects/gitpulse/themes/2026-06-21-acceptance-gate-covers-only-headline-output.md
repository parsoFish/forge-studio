---
title: Acceptance gate covers only commit-stats headline, not new analytics tables
description: >-
  test/acceptance/run.ts asserts the commit-stats summary output but not the
  ownership or hotspot table sections added in M2; a rendering regression in
  those tables would pass the acceptance gate undetected.
category: antipattern
keywords:
  - acceptance-gate
  - read-back
  - coverage-gap
  - ownership
  - hotspot
  - format
related_themes: [2026-06-21-json-output-flag-delivery, 2026-07-11-csv-output-flag-delivery]
created_at: 2026-06-21T00:00:00.000Z
updated_at: 2026-06-21T00:00:00.000Z
---

# Acceptance gate covers only commit-stats headline, not new analytics tables

## Pattern observed

After WI-4 (ownership + hotspot rendering in `src/format.ts`), the acceptance
gate `npm run acceptance` passed cleanly — because `test/acceptance/run.ts`
only asserts the commit-stats headline section (totals, per-author, date range).

The new `ownership` and `hotspot` table sections are covered only by
`test/format-new.test.ts` (unit tests against in-memory `Summary` objects). The
read-back acceptance gate — which builds the real CLI and runs it against a
deterministic fixture repo — does NOT assert the formatted ownership or hotspot
output.

## Risk

A formatting regression (wrong column names, missing section, incorrect
ordering, broken alignment) in `renderOwnership` or `renderHotspots` would:
- pass `npm run acceptance` ✅
- pass `npm test` ✅ (if unit tests still match the broken format)
- fail only if someone manually reads the CLI output

## Fix

Extend `test/acceptance/run.ts` to assert the ownership and hotspot sections
in the built CLI's stdout. Use the existing fixture repo (Ada Lovelace ×3,
Grace Hopper ×1 commits). Add sentinel assertions that:
1. `ownership` heading is present after churn tables.
2. At least one owner row is present (e.g. `Ada Lovelace`).
3. `hotspots` heading is present after ownership.
4. At least one hotspot row is present (e.g. `engine.ts`).

This follows the established C9 convention: non-default sentinels so a silent
drop/miscount is caught.

## Sources

- `_logs/2026-06-21T04-52-20_INIT-2026-06-21-ownership-hotspots-top-flag/events.jsonl` — `gate.pass` event for WI-4 showing `npm run acceptance` passes; iteration metadata in the `dev-loop.end` for WI-4.
- `/home/parso/forge/brain/cycles/_raw/2026-06-21T04-52-20_INIT-2026-06-21-ownership-hotspots-top-flag.md`
- `projects/gitpulse/test/acceptance/run.ts` — current gate scope.

## See also

- [[2026-06-21-json-output-flag-delivery]] — the `--json` delivery extended this same read-back acceptance gate
- [[2026-07-11-csv-output-flag-delivery]] — the `--csv` delivery also extended the read-back acceptance gate
