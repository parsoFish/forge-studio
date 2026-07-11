---
title: --sort flag delivered via sortRecords helper + column registry; single code path before any renderer
description: >-
  Global --sort <column>[:asc|:desc] added to all gitpulse subcommands via
  src/sort.ts (sortRecords + COLUMNS registry). Sort applied to record arrays
  before any renderer; 3-WI TDD chain, all 1-iter, unifier 1-iter.
category: pattern
keywords:
  - sort-flag
  - column-registry
  - single-code-path
  - pure-module
  - tdd
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

# `--sort` flag: delivery pattern

## What was built

- `src/sort.ts`: `sortRecords<T>(records, column, direction)` comparator (numeric vs. string detection, stable sort); `COLUMNS` registry per command slug; `NUMERIC_COLUMNS` set for default-direction logic.
- `src/cli.ts`: `--sort <column>[:asc|:desc]` parsed; invalid column → stderr + exit 2; sorting called on the computed record array **before** text/JSON/CSV renderers.
- `test/sort.test.ts`: unit tests for comparator (numeric, string, stable, direction).
- `test/cli-sort.test.ts`: CLI integration tests (flag parsing, validation errors, direction defaults).
- `test/acceptance/run.ts`: extended with `--sort` assertions across subcommands.

## WI decomposition

- WI-1 (`src/sort.ts` + `test/sort.test.ts`): 1 iter. Gate: `node --test test/sort.test.ts`. 3 files, +321 lines.
- WI-2 (CLI wiring + `test/cli-sort.test.ts`): 1 iter. Gate: `node --test test/cli-sort.test.ts`. 3 files, +311/−3 lines.
- WI-3 (acceptance fixture extension): 1 iter. Gate: `npm run acceptance`. 3 files, +236/−4 lines.
- Unifier: 1 iter. 9 files total, +1220/−4 lines.

## Design decisions

- Sort applied once, at the record-array level — no per-format branches.
- Numeric columns detected by `NUMERIC_COLUMNS` set in `sort.ts` (not runtime typeof) for predictability.
- Default direction: numeric → `desc`, text → `asc` — matches existing per-command conventions.
- No new runtime dependencies; uses `Array.prototype.sort` with a custom comparator.

## Sources

- `_logs/2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag/events.jsonl`
- `/home/parso/forge/brain/cycles/_raw/2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag.md`
