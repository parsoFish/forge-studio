# Add --no-merges flag: parse parentCount in git.ts and filter merge commits in the CLI

> _Derived from `demo.json` (ADR 021). Essence:_ Prior to this initiative, gitpulse hard-coded `--no-merges` in `LOG_ARGS`, silently excluding every merge commit from all analytics. Now merge commits are included by default (each `Commit` carries a `parentCount` field parsed from `%P`), and callers opt in to filtering via the new `--no-merges` CLI flag, which removes commits with `parentCount > 1`, annotates the text header with `(N merge commits excluded)`, and adds `mergesExcluded` to JSON output.

## Summary

- Removed `--no-merges` from `LOG_ARGS` in `src/git.ts`; merge commits are now included in all analytics by default.
- Added `parentCount: number` field to the `Commit` type, parsed from the `%P` git log format specifier.
- Exported `filterMergeCommits()` pure function from `src/cli.ts` that keeps commits with `parentCount <= 1`.
- Wired `--no-merges` flag into the CLI: filter runs immediately after `readCommits()` and before `summarize()`.
- Text header annotated with `(N merge commits excluded)` when N > 0; JSON output gains `mergesExcluded` field (omitted when absent or N=0).
- Acceptance fixture extended with one real merge commit (two parents); both-mode and byte-identical assertions added.
- README `--no-merges` option documented; CHANGELOG `## [Unreleased]` entry describes the new flag.
- Branch: `forge/INIT-2026-08-28-init-no-merges-flag`
- Commit: `d92b94016accbe8b3871d78cc6f04cb379749cfe`

## Intent & Outcome

> _Assessed intent:_ Prior to this initiative, gitpulse hard-coded `--no-merges` in `LOG_ARGS`, silently excluding every merge commit from all analytics. Now merge commits are included by default (each `Commit` carries a `parentCount` field parsed from `%P`), and callers opt in to filtering via the new `--no-merges` CLI flag, which removes commits with `parentCount > 1`, annotates the text header with `(N merge commits excluded)`, and adds `mergesExcluded` to JSON output.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | GIVEN the git log format string in src/git.ts WHEN a commit with two parents exists in the repo THEN git.ts parses a parentCount >= 2 on that commit record AND the Commit type carries a parentCount: number field | ✓ met | src/git.ts: `LOG_FORMAT` = `'%H%x09%an%x09%ad%x09%P'`; `parseLog()` splits the fourth field on spaces and counts non-empty tokens to set `parentCount`. `Commit` type declares `readonly parentCount: number`. Verified by `test/no-merges.test.ts` AC3 test: raw log with two parent SHAs produces `parentCount === 2`, and AC1 test confirms the field is present and typed `number`. |
| 2 | GIVEN LOG_ARGS in src/git.ts WHEN inspected at runtime THEN the array does NOT contain the string '--no-merges' | ✓ met | `src/git.ts` line 46: `export const LOG_ARGS = ['log', '--numstat', '--date=short', \`--format=\${LOG_FORMAT}\`];` — no `'--no-merges'` element. Directly asserted by `test/no-merges.test.ts` AC2 test: `assert.ok(!LOG_ARGS.includes('--no-merges'))` passes. |
| 3 | GIVEN a raw git log string containing a header line with two parent SHAs in the fourth tab-separated field WHEN parseLog() processes it THEN the returned Commit record has parentCount === 2 | ✓ met | `test/no-merges.test.ts` AC3 test: constructs raw = `'<sha>\tCarol Sentinel\t2024-01-03\t<PARENT_1> <PARENT_2>\n...'`; `parseLog(raw)[0].parentCount` equals `2`. Test passes in the npm test suite. |
| 4 | GIVEN a raw git log string containing a header line with no parents (initial commit, empty %P field) WHEN parseLog() processes it THEN the returned Commit record has parentCount === 0 | ✓ met | `test/no-merges.test.ts` AC4 test: raw with empty fourth field (`'\t'` at end); `parseLog(raw)[0].parentCount` equals `0`. Logic in `parseLog()`: `parts[3].trim().length === 0 ? 0 : ...`. Test passes. |
| 5 | GIVEN a raw git log string containing a header line with exactly one parent WHEN parseLog() processes it THEN the returned Commit record has parentCount === 1 | ✓ met | `test/no-merges.test.ts` AC5 test: raw with single parent SHA in fourth field; `parseLog(raw)[0].parentCount` equals `1`. Test passes. |
| 6 | GIVEN a Commit[] with a mix of commits where parentCount is 0, 1, and 2 respectively WHEN the merge-filter function is applied (filterMergeCommits) THEN only commits with parentCount <= 1 survive AND the excluded count equals the number with parentCount > 1 | ✓ met | `test/no-merges-cli.test.ts` AC1 tests: `filterMergeCommits([COMMIT_INIT, COMMIT_REG, COMMIT_MERGE])` returns `{ filtered: [COMMIT_INIT, COMMIT_REG], excludedCount: 1 }`. Additional test with two merge commits confirms `excludedCount === 2`. All pass. |
| 7 | GIVEN a gitpulse invocation with --no-merges on a repo containing merge commits WHEN readCommits() returns a Commit[] and the filter runs THEN the filter runs immediately after readCommits() and before summarize() and the text output contains '(N merge commits excluded)' when N > 0 | ✓ met | `src/cli.ts` lines 745–751: `filterMergeCommits` is called on `commits` after `applyExclusions` and before `summarize()`. `test/no-merges-cli.test.ts` AC2 test: `runCli(['--no-merges', '/repo'], makeIo(MIXED))` produces stdout containing `'(1 merge commits excluded)'`. AC2 test also confirms Carol Sentinel (merge-only author) is excluded from stats, proving filter precedes summarize. |
| 8 | GIVEN the --help flag is passed WHEN the CLI prints usage THEN the output contains '--no-merges' with a one-line description | ✓ met | `src/cli.ts` USAGE array includes `'  --no-merges            exclude merge commits (commits with >1 parent)'`. `test/no-merges-cli.test.ts` AC3 test: `runCli(['--help'], io)` combined stdout+stderr includes `'--no-merges'`. Test passes. |
| 9 | GIVEN a gitpulse invocation with --no-merges --json on a repo with merge commits WHEN the JSON output is parsed THEN top-level 'mergesExcluded' equals the number of merge commits filtered AND when --no-merges is absent mergesExcluded is not present in the JSON | ✓ met | `test/no-merges-cli.test.ts` AC4 tests: `runCli(['--no-merges', '--json', '/repo'], makeIo(MIXED))` produces JSON with `mergesExcluded === 1`; `runCli(['--json', '/repo'], makeIo(MIXED))` produces JSON without `mergesExcluded` key. Both assertions pass. Also verified: `--no-merges --json` on merge-free input omits `mergesExcluded` (N=0 path in `src/cli.ts` line 771: `if (noMerges && mergesExcluded > 0)`). |
| 10 | GIVEN a Commit[] with no merge commits (all parentCount <= 1) WHEN gitpulse is run with --no-merges and again without --no-merges THEN the text output is byte-identical in both invocations (no merge commits to exclude) | ✓ met | `test/no-merges-cli.test.ts` AC5 test: `runCli(['--no-merges', '/repo'], makeIo(NO_MERGES)).stdout === runCli(['/repo'], makeIo(NO_MERGES)).stdout`. Also verified by `test/acceptance/run.ts` WI-3 AC4 (merge-free fixture): `plainOnNoMerge === noMergesOnNoMerge`, passes. |
| 11 | GIVEN a gitpulse invocation with --no-merges combined with --since 2021-03-01 and --exclude 'dist/**' and --sort commits:asc WHEN the CLI processes all flags THEN all flags compose correctly — each filter applies in order and the output is valid | ✓ met | `test/no-merges-cli.test.ts` AC6 tests: `runCli(['--no-merges', '--since', '2021-03-01', '--exclude', 'dist/**', '--sort', 'commits:asc', '/repo'], makeIo(MIXED))` exits 0, stderr empty. Additional test with `--json` confirms valid JSON output. Both pass. |
| 12 | GIVEN the deterministic temp-repo fixture is extended with one real merge commit (two parents) WHEN the built CLI runs against the fixture without --no-merges THEN the total commit count in the header equals the pre-initiative baseline PLUS 1 (the merge commit is now included) | ✓ met | `test/acceptance/run.ts`: `EXPECTED_TOTAL_WITH_MERGE = 7`. Plain run asserts `actual` matches `^gitpulse — 7 commits \(2021-03-01 → 2021-04-15\)`. The merge commit is created via `git commit-tree -p <mainTip> -p <prevParent>` and `git reset --hard <mergeSha>`. Acceptance gate passes. |
| 13 | GIVEN the fixture repo containing at least one merge commit WHEN the built CLI runs with --no-merges THEN the text output contains '(1 merge commits excluded)' AND per-author totals match the original baseline (Ada 5, Grace 1) | ✓ met | `test/acceptance/run.ts` WI-3 AC1 block: `noMergesOut` matches `^gitpulse — 6 commits \(2021-03-01 →` and `\(1 merge commits excluded\)`. First author row matches `^\s*5\s+Ada Lovelace$`. Acceptance gate passes. |
| 14 | GIVEN the fixture repo with --no-merges --json WHEN the JSON output is parsed THEN top-level mergesExcluded equals 1 (the single merge commit) | ✓ met | `test/acceptance/run.ts` WI-3 AC3 block: `noMergesParsed.mergesExcluded === 1` (EXPECTED_NO_MERGES_EXCLUDED = 1). Also `noMergesParsed.totalCommits === 6` (EXPECTED_TOTAL). Acceptance gate passes. |
| 15 | GIVEN a merge-free fixture repo WHEN the built CLI runs with --no-merges and again without --no-merges THEN the two outputs are byte-identical (no merge commits to exclude, no annotation printed) | ✓ met | `test/acceptance/run.ts` WI-3 AC4 block: builds a two-commit merge-free fixture, asserts `plainOnNoMerge === noMergesOnNoMerge` via `assert.strictEqual`. Process prints `acceptance: PASS — AC4 byte-identical`. Acceptance gate passes. |
| 16 | GIVEN README.md and CHANGELOG.md in the repo WHEN the initiative is complete THEN README.md documents the --no-merges flag in its Options section AND CHANGELOG.md contains a '## [Unreleased]' entry describing the new flag | ✓ met | README.md Options table contains row: `| \`--no-merges\` | Exclude merge commits … \`(N merge commits excluded)\` … \`mergesExcluded\` field. |`. CHANGELOG.md `## [Unreleased]` section has `### Changed` (parentCount field, removal of --no-merges from LOG_ARGS) and `### Added` (--no-merges flag, filterMergeCommits export) entries. |

## Test Evidence

### The `Commit` type now carries `parentCount: number` parsed from the `%P` format specifier. The unit suite exercises all three cases: initial commit (0), regular commit (1), and merge commit (2).

- **Before:** Prior: `LOG_ARGS` contained `--no-merges`; the `Commit` type had no `parentCount` field; merge commits were silently excluded from all analytics.
- **After:** After: `LOG_FORMAT` appends `%P` (fourth tab-separated field); `parseLog()` counts space-separated parent SHAs to populate `parentCount`; `LOG_ARGS` no longer contains `--no-merges`. Verified by `test/no-merges.test.ts`: AC1 (type field present and typed `number`), AC2 (`LOG_ARGS` check), AC3 (parentCount === 2 for merge), AC4 (parentCount === 0 for initial), AC5 (parentCount === 1 for regular).

### A new exported `filterMergeCommits(commits)` pure function in `src/cli.ts` keeps only commits with `parentCount <= 1` and returns both the filtered array and the excluded count.

- **Before:** Prior: no such function; merge filtering was implicit and unconditional (via `--no-merges` in git log args).
- **After:** After: `filterMergeCommits([init, regular, merge])` returns `{ filtered: [init, regular], excludedCount: 1 }`. Verified by `test/no-merges-cli.test.ts` AC1 tests: mixed input keeps parentCount ≤ 1 commits; excludedCount equals count of parentCount > 1 commits; merge-free input gives excludedCount 0.

### Running `gitpulse <repo> --no-merges` against a repo with one merge commit produces a header annotated with `(1 merge commits excluded)` and per-author totals matching the non-merge baseline.

- **Command:** `node dist/cli.js . --no-merges`

**Before output:**
```
[stderr] gitpulse: unknown option "--no-merges"

gitpulse — git repository commit-stats analytics

Usage:
  gitpulse [repo-path]   print a commit-stats summary (default ".")

Options:
  -h, --help             show this help
  --json                 output summary as JSON instead of a table
  --csv                  output summary as RFC-4180 CSV instead of a table
  --since <YYYY-MM-DD>   only include commits on or after this date
  --until <YYYY-MM-DD>   only include commits on or before this date
  --top <n>              cap each ranked list to the top n entries (n >= 1)
  --compare <ref>        compare HEAD against a git ref (tag, branch, SHA)
  --exclude <pattern>    exclude file paths matching a glob pattern (repeatable)
  --sort <column>[:asc|:desc]  sort output by column (default direction: desc for numeric, asc for text)
```

**After output:**
```
gitpulse — 134 commits (2026-06-21 → 2026-08-28) (22 merge commits excluded)

commits  author
-------  ------
     57  Parso
     37  forge-orchestrator
     22  forge
     14  forge-ralph
      4  forge-unifier

churn (lines)  author
-------------  ------
  +10474/-125  Parso
  +2595/-1455  forge-orchestrator
    +3863/-58  forge-ralph
    +2253/-15  forge-unifier
     +0/-1347  forge

churn (lines)  file
-------------  ----
    +1443/-39  test/acceptance/run.ts
    +544/-544  .forge/unifier-items/UWI-1.md
    +444/-444  .forge/pr-description.md
     +846/-37  src/cli.ts
    +404/-404  .forge/skills/demo-design/SKILL.md
    +385/-385  .forge/demo/DEMO.html
     +725/-17  src/format.ts
      +656/-7  forge/history/INIT-2026-07-11-csv-output-flag/demo/DEMO.md
    +313/-313  AGENT.md
    +306/-306  .forge/last-gate-failure.md
     +580/-10  package-lock.json
      +576/-4  test/format-csv.test.ts
     +556/-10  forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/DEMO.md
    +282/-282  .forge/skills/git-log-analysis/SKILL.md
      +525/-9  forge/history/INIT-2026-07-11-exclude-path-filter/demo/DEMO.md
      +439/-7  forge/history/INIT-2026-07-11-cli-sort-flag/demo/DEMO.md
      +362/-0  test/exclude.test.ts
      +323/-8  src/git.ts
      +311/-0  forge/history/INIT-2026-08-28-init-2026-08-28-coupling-command/demo/demo.json
      +300/-0  test/tags-cli.test.ts
      +285/-8  CHANGELOG.md
      +268/-0  test/cli-coupling.test.ts
      +263/-0  test/json-output.test.ts
      +240/-0  test/format-delta.test.ts
      +228/-0  test/compare-cli.test.ts
      +218/-7  test/tags-git.test.ts
      +224/-0  test/ownership.test.ts
      +222/-0  test/compare.test.ts
      +220/-0  test/author-churn.test.ts
      +217/-0  test/coupling.test.ts
      +205/-0  forge/history/INIT-2026-08-28-init-2026-08-28-coupling-command/demo/DEMO.md
      +204/-0  test/cli-top.test.ts
      +201/-0  test/sort.test.ts
      +199/-0  test/tags.test.ts
      +197/-0  test/format-coupling.test.ts
      +196/-0  test/hotspot.test.ts
      +196/-0  test/no-merges-cli.test.ts
      +181/-4  test/unit.test.ts
      +177/-7  forge/history/INIT-2026-07-11-csv-output-flag/demo/demo.json
      +184/-0  test/churn.test.ts
     +172/-10  forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/demo.json
      +181/-0  test/format-new.test.ts
      +179/-0  test/cli-sort.test.ts
      +170/-8  README.md
      +168/-5  forge/history/INIT-2026-07-11-cli-sort-flag/demo/demo.json
      +167/-0  test/window.test.ts
      +160/-6  forge/history/INIT-2026-07-11-exclude-path-filter/demo/demo.json
      +160/-5  src/stats.ts
      +165/-0  test/cli-csv.test.ts
      +162/-0  forge/history/INIT-2026-06-21-ownership-hotspots-top-flag/demo/demo.json
      +153/-0  src/ownership.ts
      +149/-0  test/no-merges.test.ts
      +146/-0  forge/history/INIT-2026-06-22-compare-ref-analytics-delta/demo/pulse-capture.md
      +146/-0  forge/history/INIT-2026-07-11-cli-sort-flag/demo/pulse-capture.md
      +146/-0  forge/history/INIT-2026-07-11-csv-output-flag/demo/pulse-capture.md
      +68/-68  fix_plan.md
     +107/-21  .forge/project.json
      +126/-0  forge/history/INIT-2026-06-22-compare-ref-analytics-delta/demo/demo.json
      +124/-0  src/compare.ts
      +122/-0  forge/history/INIT-2026-06-21-gitpulse-code-churn/demo/demo.json
      +108/-0  forge/history/INIT-2026-06-21-json-output-flag/demo/pulse-capture.md
      +106/-0  src/sort.ts
      +100/-0  forge/history/INIT-2026-06-21-json-output-flag/demo/demo.json
       +93/-0  forge/history/INIT-2026-06-21-ownership-hotspots-top-flag/demo/pulse-capture.md
       +91/-0  forge/history/INIT-2026-06-21-ownership-hotspots-top-flag/demo/DEMO.md
       +87/-0  .github/workflows/release.yml
       +85/-0  src/tags.ts
       +82/-0  src/hotspot.ts
       +73/-5  roadmap.md
       +78/-0  src/coupling.ts
       +76/-0  forge/history/INIT-2026-06-21-json-output-flag/demo/DEMO.md
       +74/-0  src/glob.ts
       +69/-0  src/ch
… (truncated)
```

### Running `gitpulse <repo> --no-merges --json` produces JSON with a top-level `mergesExcluded` field equal to the number of filtered merge commits. Without `--no-merges`, the field is absent.

- **Command:** `node dist/cli.js . --no-merges --json`

**Before output:**
```
[stderr] gitpulse: unknown option "--no-merges"

gitpulse — git repository commit-stats analytics

Usage:
  gitpulse [repo-path]   print a commit-stats summary (default ".")

Options:
  -h, --help             show this help
  --json                 output summary as JSON instead of a table
  --csv                  output summary as RFC-4180 CSV instead of a table
  --since <YYYY-MM-DD>   only include commits on or after this date
  --until <YYYY-MM-DD>   only include commits on or before this date
  --top <n>              cap each ranked list to the top n entries (n >= 1)
  --compare <ref>        compare HEAD against a git ref (tag, branch, SHA)
  --exclude <pattern>    exclude file paths matching a glob pattern (repeatable)
  --sort <column>[:asc|:desc]  sort output by column (default direction: desc for numeric, asc for text)
```

**After output:**
```
{
  "totalCommits": 134,
  "byAuthor": [
    {
      "author": "Parso",
      "commits": 57
    },
    {
      "author": "forge-orchestrator",
      "commits": 37
    },
    {
      "author": "forge",
      "commits": 22
    },
    {
      "author": "forge-ralph",
      "commits": 14
    },
    {
      "author": "forge-unifier",
      "commits": 4
    }
  ],
  "authorChurn": [
    {
      "author": "Parso",
      "commits": 57,
      "insertions": 10474,
      "deletions": 125
    },
    {
      "author": "forge-orchestrator",
      "commits": 37,
      "insertions": 2595,
      "deletions": 1455
    },
    {
      "author": "forge-ralph",
      "commits": 14,
      "insertions": 3863,
      "deletions": 58
    },
    {
      "author": "forge-unifier",
      "commits": 4,
      "insertions": 2253,
      "deletions": 15
    },
    {
      "author": "forge",
      "commits": 22,
      "insertions": 0,
      "deletions": 1347
    }
  ],
  "fileChurn": [
    {
      "file": "test/acceptance/run.ts",
      "insertions": 1443,
      "deletions": 39,
      "commits": 12
    },
    {
      "file": ".forge/unifier-items/UWI-1.md",
      "insertions": 544,
      "deletions": 544,
      "commits": 32
    },
    {
      "file": ".forge/pr-description.md",
      "insertions": 444,
      "deletions": 444,
      "commits": 32
    },
    {
      "file": "src/cli.ts",
      "insertions": 846,
      "deletions": 37,
      "commits": 13
    },
    {
      "file": ".forge/skills/demo-design/SKILL.md",
      "insertions": 404,
      "deletions": 404,
      "commits": 2
    },
    {
      "file": ".forge/demo/DEMO.html",
      "insertions": 385,
      "deletions": 385,
      "commits": 2
    },
    {
      "file": "src/format.ts",
      "insertions": 725,
      "deletions": 17,
      "commits": 10
    },
    {
      "file": "forge/history/INIT-2026-07-11-csv-output-flag/demo/DEMO.md",
      "insertions": 656,
      "deletions": 7,
      "commits": 2
    },
    {
      "file": "AGENT.md",
      "insertions": 313,
      "deletions": 313,
      "commits": 14
    },
    {
      "file": ".forge/last-gate-failure.md",
      "insertions": 306,
      "deletions": 306,
      "commits": 26
    },
    {
      "file": "package-lock.json",
      "insertions": 580,
      "deletions": 10,
      "commits": 7
    },
    {
      "file": "test/format-csv.test.ts",
      "insertions": 576,
      "deletions": 4,
      "commits": 2
    },
    {
      "file": "forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/DEMO.md",
      "insertions": 556,
      "deletions": 10,
      "commits": 2
    },
    {
      "file": ".forge/skills/git-log-analysis/SKILL.md",
      "insertions": 282,
      "deletions": 282,
      "commits": 12
    },
    {
      "file": "forge/history/INIT-2026-07-11-exclude-path-filter/demo/DEMO.md",
      "insertions": 525,
      "deletions": 9,
      "commits": 2
    },
    {
      "file": "forge/history/INIT-2026-07-11-cli-sort-flag/demo/DEMO.md",
      "insertions": 439,
      "deletions": 7,
      "commits": 2
    },
    {
      "file": "test/exclude.test.ts",
      "insertions": 362,
      "deletions": 0,
      "commits": 2
    },
    {
      "file": "src/git.ts",
      "insertions": 323,
      "deletions": 8,
      "commits": 5
    },
    {
      "file": "forge/history/INIT-2026-08-28-init-2026-08-28-coupling-command/demo/demo.json",
      "insertions": 311,
      "deletions": 0,
      "commits": 1
    },
    {
      "file": "test/tags-cli.test.ts",
      "insertions": 300,
      "deletions": 0,
      "commits": 1
    },
    {
      "file": "CHANGELOG.md",
      "insertions": 285,
      "deletions": 8,
      "commits": 37
    },
    {
      "file": "test/cli-coupling.test.ts",
      "insertions": 268,
      "deletions": 0,
      "commits": 2
    },
    {
      "file": "test/json-output.test.ts",
      "insertions": 263,
      "deletions": 0,
      "commits": 2
    },
    {
      "file": "test/format-delta.test.ts",
      "insertions": 240
… (truncated)
```

### The acceptance fixture now includes one real merge commit. Plain run yields 7 total commits (Ada=6); `--no-merges` yields 6 commits (Ada=5, Grace=1) and prints the exclusion annotation.

- **Before:** Pre-initiative baseline: fixture had 6 non-merge commits; plain run and `--no-merges` run were always identical (merge filtering happened silently at the git log layer).
- **After:** Post-initiative: plain run shows `gitpulse — 7 commits (2021-03-01 → 2021-04-15)` with Ada=6; `--no-merges` shows `gitpulse — 6 commits … (1 merge commits excluded)` with Ada=5, Grace=1. Byte-identical assertion holds for a merge-free fixture. Verified by `test/acceptance/run.ts` WI-3 assertions.

### The USAGE string in `src/cli.ts` includes `--no-merges` with a one-line description; `--help` prints it to stderr.

- **Before:** Prior: `--help` output had no `--no-merges` entry.
- **After:** After: USAGE contains `'  --no-merges            exclude merge commits (commits with >1 parent)'`. Verified by `test/no-merges-cli.test.ts` AC3 test: `runCli(['--help'], io)` combined stdout+stderr includes `'--no-merges'`.

### `--no-merges` composes correctly with `--since`, `--exclude`, and `--sort` flags; all filters apply in order and the CLI exits 0.

- **Before:** Prior: no `--no-merges` flag; flag composition was not applicable.
- **After:** After: `runCli(['--no-merges', '--since', '2021-03-01', '--exclude', 'dist/**', '--sort', 'commits:asc', '/repo'], io)` exits 0 with no stderr. Verified by `test/no-merges-cli.test.ts` AC6 tests.

### README.md documents the `--no-merges` flag in its Options table; CHANGELOG.md carries a `## [Unreleased]` entry describing both the removal from `LOG_ARGS` and the new CLI flag.

- **Before:** Prior: no `--no-merges` documentation; `LOG_ARGS` change was undocumented.
- **After:** After: README Options table has `--no-merges` row with full description including header annotation and JSON field behaviour. CHANGELOG `## [Unreleased]` has a `### Changed` entry (removed `--no-merges` from `LOG_ARGS`, added `parentCount` field) and an `### Added` entry (`--no-merges` flag, `filterMergeCommits` export).

## API / Behaviour Diff

### Commit type (src/git.ts) (changed)

**Before:**
```
type Commit = { hash, author, date, filesChanged, insertions, deletions, files }
```
**After:**
```
type Commit = { hash, author, date, parentCount: number, filesChanged, insertions, deletions, files }
```

### LOG_ARGS (src/git.ts) (changed)

**Before:**
```
['log', '--no-merges', '--numstat', '--date=short', '--format=%H%x09%an%x09%ad']
```
**After:**
```
['log', '--numstat', '--date=short', '--format=%H%x09%an%x09%ad%x09%P']
```

### filterMergeCommits (src/cli.ts — new export) (added)

**Before:**
```

```
**After:**
```
export function filterMergeCommits(commits: Commit[]): { filtered: Commit[]; excludedCount: number }
```

### gitpulse --no-merges (text output) (added)

**Before:**
```

```
**After:**
```
Header annotated: 'gitpulse — N commits (date → date) (M merge commits excluded)'
```

### gitpulse --no-merges --json (JSON output) (added)

**Before:**
```

```
**After:**
```
Top-level 'mergesExcluded: number' field present when --no-merges and N > 0; absent otherwise
```

## Test Evidence

| test | result | delta |
|---|---|---|
| AC2: LOG_ARGS does not contain --no-merges | pass | +1 new test (test/no-merges.test.ts) |
| AC2: LOG_ARGS is an array (importable at runtime) | pass | +1 new test |
| AC4: initial commit with empty %P field → parentCount 0 | pass | +1 new test |
| AC5: regular commit with one parent SHA → parentCount 1 | pass | +1 new test |
| AC3: merge commit with two parent SHAs → parentCount 2 | pass | +1 new test |
| AC1: Commit record carries parentCount as a number field | pass | +1 new test |
| numstat fields still parse correctly with 4-field header (regression guard) | pass | +1 new test |
| mixed sequence: initial + regular + merge commits parsed correctly | pass | +1 new test |
| filterMergeCommits — mix of parentCount 0, 1, 2 → only 0 and 1 survive | pass | +1 new test (test/no-merges-cli.test.ts) |
| filterMergeCommits — excludedCount equals number with parentCount > 1 | pass | +1 new test |
| filterMergeCommits — merge-free input: excludedCount === 0, length unchanged | pass | +1 new test |
| runCli --no-merges text output contains merge excluded annotation | pass | +1 new test |
| filter runs before summarize — merge author excluded from stats | pass | +1 new test |
| --help output contains --no-merges | pass | +1 new test |
| --no-merges --json → JSON has mergesExcluded: 1 | pass | +1 new test |
| --json (no --no-merges) → JSON does NOT have mergesExcluded | pass | +1 new test |
| --no-merges --json on merge-free repo → mergesExcluded absent (N=0) | pass | +1 new test |
| byte-identical text output with/without --no-merges when no merges present | pass | +1 new test |
| --no-merges composes with --since, --exclude, --sort → exit code 0 | pass | +1 new test |
| --no-merges --json --since --exclude compose correctly | pass | +1 new test |
| acceptance: plain run shows 7 commits (Ada=6, including merge) | pass | +1 acceptance assertion (test/acceptance/run.ts) |
| acceptance: --no-merges shows 6 commits and '(1 merge commits excluded)' | pass | +1 acceptance assertion |
| acceptance: --no-merges --json mergesExcluded equals 1 | pass | +1 acceptance assertion |
| acceptance: merge-free fixture byte-identical with and without --no-merges | pass | +1 acceptance assertion |
| All pre-existing unit tests (npm test) | pass | full regression suite green |

> result: **pass**/**fail** · **skip** = not run in this gate (e.g. a live test with no credentials present) — not a failure · delta **new** = test added by this change.

## Files Changed

- `src/git.ts` — Added parentCount to Commit type; updated LOG_FORMAT to include %P; removed --no-merges from LOG_ARGS; updated parseLog() to count parent SHAs
- `src/cli.ts` — Added filterMergeCommits export; wired --no-merges flag; added USAGE entry; text header and JSON field for mergesExcluded
- `test/no-merges.test.ts` — New: WI-1 unit suite — LOG_ARGS check, parentCount parsing for all three parentCount values
- `test/no-merges-cli.test.ts` — New: WI-2 unit suite — filterMergeCommits, text annotation, --help, JSON field, byte-identical, flag composition
- `test/acceptance/run.ts` — Extended: real merge commit in fixture; WI-3 assertions for plain run (7 commits), --no-merges (6 commits, annotation), --no-merges --json (mergesExcluded=1), merge-free byte-identical
- `README.md` — Added --no-merges row to Options table
- `CHANGELOG.md` — ## [Unreleased] entry: Changed (LOG_ARGS, parentCount) and Added (--no-merges flag, filterMergeCommits)
- `test/unit.test.ts` — Updated for 4-field header format change
- `test/churn.test.ts` — Regression guard updates for parentCount field
- `test/author-churn.test.ts` — Regression guard updates
- `test/cli-coupling.test.ts` — Regression guard updates
- `test/cli-csv.test.ts` — Regression guard updates
- `test/cli-sort.test.ts` — Regression guard updates
- `test/cli-top.test.ts` — Regression guard updates
- `test/compare-cli.test.ts` — Regression guard updates
- `test/coupling.test.ts` — Regression guard updates
- `test/exclude.test.ts` — Regression guard updates
- `test/hotspot.test.ts` — Regression guard updates
- `test/json-output.test.ts` — Regression guard updates
- `test/ownership.test.ts` — Regression guard updates
- `test/tags-git.test.ts` — Regression guard updates
- `test/window.test.ts` — Regression guard updates

```
22 files changed, 646 insertions(+), 44 deletions(-)
```

## Usage

```
# Exclude merge commits from all analytics
gitpulse /path/to/repo --no-merges

# With JSON output — gains top-level 'mergesExcluded' field
gitpulse /path/to/repo --no-merges --json

# Compose with other flags
gitpulse /path/to/repo --no-merges --since 2024-01-01 --exclude 'dist/**' --sort commits:asc
```

## Impact

- Merge commits are now visible in analytics by default — operators get an accurate picture of all activity including integration commits.
- The `--no-merges` flag gives full opt-in control: strip merge commits and see only substantive author contributions, with an explicit count of what was filtered.
- `parentCount` on every `Commit` record enables downstream filtering and segmentation without re-querying git.
- The JSON `mergesExcluded` field makes the filter auditable in automated pipelines.
