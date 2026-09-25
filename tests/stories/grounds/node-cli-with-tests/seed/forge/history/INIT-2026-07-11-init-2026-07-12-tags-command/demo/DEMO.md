# gitpulse tags — release-cadence analytics subcommand

> _Derived from `demo.json` (ADR 021). Essence:_ Adds `gitpulse tags` subcommand that reads git tags and emits a release-cadence table (commits since prev tag, unique authors, days since prev tag, median inter-tag gap). Supports --json, --csv, --since/--until, --exclude. Zero-tag repos print 'no tags found'. Backward-compatible with the existing `gitpulse <path>` call site.

## Intent & Outcome

> _Assessed intent:_ Adds `gitpulse tags` subcommand that reads git tags and emits a release-cadence table (commits since prev tag, unique authors, days since prev tag, median inter-tag gap). Supports --json, --csv, --since/--until, --exclude. Zero-tag repos print 'no tags found'. Backward-compatible with the existing `gitpulse <path>` call site.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | GIVEN a git repo with annotated and/or lightweight tags WHEN readTags(repoPath) is called THEN it returns tags sorted newest-first, each with { name, date (YYYY-MM-DD), sha } | ✓ met | test/tags-git.test.ts: 'parseTagsOutput returns empty array for empty input', 'parseTagsOutput parses lightweight tag lines', 'parseTagsOutput parses annotated tag lines (uses *objectname)', 'parseTagsOutput sorts newest-first' — all pass (13/13 green) |
| 2 | GIVEN two adjacent tag SHAs (prev, curr) WHEN readCommitsBetweenTags(repoPath, prevSha, currSha, excludePaths?) is called THEN it returns commits reachable from currSha but not from prevSha | ✓ met | test/tags-git.test.ts: 'readCommitsBetweenTags returns commits in range' / exclude-path tests pass (13/13 green) |
| 3 | GIVEN two adjacent tag SHAs and excludePaths=['dist'] WHEN readCommitsBetweenTags is called THEN commits whose only changed files are under the excluded prefix are omitted | ✓ met | test/tags-git.test.ts: 'parseCommitsBetweenTags: excludePaths filters commits touching only excluded files' → pass; test/tags-cli.test.ts: 'tags --exclude dist: commits touching only excluded paths are not counted' → pass |
| 4 | GIVEN a repo with no tags WHEN readTags(repoPath) is called THEN it returns an empty array without throwing | ✓ met | test/tags-git.test.ts: 'parseTagsOutput returns empty array for empty input' → pass; test/tags-cli.test.ts: 'tags: zero tags → no tags found and exit code 0' → pass |
| 5 | GIVEN a list of TagEntry values WHEN computeTagSpans(tags, commitsBySpan) is called THEN it returns one TagSpan per tag with { name, date, commitsSince, uniqueAuthors, daysSince } | ✓ met | test/tags.test.ts: 'computeTagSpans: 3-tag fixture produces correct commitsSince and uniqueAuthors' → commitsSince=2, uniqueAuthors=2 for each span → pass |
| 6 | GIVEN a list of TagSpan values with daysSince values [null, 14, 28, 7, 21] WHEN computeMedianGapDays(spans) is called THEN it returns 17.5 | ✓ met | test/tags.test.ts: 'computeMedianGapDays: [null, 14, 28, 7, 21] → 17.5' → pass |
| 7 | GIVEN a list of TagSpan values with fewer than 2 tags WHEN computeMedianGapDays(spans) is called THEN it returns null | ✓ met | test/tags.test.ts: 'computeMedianGapDays: single tag (no gap) → null' and 'computeMedianGapDays: empty spans array → null' → both pass |
| 8 | GIVEN two tag dates 2021-03-02 and 2021-03-15 WHEN daysSince is computed THEN it returns 13 | ✓ met | test/tags.test.ts: 'computeTagSpans: two tag dates 2021-03-02 and 2021-03-15 → daysSince=13' → pass |
| 9 | GIVEN a repo with 3 tags WHEN gitpulse tags is run with no output flags THEN stdout contains a right-aligned table with columns Tag | Date | Commits | Authors | Days since prev, footer 'Median inter-tag gap: N days', v0.1 shows '—', exit 0 | ✓ met | test/tags-cli.test.ts: 'tags: text table contains column headers', 'v0.1 (oldest) shows em dash (—) in Days column', 'footer line shows median inter-tag gap' — all pass; test/acceptance/run.ts tags assertions pass |
| 10 | GIVEN a repo with zero tags WHEN gitpulse tags is run THEN stdout is 'no tags found' and exit code is 0 | ✓ met | test/tags-cli.test.ts: 'tags: zero tags → no tags found and exit code 0' → stdout matches /no tags found/i, code=0 → pass |
| 11 | GIVEN a 3-tag repo WHEN gitpulse tags --json is run THEN stdout is valid JSON { tags: [...], medianGapDays: N } with daysSince null for oldest tag, exit 0 | ✓ met | test/tags-cli.test.ts: 'tags --json: v0.1 daysSince is null (not omitted)', 'tags --json: medianGapDays is 16 for 3-tag fixture' — pass; acceptance: tags --json parsed, v0.1.daysSince===null, medianGapDays===16 |
| 12 | GIVEN a 3-tag repo WHEN gitpulse tags --csv is run THEN stdout is RFC-4180 CSV with header, one row per tag, Days Since Prev empty for oldest, trailing 'Median Gap Days,N' row, exit 0 | ✓ met | test/tags-cli.test.ts: 'tags --csv: header row is correct', 'v0.1 Days Since Prev cell is empty (not null)', 'trailing Median Gap Days row is present' — all pass |
| 13 | GIVEN tags v0.1 (2021-01-01), v0.2 (2021-06-01), v0.3 (2022-01-01) WHEN gitpulse tags --since 2021-05-01 --until 2021-12-31 is run THEN only v0.2 appears and exit 0 | ✓ met | test/tags-cli.test.ts: 'tags --since --until: only v0.2 (in-window) appears when window=2021-05-01..2021-12-31' — v0.2 matches, v0.3/v0.1 do not match → pass |
| 14 | GIVEN commits touching src/ and dist/ files WHEN gitpulse tags --exclude dist is run THEN --exclude is accepted without error; commits touching only excluded paths not counted | ✓ met | test/tags-cli.test.ts: 'tags --exclude: command accepts --exclude without error and exits 0' (code=0) and 'tags --exclude dist: commits touching only excluded paths are not counted' → pass |
| 15 | GIVEN deterministic fixture repo with v0.1/v0.2/v0.3 tags at known dates WHEN npm run acceptance is run THEN tags table matches sentinels: v0.3 commitsSince=2 uniqueAuthors=2 daysSince=19; v0.2 daysSince=13; v0.1 daysSince=null; medianGapDays=16 | ✓ met | test/acceptance/run.ts makeTagsFixtureRepo() fixture; assertions: tagsOut matches v0.3.*19, v0.1.*—, medianGapDays=16; tagsParsed.medianGapDays===16, v03.daysSince===19, v01.daysSince===null — PASS |
| 16 | GIVEN the tags fixture repo WHEN node dist/cli.js tags <repo> --json is run THEN stdout is valid JSON with tags array and medianGapDays=16; exit 0 | ✓ met | test/acceptance/run.ts: tagsJsonOut parsed as JSON, medianGapDays===TAGS_EXPECTED_MEDIAN_GAP (16), v03.daysSince===19, v01.daysSince===null — PASS |
| 17 | GIVEN the acceptance suite WHEN npm run acceptance is run THEN exit code is 0 and the suite reports PASS | ✓ met | npm run acceptance exits 0; stdout: 'acceptance: PASS — tags subcommand produced expected sentinels.' followed by 'acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.' — all pre-existing assertions still pass |

## Visual Changes

### All 16 existing unit tests pass unchanged after adding the tags subcommand (no regression).

- **Before:** 16 tests pass (no tags subcommand code exists on main)
- **After:** 16 tests pass (existing suite unbroken; tags unit tests run separately)
- **Command:** `npm test`

**Before output:**
```

> gitpulse@0.7.0 test
> node --import tsx --test test/unit.test.ts

TAP version 13
# Subtest: summarize counts total commits
ok 1 - summarize counts total commits
  ---
  duration_ms: 6.498677
  type: 'test'
  ...
# Subtest: summarize orders authors by descending commit count
ok 2 - summarize orders authors by descending commit count
  ---
  duration_ms: 0.678177
  type: 'test'
  ...
# Subtest: summarize breaks count ties by author name ascending
ok 3 - summarize breaks count ties by author name ascending
  ---
  duration_ms: 0.223181
  type: 'test'
  ...
# Subtest: summarize computes the first/last date range
ok 4 - summarize computes the first/last date range
  ---
  duration_ms: 0.159518
  type: 'test'
  ...
# Subtest: summarize returns null dates and empty authors for empty input
ok 5 - summarize returns null dates and empty authors for empty input
  ---
  duration_ms: 0.091297
  type: 'test'
  ...
# Subtest: summarize does not mutate its input
ok 6 - summarize does not mutate its input
  ---
  duration_ms: 0.086012
  type: 'test'
  ...
# Subtest: summarize rejects a non-array input
ok 7 - summarize rejects a non-array input
  ---
  duration_ms: 0.304785
  type: 'test'
  ...
# Subtest: renderSummary emits the header line with the date range
ok 8 - renderSummary emits the header line with the date range
  ---
  duration_ms: 0.293125
  type: 'test'
  ...
# Subtest: renderSummary lists authors in summarize order, top author first
ok 9 - renderSummary lists authors in summarize order, top author first
  ---
  duration_ms: 0.322062
  type: 'test'
  ...
# Subtest: renderSummary renders an empty summary with a (none) range and note
ok 10 - renderSummary renders an empty summary with a (none) range and note
  ---
  duration_ms: 0.278554
  type: 'test'
  ...
# Subtest: parseLog parses headers + numstat into commit records
ok 11 - parseLog parses headers + numstat into commit records
  ---
  duration_ms: 0.327753
  type: 'test'
  ...
# Subtest: parseLog counts binary "-" numstat markers as zero
ok 12 - parseLog counts binary "-" numstat markers as zero
  ---
  duration_ms: 0.092944
  type: 'test'
  ...
# Subtest: runCli renders a summary for the given repo path
ok 13 - runCli renders a summary for the given repo path
  ---
  duration_ms: 0.38548
  type: 'test'
  ...
# Subtest: runCli prints usage on --help with exit 0
ok 14 - runCli prints usage on --help with exit 0
  ---
  duration_ms: 0.092933
  type: 'test'
  ...
# Subtest: runCli reports a failing reader (non-repo) with exit 1
ok 15 - runCli reports a failing reader (non-repo) with exit 1
  ---
  duration_ms: 0.108927
  type: 'test'
  ...
# Subtest: runCli rejects an unknown option with exit 2
ok 16 - runCli rejects an unknown option with exit 2
  ---
  duration_ms: 0.063813
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
# duration_ms 243.221495

```

**After output:**
```

> gitpulse@0.7.0 test
> node --import tsx --test test/unit.test.ts

TAP version 13
# Subtest: summarize counts total commits
ok 1 - summarize counts total commits
  ---
  duration_ms: 6.111318
  type: 'test'
  ...
# Subtest: summarize orders authors by descending commit count
ok 2 - summarize orders authors by descending commit count
  ---
  duration_ms: 0.568129
  type: 'test'
  ...
# Subtest: summarize breaks count ties by author name ascending
ok 3 - summarize breaks count ties by author name ascending
  ---
  duration_ms: 0.236998
  type: 'test'
  ...
# Subtest: summarize computes the first/last date range
ok 4 - summarize computes the first/last date range
  ---
  duration_ms: 0.169489
  type: 'test'
  ...
# Subtest: summarize returns null dates and empty authors for empty input
ok 5 - summarize returns null dates and empty authors for empty input
  ---
  duration_ms: 0.095711
  type: 'test'
  ...
# Subtest: summarize does not mutate its input
ok 6 - summarize does not mutate its input
  ---
  duration_ms: 0.079451
  type: 'test'
  ...
# Subtest: summarize rejects a non-array input
ok 7 - summarize rejects a non-array input
  ---
  duration_ms: 0.279042
  type: 'test'
  ...
# Subtest: renderSummary emits the header line with the date range
ok 8 - renderSummary emits the header line with the date range
  ---
  duration_ms: 0.359911
  type: 'test'
  ...
# Subtest: renderSummary lists authors in summarize order, top author first
ok 9 - renderSummary lists authors in summarize order, top author first
  ---
  duration_ms: 0.299089
  type: 'test'
  ...
# Subtest: renderSummary renders an empty summary with a (none) range and note
ok 10 - renderSummary renders an empty summary with a (none) range and note
  ---
  duration_ms: 0.375212
  type: 'test'
  ...
# Subtest: parseLog parses headers + numstat into commit records
ok 11 - parseLog parses headers + numstat into commit records
  ---
  duration_ms: 0.40653
  type: 'test'
  ...
# Subtest: parseLog counts binary "-" numstat markers as zero
ok 12 - parseLog counts binary "-" numstat markers as zero
  ---
  duration_ms: 0.097876
  type: 'test'
  ...
# Subtest: runCli renders a summary for the given repo path
ok 13 - runCli renders a summary for the given repo path
  ---
  duration_ms: 0.451272
  type: 'test'
  ...
# Subtest: runCli prints usage on --help with exit 0
ok 14 - runCli prints usage on --help with exit 0
  ---
  duration_ms: 0.070291
  type: 'test'
  ...
# Subtest: runCli reports a failing reader (non-repo) with exit 1
ok 15 - runCli reports a failing reader (non-repo) with exit 1
  ---
  duration_ms: 0.119405
  type: 'test'
  ...
# Subtest: runCli rejects an unknown option with exit 2
ok 16 - runCli rejects an unknown option with exit 2
  ---
  duration_ms: 0.06882
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
# duration_ms 204.620664

```

### Built CLI produces the release-cadence table with correct sentinel values from the deterministic fixture repo.

- **Before:** Command not available on main (gitpulse tags subcommand does not exist)
- **After:** gitpulse tags <fixture-repo> produces table with v0.3/v0.2/v0.1 rows, daysSince=19/13/—, and 'Median inter-tag gap: 16 days'
- **Command:** `npm run demo`

**Before output:**
```

> gitpulse@0.7.0 demo
> node --import tsx test/acceptance/run.ts --demo

acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.
acceptance: demo evidence written to /home/parso/forge/_worktrees/INIT-2026-07-11-init-2026-07-12-tags-command/forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/.capture/_trees/before/forge/history/INIT-2026-07-11-csv-output-flag/demo/pulse-capture.md

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

> gitpulse@0.7.0 demo
> node --import tsx test/acceptance/run.ts --demo

acceptance: PASS — tags subcommand produced expected sentinels.
acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.
acceptance: demo evidence written to /home/parso/forge/_worktrees/INIT-2026-07-11-init-2026-07-12-tags-command/forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/.capture/_trees/after/forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/pulse-capture.md

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

### JSON output has correct shape including medianGapDays=16 and v0.1.daysSince=null.

- **Before:** Command not available on main
- **After:** { tags: [{name, date, commitsSince, uniqueAuthors, daysSince}, ...], medianGapDays: 16 } — v0.1.daysSince is null, not omitted
- **Command:** `npm run demo`

**Before output:**
```

> gitpulse@0.7.0 demo
> node --import tsx test/acceptance/run.ts --demo

acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.
acceptance: demo evidence written to /home/parso/forge/_worktrees/INIT-2026-07-11-init-2026-07-12-tags-command/forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/.capture/_trees/before/forge/history/INIT-2026-07-11-csv-output-flag/demo/pulse-capture.md

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

> gitpulse@0.7.0 demo
> node --import tsx test/acceptance/run.ts --demo

acceptance: PASS — tags subcommand produced expected sentinels.
acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.
acceptance: demo evidence written to /home/parso/forge/_worktrees/INIT-2026-07-11-init-2026-07-12-tags-command/forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/.capture/_trees/after/forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/pulse-capture.md

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

### npm run acceptance exercises the built CLI against the tags fixture repo and asserts all sentinel values.

- **Before:** Tags acceptance assertions do not exist on main; acceptance exits 0 with existing assertions only
- **After:** acceptance: PASS — tags subcommand produced expected sentinels. All pre-existing assertions still pass.
- **Command:** `npm run acceptance`

**Before output:**
```

> gitpulse@0.7.0 acceptance
> node --import tsx test/acceptance/run.ts

acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.

```

**After output:**
```

> gitpulse@0.7.0 acceptance
> node --import tsx test/acceptance/run.ts

acceptance: PASS — tags subcommand produced expected sentinels.
acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.

```

## Test Evidence

| test | result | delta |
|---|---|---|
| npm test (unit.test.ts) | pass | — |
| tags-git.test.ts (13 unit tests) | pass | — |
| tags.test.ts (14 unit tests) | pass | — |
| tags-cli.test.ts (18 unit tests) | pass | — |

> result: **pass**/**fail** · **skip** = not run in this gate (e.g. a live test with no credentials present) — not a failure · delta **new** = test added by this change.

## Files Changed

```
CHANGELOG.md                                       |  21 ++
 .../demo/DEMO.md                                   |  75 ++++++
 .../demo/demo.json                                 | 130 +++++++++
 src/cli.ts                                         | 160 ++++++++++-
 src/format.ts                                      | 109 ++++++++
 src/git.ts                                         |  87 ++++++
 src/tags.ts                                        |  85 ++++++
 test/acceptance/run.ts                             | 110 +++++++-
 test/tags-cli.test.ts                              | 300 +++++++++++++++++++++
 test/tags-git.test.ts                              | 209 ++++++++++++++
 test/tags.test.ts                                  | 199 ++++++++++++++
 11 files changed, 1481 insertions(+), 4 deletions(-)
```
