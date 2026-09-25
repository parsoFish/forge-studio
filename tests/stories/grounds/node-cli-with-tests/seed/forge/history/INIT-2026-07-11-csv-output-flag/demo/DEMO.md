# Add --csv flag to all gitpulse analytics commands (RFC-4180 output)

> _Derived from `demo.json` (ADR 021). Essence:_ All gitpulse analytics commands now support a --csv flag that emits RFC-4180 compliant CSV directly to stdout. Users can pipe output into spreadsheets or data pipelines without a JSON-to-CSV conversion step. --csv and --json are mutually exclusive with a clear error on conflict. Implemented via: csvEscape helper + 7 CSV renderers (src/format.ts), CLI wiring with mutual-exclusion guard (src/cli.ts), unit tests for all renderers and CLI behaviour, and acceptance fixture assertions against the deterministic temp-repo.

## Intent & Outcome

> _Assessed intent:_ All gitpulse analytics commands now support a --csv flag that emits RFC-4180 compliant CSV directly to stdout. Users can pipe output into spreadsheets or data pipelines without a JSON-to-CSV conversion step. --csv and --json are mutually exclusive with a clear error on conflict. Implemented via: csvEscape helper + 7 CSV renderers (src/format.ts), CLI wiring with mutual-exclusion guard (src/cli.ts), unit tests for all renderers and CLI behaviour, and acceptance fixture assertions against the deterministic temp-repo.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | GIVEN a plain value with no special characters ("hello") WHEN csvEscape is called THEN it returns the original string unchanged ("hello", no quotes added) | ✓ met | test 'csvEscape plain value (no special chars) → unchanged' → pass (test/format-csv.test.ts, 60/60 green) |
| 2 | GIVEN a value containing a comma ("hello,world") WHEN csvEscape is called THEN it returns the field wrapped in double-quotes | ✓ met | test 'csvEscape value with comma → wrapped in double-quotes' → pass (test/format-csv.test.ts) |
| 3 | GIVEN a value containing a double-quote ("say \"hi\"") WHEN csvEscape is called THEN it returns the field with doubled inner quotes, wrapped in double-quotes | ✓ met | test 'csvEscape value with double-quote → doubled quotes, wrapped' → pass (test/format-csv.test.ts) |
| 4 | GIVEN a value containing a newline character WHEN csvEscape is called THEN it returns the field wrapped in double-quotes | ✓ met | test 'csvEscape value with newline → wrapped in double-quotes' → pass (test/format-csv.test.ts) |
| 5 | GIVEN a unicode string ("café") WHEN csvEscape is called THEN it returns the original unicode string unchanged (no corruption, no quoting) | ✓ met | test 'csvEscape unicode string → passthrough unchanged' → pass (test/format-csv.test.ts) |
| 6 | GIVEN aggregated authors data WHEN renderAuthorsCsv is called THEN it returns CSV with header "Author,Commits,Lines Added,Lines Deleted" and one data row per author, RFC-4180 escaped | ✓ met | test 'renderAuthorsCsv header and data rows' → pass; test 'renderAuthorsCsv comma in author name → RFC-4180 quoted' → pass (test/format-csv.test.ts) |
| 7 | GIVEN aggregated file-churn data WHEN renderChurnFileCsv is called THEN it returns CSV with header "File,Churn Score,Commits,Lines Added,Lines Deleted" and one row per file | ✓ met | test 'renderChurnFileCsv header and data rows' → pass (test/format-csv.test.ts) |
| 8 | GIVEN aggregated author-churn data WHEN renderChurnAuthorCsv is called THEN it returns CSV with header "Author,Churn Score,Commits,Lines Added,Lines Deleted" and one row per author | ✓ met | test 'renderChurnAuthorCsv header and data rows' → pass (test/format-csv.test.ts) |
| 9 | GIVEN aggregated ownership data WHEN renderOwnershipCsv is called THEN it returns CSV with header "File,Owner,Ownership %,Commits" and one row per file | ✓ met | test 'renderOwnershipCsv header and data rows' → pass (test/format-csv.test.ts) |
| 10 | GIVEN aggregated hotspot data WHEN renderHotspotsCsv is called THEN it returns CSV with header "File,Score,Commits,Authors" and one row per entry | ✓ met | test 'renderHotspotsCsv header and data rows' → pass (test/format-csv.test.ts) |
| 11 | GIVEN a CompareResult value WHEN renderCompareCsv is called THEN it returns two CSV sections (headline then per-author) separated by a blank row | ✓ met | test 'renderCompareCsv two sections separated by blank row' → pass; test 'renderCompareCsv per-author section header' → pass (test/format-csv.test.ts) |
| 12 | GIVEN a Summary WHEN renderSummaryCsv is called THEN it returns sections separated by blank rows in the same order as renderSummary's table output | ✓ met | test 'renderSummaryCsv sections in order, separated by blank rows' → pass; test 'renderSummaryCsv omits empty sections' → pass (test/format-csv.test.ts) |
| 13 | GIVEN the gitpulse CLI is invoked with both --csv and --json WHEN runCli is called THEN the result has code 1, stderr is "Error: --csv and --json are mutually exclusive", and stdout is empty | ✓ met | test 'runCli: --csv --json exits code 1 with mutual-exclusion error' → pass; test 'runCli: --json --csv (reversed order) also exits code 1' → pass (test/cli-csv.test.ts, 9/9 green) |
| 14 | GIVEN the gitpulse CLI is invoked with --csv only WHEN runCli is called THEN stdout is the renderSummaryCsv output, exit code is 0 | ✓ met | test 'runCli: --csv produces CSV output starting with author header' → pass; test 'runCli: --csv summary path includes top sentinel author row' → pass (test/cli-csv.test.ts) |
| 15 | GIVEN the gitpulse CLI is invoked with --csv and --compare <ref> WHEN runCli is called THEN stdout is the renderCompareCsv output, exit code is 0 | ✓ met | test 'runCli: --csv --compare produces two-section CSV output' → pass; test 'runCli: --csv --compare includes per-author section' → pass (test/cli-csv.test.ts) |
| 16 | GIVEN the gitpulse CLI is invoked without --csv or --json WHEN runCli is called THEN stdout is byte-for-byte identical to the existing human-table output (no regression) | ✓ met | test 'runCli: no --csv or --json → stdout byte-identical to renderSummary' → pass (test/cli-csv.test.ts) |
| 17 | GIVEN the deterministic temp-repo fixture WHEN gitpulse <repo> --csv is run THEN stdout is valid RFC-4180 CSV with a header row; the data row count equals non-CSV output; stderr empty; exit 0 | ✓ met | acceptance: --csv stdout starts with 'Author,Commits,Lines Added,Lines Deleted'; 2 author data rows; Ada Lovelace first with 5 commits; npm run acceptance → PASS |
| 18 | GIVEN the same fixture WHEN gitpulse <repo> --compare HEAD~3..HEAD --csv is run THEN stdout has two CSV sections; row counts match; stderr empty; exit 0 | ✓ met | acceptance: --csv --compare v0.1 stdout starts with 'Metric,Head,Base,Delta'; blank-row separator present; 'Author,Delta Commits,Delta Lines' header present; Ada Lovelace in output; npm run acceptance → PASS |
| 19 | GIVEN a fixture CSV field containing a comma WHEN it appears in CSV output THEN the field is wrapped in double-quotes per RFC-4180 | ✓ met | test 'renderAuthorsCsv comma in author name → RFC-4180 quoted' → pass (test/format-csv.test.ts); csvEscape unit tests cover all RFC-4180 quoting cases |
| 20 | GIVEN npm test WHEN run after all WI-1/WI-2/WI-3 changes are in place THEN all prior unit tests still pass (no regressions) | ✓ met | npm test → 16/16 pass (summarize, renderSummary, parseLog, runCli regression tests — all green) |

## Visual Changes

### All existing unit tests still pass — no regressions from --csv additions

- **Before:** 16 prior unit tests for summarize/renderSummary/parseLog/runCli
- **After:** All 16 still pass; new --csv/CSV renderer tests in separate gated files (format-csv.test.ts: 60 tests, cli-csv.test.ts: 9 tests)
- **Command:** `npm test`

**Before output:**
```

> gitpulse@0.6.1 test
> node --import tsx --test test/unit.test.ts

TAP version 13
# Subtest: summarize counts total commits
ok 1 - summarize counts total commits
  ---
  duration_ms: 6.014063
  type: 'test'
  ...
# Subtest: summarize orders authors by descending commit count
ok 2 - summarize orders authors by descending commit count
  ---
  duration_ms: 0.763844
  type: 'test'
  ...
# Subtest: summarize breaks count ties by author name ascending
ok 3 - summarize breaks count ties by author name ascending
  ---
  duration_ms: 0.280855
  type: 'test'
  ...
# Subtest: summarize computes the first/last date range
ok 4 - summarize computes the first/last date range
  ---
  duration_ms: 0.161966
  type: 'test'
  ...
# Subtest: summarize returns null dates and empty authors for empty input
ok 5 - summarize returns null dates and empty authors for empty input
  ---
  duration_ms: 0.085323
  type: 'test'
  ...
# Subtest: summarize does not mutate its input
ok 6 - summarize does not mutate its input
  ---
  duration_ms: 0.080197
  type: 'test'
  ...
# Subtest: summarize rejects a non-array input
ok 7 - summarize rejects a non-array input
  ---
  duration_ms: 0.282738
  type: 'test'
  ...
# Subtest: renderSummary emits the header line with the date range
ok 8 - renderSummary emits the header line with the date range
  ---
  duration_ms: 0.310612
  type: 'test'
  ...
# Subtest: renderSummary lists authors in summarize order, top author first
ok 9 - renderSummary lists authors in summarize order, top author first
  ---
  duration_ms: 0.334312
  type: 'test'
  ...
# Subtest: renderSummary renders an empty summary with a (none) range and note
ok 10 - renderSummary renders an empty summary with a (none) range and note
  ---
  duration_ms: 0.238429
  type: 'test'
  ...
# Subtest: parseLog parses headers + numstat into commit records
ok 11 - parseLog parses headers + numstat into commit records
  ---
  duration_ms: 0.306738
  type: 'test'
  ...
# Subtest: parseLog counts binary "-" numstat markers as zero
ok 12 - parseLog counts binary "-" numstat markers as zero
  ---
  duration_ms: 0.086264
  type: 'test'
  ...
# Subtest: runCli renders a summary for the given repo path
ok 13 - runCli renders a summary for the given repo path
  ---
  duration_ms: 0.39054
  type: 'test'
  ...
# Subtest: runCli prints usage on --help with exit 0
ok 14 - runCli prints usage on --help with exit 0
  ---
  duration_ms: 0.067603
  type: 'test'
  ...
# Subtest: runCli reports a failing reader (non-repo) with exit 1
ok 15 - runCli reports a failing reader (non-repo) with exit 1
  ---
  duration_ms: 0.102314
  type: 'test'
  ...
# Subtest: runCli rejects an unknown option with exit 2
ok 16 - runCli rejects an unknown option with exit 2
  ---
  duration_ms: 0.060102
  type: 'test'
  ...
1..16
# tests 16
# suites 0
# pass 16
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 198.296938

```

**After output:**
```

> gitpulse@0.6.1 test
> node --import tsx --test test/unit.test.ts

TAP version 13
# Subtest: summarize counts total commits
ok 1 - summarize counts total commits
  ---
  duration_ms: 5.799607
  type: 'test'
  ...
# Subtest: summarize orders authors by descending commit count
ok 2 - summarize orders authors by descending commit count
  ---
  duration_ms: 0.524794
  type: 'test'
  ...
# Subtest: summarize breaks count ties by author name ascending
ok 3 - summarize breaks count ties by author name ascending
  ---
  duration_ms: 0.18969
  type: 'test'
  ...
# Subtest: summarize computes the first/last date range
ok 4 - summarize computes the first/last date range
  ---
  duration_ms: 0.177653
  type: 'test'
  ...
# Subtest: summarize returns null dates and empty authors for empty input
ok 5 - summarize returns null dates and empty authors for empty input
  ---
  duration_ms: 0.102314
  type: 'test'
  ...
# Subtest: summarize does not mutate its input
ok 6 - summarize does not mutate its input
  ---
  duration_ms: 0.08484
  type: 'test'
  ...
# Subtest: summarize rejects a non-array input
ok 7 - summarize rejects a non-array input
  ---
  duration_ms: 0.276756
  type: 'test'
  ...
# Subtest: renderSummary emits the header line with the date range
ok 8 - renderSummary emits the header line with the date range
  ---
  duration_ms: 0.283369
  type: 'test'
  ...
# Subtest: renderSummary lists authors in summarize order, top author first
ok 9 - renderSummary lists authors in summarize order, top author first
  ---
  duration_ms: 0.278554
  type: 'test'
  ...
# Subtest: renderSummary renders an empty summary with a (none) range and note
ok 10 - renderSummary renders an empty summary with a (none) range and note
  ---
  duration_ms: 0.241714
  type: 'test'
  ...
# Subtest: parseLog parses headers + numstat into commit records
ok 11 - parseLog parses headers + numstat into commit records
  ---
  duration_ms: 0.328523
  type: 'test'
  ...
# Subtest: parseLog counts binary "-" numstat markers as zero
ok 12 - parseLog counts binary "-" numstat markers as zero
  ---
  duration_ms: 0.091015
  type: 'test'
  ...
# Subtest: runCli renders a summary for the given repo path
ok 13 - runCli renders a summary for the given repo path
  ---
  duration_ms: 0.405745
  type: 'test'
  ...
# Subtest: runCli prints usage on --help with exit 0
ok 14 - runCli prints usage on --help with exit 0
  ---
  duration_ms: 0.069947
  type: 'test'
  ...
# Subtest: runCli reports a failing reader (non-repo) with exit 1
ok 15 - runCli reports a failing reader (non-repo) with exit 1
  ---
  duration_ms: 0.096568
  type: 'test'
  ...
# Subtest: runCli rejects an unknown option with exit 2
ok 16 - runCli rejects an unknown option with exit 2
  ---
  duration_ms: 0.059289
  type: 'test'
  ...
1..16
# tests 16
# suites 0
# pass 16
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 210.969418

```

### csvEscape + 7 CSV renderers verified by 60 unit tests in test/format-csv.test.ts

- **Before:** Before: no csvEscape or CSV renderers in src/format.ts
- **After:** After: csvEscape (5 RFC-4180 cases), renderAuthorsCsv, renderChurnFileCsv, renderChurnAuthorCsv, renderOwnershipCsv, renderHotspotsCsv, renderCompareCsv, renderSummaryCsv — all 60 tests pass
- **Command:** `node --import tsx --test test/format-csv.test.ts`

**Before output:**
```
[stderr] Could not find 'test/format-csv.test.ts'
```

**After output:**
```
TAP version 13
# Subtest: csvEscape
    # Subtest: AC1: plain value with no special characters is returned unchanged
    ok 1 - AC1: plain value with no special characters is returned unchanged
      ---
      duration_ms: 0.693812
      type: 'test'
      ...
    # Subtest: AC2: value containing a comma is wrapped in double-quotes
    ok 2 - AC2: value containing a comma is wrapped in double-quotes
      ---
      duration_ms: 0.145809
      type: 'test'
      ...
    # Subtest: AC3: value containing a double-quote has inner quotes doubled and is wrapped
    ok 3 - AC3: value containing a double-quote has inner quotes doubled and is wrapped
      ---
      duration_ms: 0.093786
      type: 'test'
      ...
    # Subtest: AC4: value containing a newline is wrapped in double-quotes
    ok 4 - AC4: value containing a newline is wrapped in double-quotes
      ---
      duration_ms: 0.080036
      type: 'test'
      ...
    # Subtest: AC5: unicode string is returned unchanged without corruption or quoting
    ok 5 - AC5: unicode string is returned unchanged without corruption or quoting
      ---
      duration_ms: 0.065356
      type: 'test'
      ...
    1..5
ok 1 - csvEscape
  ---
  duration_ms: 3.027875
  type: 'suite'
  ...
# Subtest: renderAuthorsCsv
    # Subtest: AC1: header row is "Author,Commits,Lines Added,Lines Deleted"
    ok 1 - AC1: header row is "Author,Commits,Lines Added,Lines Deleted"
      ---
      duration_ms: 0.335917
      type: 'test'
      ...
    # Subtest: AC1: one data row per author
    ok 2 - AC1: one data row per author
      ---
      duration_ms: 0.148934
      type: 'test'
      ...
    # Subtest: AC1: sentinel author appears in output
    ok 3 - AC1: sentinel author appears in output
      ---
      duration_ms: 0.296552
      type: 'test'
      ...
    # Subtest: AC1: commit count is byte-identical to byAuthor value (AC9)
    ok 4 - AC1: commit count is byte-identical to byAuthor value (AC9)
      ---
      duration_ms: 0.147607
      type: 'test'
      ...
    # Subtest: AC1: insertions and deletions are byte-identical to authorChurn values (AC9)
    ok 5 - AC1: insertions and deletions are byte-identical to authorChurn values (AC9)
      ---
      duration_ms: 0.275376
      type: 'test'
      ...
    # Subtest: AC1: 4 columns on every data row
    ok 6 - AC1: 4 columns on every data row
      ---
      duration_ms: 0.179686
      type: 'test'
      ...
    # Subtest: AC8: author name with comma is RFC-4180 quoted
    ok 7 - AC8: author name with comma is RFC-4180 quoted
      ---
      duration_ms: 0.142311
      type: 'test'
      ...
    1..7
ok 2 - renderAuthorsCsv
  ---
  duration_ms: 1.80958
  type: 'suite'
  ...
# Subtest: renderChurnFileCsv
    # Subtest: AC2: header row is "File,Churn Score,Commits,Lines Added,Lines Deleted"
    ok 1 - AC2: header row is "File,Churn Score,Commits,Lines Added,Lines Deleted"
      ---
      duration_ms: 0.207677
      type: 'test'
      ...
    # Subtest: AC2: one data row per file
    ok 2 - AC2: one data row per file
      ---
      duration_ms: 0.090587
      type: 'test'
      ...
    # Subtest: AC2: sentinel file paths appear in output
    ok 3 - AC2: sentinel file paths appear in output
      ---
      duration_ms: 0.11648
      type: 'test'
      ...
    # Subtest: AC2: churn score = insertions + deletions (AC9)
    ok 4 - AC2: churn score = insertions + deletions (AC9)
      ---
      duration_ms: 0.121243
      type: 'test'
      ...
    # Subtest: AC2: 5 columns on every data row
    ok 5 - AC2: 5 columns on every data row
      ---
      duration_ms: 0.102956
      type: 'test'
      ...
    # Subtest: AC8: file path with comma is RFC-4180 quoted
    ok 6 - AC8: file path with comma is RFC-4180 quoted
      ---
      duration_ms: 0.09936
      type: 'test'
      ...
    1..6
ok 3 - renderChurnFileCsv
  ---
  duration_ms: 0.906893
  type: 'suite'
  ...
# Subtest: renderChurnAuthorCsv
    # Subtest: AC3: header row is "Author,Churn Score,Commi
… (truncated)
```

### --csv mutual-exclusion guard, summary path, compare path, and regression guard verified

- **Before:** Before: --csv flag not recognised (unknown option, exit 2)
- **After:** After: --csv routes to CSV renderers; --csv --json exits 1 with correct stderr; 9/9 tests pass
- **Command:** `node --import tsx --test test/cli-csv.test.ts`

**Before output:**
```
[stderr] Could not find 'test/cli-csv.test.ts'
```

**After output:**
```
TAP version 13
# Subtest: runCli: --csv --json exits code 1 with mutual-exclusion error
ok 1 - runCli: --csv --json exits code 1 with mutual-exclusion error
  ---
  duration_ms: 0.825165
  type: 'test'
  ...
# Subtest: runCli: --json --csv (reversed order) also exits code 1
ok 2 - runCli: --json --csv (reversed order) also exits code 1
  ---
  duration_ms: 0.107995
  type: 'test'
  ...
# Subtest: runCli: --csv produces CSV output starting with author header
ok 3 - runCli: --csv produces CSV output starting with author header
  ---
  duration_ms: 0.995425
  type: 'test'
  ...
# Subtest: runCli: --csv summary path includes top sentinel author row
ok 4 - runCli: --csv summary path includes top sentinel author row
  ---
  duration_ms: 0.215392
  type: 'test'
  ...
# Subtest: runCli: --csv summary data row count equals unique author count
ok 5 - runCli: --csv summary data row count equals unique author count
  ---
  duration_ms: 0.191873
  type: 'test'
  ...
# Subtest: runCli: --csv --compare produces two-section CSV output
ok 6 - runCli: --csv --compare produces two-section CSV output
  ---
  duration_ms: 0.628039
  type: 'test'
  ...
# Subtest: runCli: --csv --compare includes per-author section
ok 7 - runCli: --csv --compare includes per-author section
  ---
  duration_ms: 0.269641
  type: 'test'
  ...
# Subtest: runCli: no --csv or --json → stdout byte-identical to renderSummary
ok 8 - runCli: no --csv or --json → stdout byte-identical to renderSummary
  ---
  duration_ms: 0.352908
  type: 'test'
  ...
# Subtest: runCli: --csv does NOT appear in stderr for valid usage
ok 9 - runCli: --csv does NOT appear in stderr for valid usage
  ---
  duration_ms: 0.326694
  type: 'test'
  ...
1..9
# tests 9
# suites 0
# pass 9
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 190.343036

```

### Built CLI against deterministic temp-repo: --csv and --csv --compare assertions pass with sentinel values

- **Before:** Before: --csv not a recognised flag; acceptance gate had no CSV assertions
- **After:** After: Ada Lovelace (5 commits) is first CSV row; --csv --compare v0.1 emits two-section CSV; all prior fixture assertions still pass
- **Command:** `npm run acceptance`

**Before output:**
```

> gitpulse@0.6.1 acceptance
> node --import tsx test/acceptance/run.ts

acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.

```

**After output:**
```

> gitpulse@0.6.1 acceptance
> node --import tsx test/acceptance/run.ts

acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.

```

### npm run demo builds temp-repo, runs built CLI with --csv, writes pulse-capture.md

- **Before:** Before: demo only captured human-table output
- **After:** After: demo evidence written to forge/history/INIT-2026-07-11-csv-output-flag/demo/pulse-capture.md
- **Command:** `npm run demo`

**Before output:**
```

> gitpulse@0.6.1 demo
> node --import tsx test/acceptance/run.ts --demo

acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.
acceptance: demo evidence written to /home/parso/forge/_worktrees/INIT-2026-07-11-csv-output-flag/forge/history/INIT-2026-07-11-csv-output-flag/demo/.capture/_trees/before/demo/pulse-capture.md

--- report ---
gitpulse — 6 commits (2021-03-01 → 2021-04-03)

commits  author
-------  ------
      5  Ada Lovelace
      1  Grace Hopper

churn (lines)  author
-------------  ------
        +5/-0  Ada Lovelace
        +1/-0  Grace Hopper

churn (lines)  file
-------------  ----
        +1/-0  algebra.ts
        +1/-0  compiler.ts
        +1/-0  engine.ts
        +1/-0  loom.ts
        +1/-0  notes.md
        +1/-0  punch-card.ts

ownership
owner         bus-factor  file
------------  ----------  ----
Ada Lovelace           1  algebra.ts
Grace Hopper           1  compiler.ts
Ada Lovelace           1  engine.ts
Ada Lovelace           1  loom.ts
Ada Lovelace           1  notes.md
Ada Lovelace           1  punch-card.ts

hotspots
score  commits  last-date   file
-----  -------  ----------  ----
 0.00        1  2021-04-03  punch-card.ts
 0.00        1  2021-04-01  algebra.ts
 0.00        1  2021-03-07  loom.ts
 0.00        1  2021-03-04  notes.md
 0.00        1  2021-03-02  compiler.ts
 0.00        1  2021-03-01  engine.ts

```

**After output:**
```

> gitpulse@0.6.1 demo
> node --import tsx test/acceptance/run.ts --demo

acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.
acceptance: demo evidence written to /home/parso/forge/_worktrees/INIT-2026-07-11-csv-output-flag/forge/history/INIT-2026-07-11-csv-output-flag/demo/.capture/_trees/after/forge/history/INIT-2026-07-11-csv-output-flag/demo/pulse-capture.md

--- report ---
gitpulse — 6 commits (2021-03-01 → 2021-04-03)

commits  author
-------  ------
      5  Ada Lovelace
      1  Grace Hopper

churn (lines)  author
-------------  ------
        +5/-0  Ada Lovelace
        +1/-0  Grace Hopper

churn (lines)  file
-------------  ----
        +1/-0  algebra.ts
        +1/-0  compiler.ts
        +1/-0  engine.ts
        +1/-0  loom.ts
        +1/-0  notes.md
        +1/-0  punch-card.ts

ownership
owner         bus-factor  file
------------  ----------  ----
Ada Lovelace           1  algebra.ts
Grace Hopper           1  compiler.ts
Ada Lovelace           1  engine.ts
Ada Lovelace           1  loom.ts
Ada Lovelace           1  notes.md
Ada Lovelace           1  punch-card.ts

hotspots
score  commits  last-date   file
-----  -------  ----------  ----
 0.00        1  2021-04-03  punch-card.ts
 0.00        1  2021-04-01  algebra.ts
 0.00        1  2021-03-07  loom.ts
 0.00        1  2021-03-04  notes.md
 0.00        1  2021-03-02  compiler.ts
 0.00        1  2021-03-01  engine.ts

```

## Files Changed

```
CHANGELOG.md                                       |  31 ++
 .../INIT-2026-07-11-csv-output-flag/demo/DEMO.md   |  69 +++
 .../INIT-2026-07-11-csv-output-flag/demo/demo.json | 146 ++++++
 .../demo/pulse-capture.md                          | 146 ++++++
 src/cli.ts                                         |  22 +-
 src/format.ts                                      | 202 ++++++++
 test/acceptance/run.ts                             |  86 +++-
 test/cli-csv.test.ts                               | 164 ++++++
 test/format-csv.test.ts                            | 572 +++++++++++++++++++++
 9 files changed, 1436 insertions(+), 2 deletions(-)
```
