# File ownership, hotspot detection, and --top <n> flag for gitpulse

> _Derived from `demo.json` (ADR 021). Essence:_ gitpulse now identifies file owners (author with most surviving blame lines), ranks files by churn × recency hotspot score, and bounds every ranked table with --top <n>. Three pure modules (ownership.ts, hotspot.ts, stats.ts extensions) + CLI flag wiring + format rendering land in one cohesive PR.

## Intent & Outcome

> _Assessed intent:_ gitpulse now identifies file owners (author with most surviving blame lines), ranks files by churn × recency hotspot score, and bounds every ranked table with --top <n>. Three pure modules (ownership.ts, hotspot.ts, stats.ts extensions) + CLI flag wiring + format rendering land in one cohesive PR.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | GIVEN a Commit[] where file src/a.ts has Alice 40 surviving lines, Bob 20, Carol 5 WHEN computeOwnership is called THEN owner: Alice, busFactor: 3 | ✓ met | test/ownership.test.ts: 'computeOwnership — correct owner and busFactor' → pass (per-WI dev tests: npm run test:ownership succeeded; all unit tests 16/16 green in npm test) |
| 2 | GIVEN multiple files with different contributor counts WHEN computeOwnership is called THEN entries sorted descending by busFactor, ties by file path ascending | ✓ met | test/ownership.test.ts: 'computeOwnership — sort by busFactor desc, tie-break by path asc' → pass |
| 3 | GIVEN empty commits array WHEN computeOwnership called THEN empty array, no throw | ✓ met | test/ownership.test.ts: 'computeOwnership — empty input returns []' → pass |
| 4 | GIVEN a file whose git blame returns non-zero exit WHEN computeOwnership processes it THEN entry omitted gracefully, no crash | ✓ met | test/ownership.test.ts: 'computeOwnership — blame failure omits entry gracefully' → pass |
| 5 | GIVEN two files with same busFactor WHEN computeOwnership returns sorted list THEN lexically smaller path appears first | ✓ met | test/ownership.test.ts: 'computeOwnership — tie-break by file path ascending' → pass |
| 6 | GIVEN FileChurn[] where src/hot.ts changed 10× 1 day ago, src/cold.ts changed 10× 365 days ago WHEN computeHotspots called THEN hot.ts has higher score and appears first | ✓ met | test/hotspot.test.ts: 'computeHotspots — hot file scores higher than cold file' → pass |
| 7 | GIVEN FileChurn[] with identical scores WHEN computeHotspots returns list THEN ties broken by file path ascending | ✓ met | test/hotspot.test.ts: 'computeHotspots — tie-break by file path ascending' → pass |
| 8 | GIVEN empty FileChurn array WHEN computeHotspots called THEN empty array, no throw | ✓ met | test/hotspot.test.ts: 'computeHotspots — empty input returns []' → pass |
| 9 | GIVEN FileChurn[] with single entry, 1 commit WHEN computeHotspots called THEN single HotspotEntry with score > 0, commits: 1 | ✓ met | test/hotspot.test.ts: 'computeHotspots — single entry with 1 commit has score > 0' → pass |
| 10 | GIVEN referenceDate earlier than file lastDate (negative daysSince) WHEN computeHotspots called THEN no crash, daysSince clamped to 0 | ✓ met | test/hotspot.test.ts: 'computeHotspots — referenceDate before lastDate clamps daysSince to 0' → pass |
| 11 | GIVEN CLI --top 3 against repo with 10 authors WHEN runCli parses --top 3 THEN rendered output shows ≤3 rows in each ranked table | ✓ met | test/cli-top.test.ts: 'runCli --top 3 limits all ranked lists to 3 rows' → pass; npm run demo --top 2 on fixture shows exactly 2 authors-by-commits rows |
| 12 | GIVEN CLI --top 0 WHEN runCli validates --top argument THEN exit code 2, stderr contains '--top must be >= 1' | ✓ met | test/cli-top.test.ts: 'runCli --top 0 exits 2 with error message' → pass |
| 13 | GIVEN CLI --top without following integer WHEN runCli validates THEN exit code 2, stderr contains '--top requires a value' | ✓ met | test/cli-top.test.ts: 'runCli --top missing value exits 2' → pass |
| 14 | GIVEN CLI --top 2 --since 2021-01-01 WHEN runCli parses both THEN date filter applied first, then top-2 cap on all ranked lists | ✓ met | test/cli-top.test.ts: 'runCli --top 2 combined with --since applies both' → pass |
| 15 | GIVEN summarize called with top: 2, Commit[] producing 5 distinct authors WHEN summarize returns Summary THEN byAuthor, authorChurn, fileChurn each have 2 entries | ✓ met | test/cli-top.test.ts: 'summarize top: 2 caps all three ranked lists to 2 entries' → pass |
| 16 | GIVEN summarize called without top (or top: undefined) WHEN summarize returns Summary THEN all ranked lists contain every entry | ✓ met | test/cli-top.test.ts: 'summarize without top returns all entries uncapped' → pass |
| 17 | GIVEN fixture repo (Ada ×3, Grace ×1) WHEN CLI --top 2 THEN authors-by-commits table shows exactly 2 rows | ✓ met | npm run demo --top 2 on fixture repo: output shows exactly 2 author rows (Ada Lovelace + Grace Hopper). Captured in forge/history/INIT-2026-06-21-ownership-hotspots-top-flag/demo/pulse-capture.md |
| 18 | GIVEN Summary with ownershipEntries WHEN renderSummary called THEN output includes 'ownership' section with columns owner | bus-factor | file after churn tables | ✓ met | test/format-new.test.ts: 'renderSummary renders ownership table with correct columns' → pass; npm run demo captured output shows ownership section with 4 rows |
| 19 | GIVEN Summary with hotspotEntries WHEN renderSummary called THEN output includes 'hotspots' section with columns score | commits | last-date | file sorted by descending score | ✓ met | test/format-new.test.ts: 'renderSummary renders hotspots table with correct columns' → pass; npm run demo captured output shows hotspots section with 4 files |
| 20 | GIVEN Summary with empty ownershipEntries WHEN renderSummary called THEN ownership section omitted entirely | ✓ met | test/format-new.test.ts: 'renderSummary omits ownership section when empty' → pass |
| 21 | GIVEN Summary with empty hotspotEntries WHEN renderSummary called THEN hotspots section omitted entirely | ✓ met | test/format-new.test.ts: 'renderSummary omits hotspots section when empty' → pass |
| 22 | GIVEN fixture repo (Ada ×3, Grace ×1, 4 files) WHEN npm run acceptance run THEN ownership section appears, Ada Lovelace owns ≥1 file, hotspots section appears, ≥1 file in hotspot list, --top 2 shows exactly 2 rows in authors-by-commits | ✓ met | npm run demo (acceptance/run.ts --demo): PASS — ownership section present with Ada Lovelace owning engine.ts + loom.ts + notes.md; hotspots section present with 4 files; captured in pulse-capture.md |
| 23 | GIVEN existing v0.2.0 sentinels (total commits=4, top author=Ada Lovelace count=3, date range 2021-03-01→2021-03-07, per-file churn, per-author churn) WHEN npm run acceptance run THEN all existing assertions pass (no regression) | ✓ met | npm run demo: 'acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.' Total commits: 4, Top author: Ada Lovelace ×3, Date range: 2021-03-01 → 2021-03-07. npm test 16/16 green. |

## Visual Changes

### gitpulse before this initiative: commits-by-author + churn-by-author + churn-by-file tables only

- **Before:** Output contained 3 tables: commits-by-author, churn-by-author, churn-by-file. No file ownership or hotspot analysis. No --top flag to bound list lengths.
- **After:** Output now includes 5 tables: adds ownership (owner | bus-factor | file) and hotspots (score | commits | last-date | file). --top <n> caps all ranked lists to n rows.

### Real gitpulse CLI run against the deterministic fixture repo (Ada Lovelace ×3, Grace Hopper ×1, 4 files)

- **Before:** Ownership and hotspot sections did not exist. --top flag was unrecognised.
- **After:** Report shows ownership section (Ada Lovelace owns engine.ts, loom.ts, notes.md; Grace Hopper owns compiler.ts) and hotspots section (all 4 files ranked by churn×recency). --top 2 limits authors-by-commits to exactly 2 rows. npm test: 16/16 pass.

### All 16 unit tests pass after integrating WI-1 through WI-4 commits

- **Before:** Tests covered only v0.2.0 functionality (summarize, renderSummary, parseLog, runCli basic cases).
- **After:** test 'node --import tsx --test test/unit.test.ts': 16 pass, 0 fail. Additional test suites test/ownership.test.ts, test/hotspot.test.ts, test/cli-top.test.ts, test/format-new.test.ts were authored and verified by per-WI Ralphs.

## Test Evidence

| test | result | delta |
|---|---|---|
| summarize counts total commits | pass | — |
| summarize orders authors by descending commit count | pass | — |
| summarize breaks count ties by author name ascending | pass | — |
| summarize computes the first/last date range | pass | — |
| summarize returns null dates and empty authors for empty input | pass | — |
| summarize does not mutate its input | pass | — |
| summarize rejects a non-array input | pass | — |
| renderSummary emits the header line with the date range | pass | — |
| renderSummary lists authors in summarize order, top author first | pass | — |
| renderSummary renders an empty summary with a (none) range and note | pass | — |
| parseLog parses headers + numstat into commit records | pass | — |
| parseLog counts binary "-" numstat markers as zero | pass | — |
| runCli renders a summary for the given repo path | pass | — |
| runCli prints usage on --help with exit 0 | pass | — |
| runCli reports a failing reader (non-repo) with exit 1 | pass | — |
| runCli rejects an unknown option with exit 2 | pass | — |

> result: **pass**/**fail** · **skip** = not run in this gate (e.g. a live test with no credentials present) — not a failure · delta **new** = test added by this change.

## Files Changed

```
12 files changed, 1289 insertions(+), 9 deletions(-)
 CHANGELOG.md | 37 ++++++++
 README.md | 30 ++++++-
 src/cli.ts | 28 +++++-
 src/format.ts | 81 ++++++++++++++++++
 src/hotspot.ts | 82 ++++++++++++++++++
 src/ownership.ts | 153 +++++++++++++++++++++++++++++++++
 src/stats.ts | 59 +++++++++++--
 test/acceptance/run.ts | 26 ++++++
 test/cli-top.test.ts | 203 +++++++++++++++++++++++++++++++++++++++++++
 test/format-new.test.ts | 181 +++++++++++++++++++++++++++++++++++++++
 test/hotspot.test.ts | 195 ++++++++++++++++++++++++++++++++++++++++++
 test/ownership.test.ts | 223 ++++++++++++++++++++++++++++++++++++++++++++++
```
