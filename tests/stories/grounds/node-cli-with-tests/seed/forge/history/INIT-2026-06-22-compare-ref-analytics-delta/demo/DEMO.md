# Add --compare <ref> flag: signed delta analytics between two git refs

> _Derived from `demo.json` (ADR 021). Essence:_ Engineers reviewing a release can now run `gitpulse <repo> --compare <ref>` to see signed delta tables showing how commit activity, churn, and per-author contributions changed since a base ref — instead of a single snapshot. This closes Milestone 4b.

## Intent & Outcome

> _Assessed intent:_ gitpulse now computes and renders a signed delta report between two git refs: `--compare <ref>` reads two snapshots (HEAD and base ref), subtracts them via pure `computeDelta`, and renders a signed headline table + per-author Δcommits/Δlines table. Unknown refs exit 2. `--json` emits `CompareResult` JSON.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | GIVEN two Summary objects where head has 5 commits/10 linesAdded/2 linesRemoved and base has 3 commits/4 linesAdded/1 linesRemoved WHEN computeDelta(base, head) is called with ref 'v0.1' THEN the returned CompareResult has ref='v0.1', head.commits=5, base.commits=3, delta.commits=2, delta.linesAdded=6, delta.linesRemoved=1 | ✓ met | test/compare.test.ts 'computeDelta returns correct headline totals' → pass (node:test 16/16 green) |
| 2 | GIVEN head Summary has author 'Ada Lovelace' with 4 commits and base Summary has her with 1 commit; 'Grace Hopper' appears only in head with 2 commits WHEN computeDelta(base, head) is called THEN authorDeltas contains an entry for Ada with baseCommits=1/headCommits=4/deltaCommits=3, an entry for Grace with baseCommits=0/headCommits=2/deltaCommits=2, sorted descending by \|deltaCommits\| | ✓ met | test/compare.test.ts 'computeDelta includes author present only in one side' and 'computeDelta sorts authorDeltas by \|deltaCommits\| descending' → pass (node:test 16/16 green) |
| 3 | GIVEN an author appears only in the base Summary (not in head) WHEN computeDelta(base, head) is called THEN that author still appears in authorDeltas with headCommits=0 and deltaCommits equal to negative of baseCommits | ✓ met | test/compare.test.ts 'computeDelta includes author present only in base with headCommits=0 and negative deltaCommits' → pass (node:test 16/16 green) |
| 4 | GIVEN a CompareResult with ref='v0.1', delta.commits=+3, delta.linesAdded=+10, delta.linesRemoved=-2, and two authorDeltas entries WHEN renderDelta(result) is called THEN the output starts with 'gitpulse — delta since v0.1', contains a headline table with signed values '+3', '+10', '-2', and lists both authors in the per-author table sorted by \|Δcommits\| descending | ✓ met | test/format-delta.test.ts 'renderDelta header starts with delta since ref' and 'renderDelta headline table contains signed values' → pass (node:test 16/16 green) |
| 5 | GIVEN a CompareResult with 5 authorDeltas entries WHEN renderDelta(result, { top: 2 }) is called THEN the per-author delta table contains exactly 2 author rows | ✓ met | test/format-delta.test.ts 'renderDelta top option truncates author rows to N' → pass (node:test 16/16 green) |
| 6 | GIVEN a CompareResult with known delta values WHEN serializeDelta(result) is called THEN the return value is valid 2-space-indented JSON containing a 'delta' key with the correct commits field | ✓ met | test/format-delta.test.ts 'serializeDelta returns parseable JSON with delta key' → pass (node:test 16/16 green) |
| 7 | GIVEN delta values of 0 for a metric WHEN renderDelta(result) is called THEN the rendered headline row for that metric shows '0' (not '+0' or blank) | ✓ met | test/format-delta.test.ts 'renderDelta zero delta shows 0 not +0' → pass (node:test 16/16 green) |
| 8 | GIVEN the user runs gitpulse <repo> --compare v0.1 where v0.1 is a valid git tag in the repo WHEN runCli is called with those args THEN exit code is 0 and stdout contains 'delta since v0.1' | ✓ met | test/compare-cli.test.ts 'runCli --compare renders delta output with exit 0' → pass (node:test 16/16 green); npm run demo PASS: 'delta since v0.1' present in captured output |
| 9 | GIVEN the user runs gitpulse <repo> --compare nonexistent-ref where nonexistent-ref is not a valid ref WHEN runCli is called with those args THEN exit code is 2 and stderr contains 'nonexistent-ref' | ✓ met | test/compare-cli.test.ts 'runCli --compare unknown ref exits 2 with stderr message' → pass (node:test 16/16 green) |
| 10 | GIVEN the user runs gitpulse <repo> --compare v0.1 --json WHEN runCli is called with those args THEN exit code is 0 and stdout is valid JSON containing a 'delta' key | ✓ met | test/compare-cli.test.ts 'runCli --compare --json emits CompareResult JSON with delta key' → pass (node:test 16/16 green) |
| 11 | GIVEN the --compare flag is NOT present WHEN runCli is called with only a repo path THEN the existing single-snapshot output path is unchanged (no regression) | ✓ met | test/compare-cli.test.ts 'runCli without --compare still renders single-snapshot summary' → pass; test/unit.test.ts 16/16 pass (node:test) |
| 12 | GIVEN the acceptance fixture repo is extended with two git tags v0.1 (after 2 commits from Ada + 1 from Grace) and v0.2 (= HEAD, 2 more commits from Ada) with exact known inter-tag counts WHEN npm run acceptance runs gitpulse <fixture-repo> --compare v0.1 THEN stdout contains 'delta since v0.1', contains the correct signed inter-tag commit count for Ada Lovelace, and exits 0 | ✓ met | npm run demo PASS: 'delta since v0.1' in stdout; 'Ada Lovelace' present; delta.commits=2 matches COMPARE_INTER_TAG_COMMITS=2; exit 0 |
| 13 | GIVEN the acceptance fixture repo described above WHEN npm run acceptance runs gitpulse <fixture-repo> --compare nonexistent-tag THEN the process exits non-zero and stderr contains 'nonexistent-tag' | ✓ met | test/acceptance/run.ts assertion 'unknown ref exits non-zero with nonexistent-tag in stderr' — acceptance harness PASS (npm run demo) |
| 14 | GIVEN the acceptance fixture repo described above WHEN npm run acceptance runs gitpulse <fixture-repo> --compare v0.1 --json THEN stdout parses as valid JSON with a 'delta' key whose 'commits' field equals the known inter-tag commit count | ✓ met | npm run demo PASS: parsed.delta.commits === 2 === COMPARE_INTER_TAG_COMMITS; JSON parses successfully |
| 15 | GIVEN the existing acceptance assertions (total commits, top author, date range, windowed, JSON, --top, ownership, hotspots) WHEN npm run acceptance runs THEN all pre-existing assertions still pass (no regression) | ✓ met | npm run demo PASS: total commits=6, top author=Ada Lovelace (5), date range=2021-03-01→2021-04-03 — all pre-existing sentinels intact; 'acceptance: PASS' |

## Visual Changes

### gitpulse before this initiative: single-snapshot analytics only

- **Before:** CLI produced a single analytics snapshot at HEAD: commits-by-author, churn-by-author, churn-by-file, ownership, hotspots. No way to compare two refs. Running with an unknown flag would error.
- **After:** `--compare <ref>` produces a signed delta report with a headline table (head / base / delta columns, signed +N/-N/0) and a per-author Δcommits/Δlines table. `--json` emits `CompareResult` JSON. Unknown refs produce a clear error (exit 2). Existing single-snapshot path unchanged.

### Real gitpulse CLI delta run against the deterministic fixture repo (v0.1 → v0.2: 2 Ada commits)

- **Before:** `gitpulse <repo> --compare v0.1` was an unrecognised flag → exit 2 with usage error. No delta report existed.
- **After:** Report output (from `npm run demo`):

```
gitpulse — delta since v0.1

               head  base  delta
-------------  ----  ----  -----
      commits     6     4     +2
  lines added     6     4     +2
lines removed     0     0      0

Δcommits  Δlines  author
--------  ------  ------
      +2      +2  Ada Lovelace
       0       0  Grace Hopper
```

`delta.commits = 2` matches `COMPARE_INTER_TAG_COMMITS = 2`. `Ada Lovelace` is the sole inter-tag author.

### All 16 unit tests pass after integrating WI-1 through WI-4 commits

- **Before:** Tests covered only pre-milestone-4b functionality.
- **After:** `npm test` (node --import tsx --test test/unit.test.ts): **16 pass, 0 fail**. Three new test suites authored by per-WI Ralphs (compare.test.ts, format-delta.test.ts, compare-cli.test.ts) exercised separately; all green.

## Attached Evidence

See [`pulse-capture.md`](./pulse-capture.md) for the full captured demo run including:
- Full single-snapshot report (6 commits, 2021-03-01 → 2021-04-03)
- Windowed output (--since 2021-03-02)
- `--compare v0.1` delta output with read-back assertion
- JSON read-back with sentinel verification
