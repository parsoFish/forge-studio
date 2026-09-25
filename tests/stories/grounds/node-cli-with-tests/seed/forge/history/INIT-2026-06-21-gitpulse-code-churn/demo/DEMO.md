# Milestone 1 — Code churn: per-file churn, per-author churn, and date-window scoping

> _Derived from `demo.json` (ADR 021). Essence:_ The gitpulse CLI now surfaces how much each file and each author changes, not just commit counts. Three new behaviours ship together: (1) per-file churn sorted by total lines changed; (2) per-author insertions and deletions in the report; (3) --since/--until flags that scope all analytics to a date window. This closes Milestone 1 from the project roadmap.

## Intent & Outcome

> _Assessed intent:_ The gitpulse CLI now surfaces how much each file and each author changes, not just commit counts. Three new behaviours ship together: (1) per-file churn sorted by total lines changed; (2) per-author insertions and deletions in the report; (3) --since/--until flags that scope all analytics to a date window. This closes Milestone 1 from the project roadmap.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | GIVEN a Commit[] where two files share identical total-lines-changed WHEN computeChurn() is called THEN the file with the lexically smaller path sorts first (tie-break ascending) | ✓ met | test/churn.test.ts: 'computeChurn sorts by total churn descending, tie-break path ascending' → pass (npm test 16/16 green). Fixture has 4 equal-churn files; compiler.ts appears first (lexicographic), confirmed by npm run acceptance reporting compiler.ts as top-churn file. |
| 2 | GIVEN a Commit[] containing a binary file (numstat `-` for insertions and deletions) WHEN computeChurn() is called THEN the binary file appears in the result with insertions=0 and deletions=0 but commits=1 | ✓ met | test/churn.test.ts: 'computeChurn handles binary files with - numstat' → pass (npm test 16/16 green). Binary file fixture commit carries insertions=0/deletions=0 from parseLog normalisation; computeChurn records commits=1. |
| 3 | GIVEN a Commit[] containing a renamed file (`{old => new}` path syntax) WHEN computeChurn() is called THEN the renamed file is counted as one entry (using the new path) | ✓ met | test/churn.test.ts: 'computeChurn resolves renamed files to new path' → pass (npm test 16/16 green). src/git.ts parseLog strips `{old => new}` brace syntax and keeps new path. |
| 4 | GIVEN an empty Commit[] input WHEN computeChurn() is called THEN an empty array is returned without throwing | ✓ met | test/churn.test.ts: 'computeChurn returns empty array for empty input' → pass (npm test 16/16 green). |
| 5 | GIVEN a Commit[] where Alice has 10 insertions+5 deletions and Bob has 3 insertions+1 deletions WHEN summarize() is called THEN the Summary includes an authorChurn entry for Alice with insertions=10 deletions=5 and one for Bob with insertions=3 deletions=1 | ✓ met | test/author-churn.test.ts: 'summarize computes per-author insertions and deletions' → pass (npm test 16/16 green). summarize() accumulates commit-level insertions/deletions from Commit[] into authorChurn field. |
| 6 | GIVEN a Summary with per-author churn populated WHEN renderSummary() is called THEN the rendered report includes a churn column (lines added / lines removed) alongside the commits column for each author | ✓ met | test/author-churn.test.ts: 'renderSummary includes churn section with +ins/-del per author' → pass (npm test 16/16 green). npm run acceptance confirms real output: '+3/-0  Ada Lovelace', '+1/-0  Grace Hopper' in churn (lines) author table. |
| 7 | GIVEN an empty Commit[] input WHEN summarize() then renderSummary() are called THEN no author churn rows are rendered and no error is thrown | ✓ met | test/author-churn.test.ts: 'summarize and renderSummary handle empty input without error' → pass (npm test 16/16 green). |
| 8 | GIVEN a Commit[] where two authors have equal total lines changed WHEN summarize() is called THEN authorChurn entries are ordered by total churn descending then author name ascending (matching byAuthor ordering) | ✓ met | test/author-churn.test.ts: 'authorChurn ordered by total churn desc then author name asc' → pass (npm test 16/16 green). |
| 9 | GIVEN argv contains `--since 2021-03-03` WHEN runCli() is called with a stub reader returning commits on 2021-03-01 through 2021-03-07 THEN only commits on or after 2021-03-03 are included in the summary (commits before that date are excluded) | ✓ met | test/window.test.ts: '--since filters commits before the given date' → pass (npm test 16/16 green). runCli filters Commit[] by date >= since before passing to summarize. |
| 10 | GIVEN argv contains `--until 2021-03-04` WHEN runCli() is called with a stub reader THEN only commits on or before 2021-03-04 are included (commits after that date are excluded) | ✓ met | test/window.test.ts: '--until filters commits after the given date' → pass (npm test 16/16 green). |
| 11 | GIVEN argv contains both `--since 2021-03-02` and `--until 2021-03-05` WHEN runCli() is called THEN only commits within that inclusive window are included | ✓ met | test/window.test.ts: 'combined --since and --until produces intersection' → pass (npm test 16/16 green). |
| 12 | GIVEN argv contains `--since not-a-date` WHEN runCli() is called THEN exit code 2 and a stderr message indicating an invalid date format | ✓ met | test/window.test.ts: 'invalid date format exits with code 2' → pass (npm test 16/16 green). src/cli.ts validates YYYY-MM-DD regex at argv boundary; returns {code:2, stderr:'...'} on failure. |
| 13 | GIVEN argv contains `--since 2021-03-10` and `--until 2021-03-01` (since after until) WHEN runCli() is called THEN exit code 2 and a stderr message indicating the window is invalid | ✓ met | test/window.test.ts: 'reversed window (since after until) exits with code 2' → pass (npm test 16/16 green). |
| 14 | GIVEN argv contains neither `--since` nor `--until` WHEN runCli() is called THEN all commits are included (existing behaviour unchanged) | ✓ met | test/window.test.ts: 'no date flags includes all commits' → pass (npm test 16/16 green). Existing test/unit.test.ts tests also still pass (16/16). |
| 15 | GIVEN the fixture repo (4 commits, Ada=3, Grace=1, files engine.ts/compiler.ts/notes.md/loom.ts) WHEN `npm run acceptance` builds the CLI and runs it against the fixture repo THEN the output includes a churn section showing the top-churn file with a non-zero insertion count (sentinel: engine.ts or the file with the most lines changed) | ✓ met | npm run acceptance → 'acceptance: PASS'. Captured output (forge/history/INIT-2026-06-21-gitpulse-code-churn/demo/pulse-capture.md): churn (lines) file table shows +1/-0 for compiler.ts, engine.ts, loom.ts, notes.md. |
| 16 | GIVEN the fixture repo with commits spanning 2021-03-01 to 2021-03-07 WHEN `npm run acceptance` runs the CLI with `--since 2021-03-02` THEN the reported total commit count is 3 (the 2021-03-01 commit is excluded) and the date range starts no earlier than 2021-03-02 | ✓ met | npm run acceptance → 'acceptance: PASS'. Windowed output: 'gitpulse — 3 commits (2021-03-02 → 2021-03-07)'. Date starts 2021-03-02 (not before). See pulse-capture.md § Windowed output. |
| 17 | GIVEN the fixture repo with per-author churn data WHEN `npm run acceptance` runs the CLI against the fixture repo THEN Ada Lovelace appears in the author-churn output with non-zero insertions | ✓ met | npm run acceptance → 'acceptance: PASS'. Full report: '+3/-0  Ada Lovelace' in churn (lines) author table. Non-zero insertion confirmed (3 insertions). See pulse-capture.md § Captured output. |
| 18 | GIVEN README.md and roadmap.md WHEN the work item is complete THEN README documents `--since`/`--until` flags and the churn output format; roadmap marks Milestone 1 features as complete | ✓ met | README.md updated: usage line shows [--since YYYY-MM-DD] [--until YYYY-MM-DD], example output includes churn section. roadmap.md: Milestone 1 features 1a/1b/1c marked ✓ shipped. Both files in git diff --name-only main...HEAD. |
| 19 | GIVEN CHANGELOG.md WHEN the work item is complete THEN a `## [Unreleased]` entry exists describing the per-file churn, per-author churn, and --since/--until features | ✓ met | CHANGELOG.md has ## [Unreleased] section with ### Added bullets: per-file churn (src/churn.ts), per-author churn (src/stats.ts + src/format.ts), --since/--until flags (src/cli.ts). File in git diff --name-only main...HEAD. |

## Visual Changes

### CLI run against fixture repo — all 4 commits, no date filter

- **Before:** Report showed only commit counts per author; no churn data, no date filtering
- **After:** Report now shows commit counts AND per-author churn (+3/-0 Ada Lovelace, +1/-0 Grace Hopper) AND per-file churn (compiler.ts, engine.ts, loom.ts, notes.md each with +1/-0)

### CLI run with --since 2021-03-02 — earliest commit (2021-03-01) excluded

- **Before:** No date-window flag existed; all commits always included
- **After:** With --since 2021-03-02: only 3 commits reported (2021-03-02 → 2021-03-07); commit on 2021-03-01 excluded; churn and author tables also scoped to that window

## Test Evidence

| test | result | delta |
|---|---|---|
| npm test (unit suite — test/unit.test.ts) | pass | 16/16 pass, 0 fail |
| npm run acceptance (test/acceptance/run.ts) | pass | PASS — built CLI produced expected commit-stats for fixture repo |

> result: **pass**/**fail** · **skip** = not run in this gate (e.g. a live test with no credentials present) — not a failure · delta **new** = test added by this change.

## Files Changed

```
14 files changed, 996 insertions(+), 70 deletions(-)
```
