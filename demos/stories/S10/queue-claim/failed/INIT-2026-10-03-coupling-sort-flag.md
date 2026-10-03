---
initiative_id: INIT-2026-10-03-coupling-sort-flag
project: gitpulse
project_repo_path: /home/parso/forge-clean-m7e/projects/gitpulse
created_at: '2026-10-03T12:16:01.112Z'
iteration_budget: 4
cost_budget_usd: 2
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: src/sort.ts COLUMNS and NUMERIC_COLUMNS registries
    when: inspected after the change
    then: >-
      CommandSlug includes 'coupling'; COLUMNS.coupling = Set{fileA, fileB,
      coChanges}; NUMERIC_COLUMNS.coupling = Set{coChanges}
  - given: 'a coupling CLI invocation with --sort fileA:asc'
    when: runCouplingCli executes on a fixture with multiple CouplingRow results
    then: >-
      rows in stdout are sorted alphabetically by fileA ascending, not by
      coChanges descending
  - given: a coupling CLI invocation with --sort coChanges (no direction)
    when: runCouplingCli executes
    then: >-
      direction defaults to desc (numeric column convention) and rows are sorted
      by coChanges descending
  - given: a coupling CLI invocation with --sort fileA (no direction)
    when: runCouplingCli executes
    then: >-
      direction defaults to asc (text column convention) and rows are sorted by
      fileA ascending
  - given: a coupling CLI invocation with --sort couplingPct
    when: runCouplingCli parses the flag
    then: exits code 2 with an 'invalid sort column' error message
  - given: a coupling CLI invocation with --sort unknownCol
    when: runCouplingCli parses the flag
    then: exits code 2 with an 'invalid sort column' error message
  - given: a coupling CLI invocation with --sort and --json
    when: runCouplingCli executes
    then: >-
      the JSON output rows appear in the sorted order (sort applied before json
      branch)
  - given: a coupling CLI invocation with --sort and --csv
    when: runCouplingCli executes
    then: >-
      the CSV output rows appear in the sorted order (sort applied before csv
      branch)
  - given: a coupling CLI invocation with --sort and --markdown
    when: runCouplingCli executes
    then: >-
      the markdown output rows appear in the sorted order (sort applied before
      markdown branch)
  - given: a coupling CLI invocation with no --sort flag
    when: runCouplingCli executes
    then: >-
      output is byte-identical to pre-change output (computeCoupling built-in
      sort preserved, sortRecords not called)
  - given: npm test quality gate
    when: run after the change
    then: >-
      all tests pass including new sort unit tests and the coupling sort unit
      assertions; no [no tests to run] vacuous pass
  - given: npm run acceptance gate
    when: run against the built artifact
    then: >-
      at least one --sort assertion on the coupling subcommand passes, verifying
      the built artifact honours the flag
  - given: README.md coupling section
    when: read after the change
    then: >-
      --sort fileA|fileB|coChanges[:asc|:desc] is documented with direction
      defaults and valid column names
title: Add --sort flag to coupling subcommand
worktree_path: /home/parso/forge-clean-m7e/_worktrees/INIT-2026-10-03-coupling-sort-flag
cycle_id: 2026-10-03T12-16-45_INIT-2026-10-03-coupling-sort-flag
flow_id: forge-develop
architect_session_id: 2026-10-03T12-11-22-1ffd265d
architect_cost_usd: 2.1284283999999998
architect_duration_ms: 322044
previous_failure_modes:
  - requeued-from-failed-2026-10-03
specs:
  - WI-1
  - WI-2
flow_version: 2
claim_blocked_clauses: 
---

## Summary

Extend the existing `--sort <column>[:asc|:desc]` infrastructure (src/sort.ts) to cover the `coupling` subcommand. The three sortable columns are `fileA`, `fileB`, `coChanges`. Default direction follows existing convention: numeric → desc, text → asc. `couplingPct` is intentionally excluded from the sortable set; passing it must exit 2.

When `--sort` is absent the output is byte-identical to today (computeCoupling's built-in coChanges-desc sort is not disrupted).

## Changes required

### src/sort.ts
- Add `'coupling'` to `CommandSlug` union.
- Add `COLUMNS.coupling = new Set(['fileA', 'fileB', 'coChanges'])`.
- Add `NUMERIC_COLUMNS.coupling = new Set(['coChanges'])`.

### src/cli.ts — runCouplingCli
- Declare `let sortCol: string | null = null; let sortDir: 'asc' | 'desc' | null = null;`.
- Parse `--sort <value>` the same way other subcommands do (split on `:`, validate column against `COLUMNS.coupling`, validate direction if given, default direction via `NUMERIC_COLUMNS.coupling`).
- Apply `sortRecords(rows, sortCol, resolvedDir)` on the `rows` array **after** `computeCoupling(commits)` and **before** the json/csv/markdown/text render branches.
- Do NOT pass sort parameters into any renderer function; renderers receive pre-sorted rows unchanged.
- `--sort couplingPct` → `code: 2` error (not in COLUMNS.coupling).
- `--sort unknownCol` → `code: 2` error.

### test/
- Unit test: `sortRecords` on `CouplingRow` objects — verify `fileA:asc` produces alphabetical order and `coChanges:desc` (default) produces descending numeric order.
- CLI unit test: `runCouplingCli(['repo', '--sort', 'fileA:asc'], ...)` returns rows sorted by fileA ascending; `--sort couplingPct` returns code 2; `--sort badCol` returns code 2.

### test/acceptance/run.ts
- Add at least one `--sort` assertion on the `coupling` subcommand (e.g. `--sort fileA:asc` produces a different first row than the default `coChanges:desc` order).

### README.md
- Document `--sort fileA|fileB|coChanges[:asc|:desc]` in the coupling section, alongside `--top`, consistent with how tags and authors sections already document `--sort`.

## Not in scope
- Making `couplingPct` sortable.
- Changing `CouplingRow` field names (operator confirmed: keep `fileA`, `fileB`, `coChanges`).
- Any changes to renderer function signatures (sort applied at CLI layer only).
- Changes to other subcommands.
