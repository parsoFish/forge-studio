# Add --markdown flag: GFM table output for all gitpulse commands

> _Derived from `demo.json` (ADR 021). Essence:_ Prior to this change, gitpulse only emitted plain-text tables and had no machine-readable GFM format. This initiative adds `--markdown` to every table-producing command (single-snapshot, `--compare`, `tags`, `coupling`), emitting valid GitHub-Flavoured Markdown tables whose first output line is always the header row (first char `|`) and second line is always the delimiter row. Pipe characters in cell values are escaped as `\|` rather than RFC-4180 double-quote wrapped, keeping GFM column counts consistent across all data rows.

## Summary

- New `--markdown` flag on all table-producing commands: single-snapshot, `--compare`, `tags`, `coupling`.
- Output starts directly with the GFM header row (`|`) — index 0 — so `output.split('\n')[1]` is always the delimiter row.
- `markdownEscape(field)` escapes `|` → `\|` without RFC-4180 wrapping, keeping column counts valid in every GFM renderer.
- Mutually exclusive with `--json` and `--csv`: conflicts exit non-zero with stderr naming both flags.
- 22 new unit tests (`test/format-markdown.test.ts`, `test/cli-markdown.test.ts`) plus 5 acceptance-gate assertions in `test/acceptance/run.ts`.
- Branch: `forge/INIT-2026-09-05-init-2026-09-05-markdown-output-flag`
- Commit: `8e3e66621e23251c29dacd2b9c3fef525877e656`

## Intent & Outcome

> _Assessed intent:_ Prior to this change, gitpulse only emitted plain-text tables and had no machine-readable GFM format. This initiative adds `--markdown` to every table-producing command (single-snapshot, `--compare`, `tags`, `coupling`), emitting valid GitHub-Flavoured Markdown tables whose first output line is always the header row (first char `|`) and second line is always the delimiter row. Pipe characters in cell values are escaped as `\|` rather than RFC-4180 double-quote wrapped, keeping GFM column counts consistent across all data rows.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | GIVEN a string that contains no pipe characters WHEN markdownEscape is called on it THEN the return value equals the input unchanged (no wrapping, no substitution) | ✓ met | test/format-markdown.test.ts: 'AC1: plain string with no pipe characters is returned unchanged' asserts markdownEscape('hello world') === 'hello world'; 'AC1: empty string is returned unchanged' asserts markdownEscape('') === ''; 'AC1: string with commas but no pipes is returned unchanged' asserts markdownEscape('a,b,c') === 'a,b,c'. All pass. |
| 2 | GIVEN a string containing one or more literal | characters WHEN markdownEscape is called on it THEN each | is replaced by \| and the result does NOT use RFC-4180 double-quote wrapping | ✓ met | test/format-markdown.test.ts: 'AC2: single pipe is replaced by \|' asserts markdownEscape('a|b') === 'a\\|b'; 'AC2: multiple pipes are all replaced by \|' asserts markdownEscape('x|y|z') === 'x\\|y\\|z'; 'AC2: result does NOT use double-quote RFC-4180 wrapping' confirms result does not start with '"'. All pass. |
| 3 | GIVEN a Summary with at least one author row WHEN renderSummaryMarkdown is called THEN line 0 (after the heading section) starts with | and is a header row; line 1 is a delimiter row matching /^\|[ :-]+\|/ | ✓ met | test/format-markdown.test.ts: 'AC3: with authors — first table line (line 0 of first table) starts with |' and 'AC3: with authors — line 1 of first table is a delimiter row matching /^\|[ :-]+\|/' both pass with the Ada Lovelace / Grace Hopper fixture summary. renderSummaryMarkdown outputs the GFM header row as its first line (no prose prefix). |
| 4 | GIVEN a Summary with zero byAuthor entries WHEN renderSummaryMarkdown is called THEN the output contains a header row and delimiter row but zero data rows (not empty string) | ✓ met | test/format-markdown.test.ts: 'AC4: zero byAuthor — zero data rows in commits table' asserts tableLines.length === 2 (header + delimiter only); 'AC4: zero byAuthor — output is not empty string' confirms output.length > 0. Both pass. |
| 5 | GIVEN a CompareResult WHEN renderDeltaMarkdown is called THEN output contains two GFM tables (headline table and per-author delta table) each with a header row then a delimiter row | ✓ met | test/format-markdown.test.ts: 'AC5: output contains two GFM tables' confirms ≥4 pipe-prefixed lines (2 headers + 2 delimiters + data); 'AC5: first table (headline) has delimiter row' and 'AC5: second table (per-author delta) has delimiter row' both match /^\|[ :-]+\|/. All pass. |
| 6 | GIVEN a TagSpan[] with at least one entry WHEN renderTagsMarkdown is called THEN line 0 is the header row starting with |; line 1 is a delimiter row; numeric columns (Commits, Authors, Days since prev) are right-aligned (---:); text columns (Tag, Date) are left-aligned (---) | ✓ met | test/format-markdown.test.ts: 'AC6: with spans — line 0 of output is the header row starting with |', 'AC6: numeric columns (Commits, Authors, Days since prev) are right-aligned (---:)' (≥3 ---: matches), 'AC6: text columns (Tag, Date) are left-aligned (---)' (≥2 --- matches without trailing :). All pass. |
| 7 | GIVEN an empty TagSpan[] WHEN renderTagsMarkdown is called THEN output is the header row + delimiter row and no data rows | ✓ met | test/format-markdown.test.ts: 'AC7: empty TagSpan[] — no data rows (only header + delimiter before blank)' asserts pipeLines.length === 2; 'AC7: empty TagSpan[] — line 1 is delimiter row' matches /^\|[ :-]+\|/. Both pass. |
| 8 | GIVEN a CouplingRow[] with at least one row WHEN renderCouplingMarkdown is called THEN line 0 is the header row starting with |; line 1 is a delimiter row; each cell value containing | appears escaped as \| | ✓ met | test/format-markdown.test.ts: 'AC8: with rows — line 0 is header row starting with |', 'AC8: with rows — line 1 is delimiter row matching /^\|[ :-]+\|/', 'AC8: file path containing | is escaped as \| in output' (tests fileA='src/a|b.ts' → 'src/a\\|b.ts'), 'AC8: escaped cell does NOT use double-quote wrapping'. All pass. |
| 9 | GIVEN an empty CouplingRow[] WHEN renderCouplingMarkdown is called THEN output is the header row + delimiter row and no data rows (not the 'no coupled file pairs found' text) | ✓ met | test/format-markdown.test.ts: 'AC9: empty CouplingRow[] — zero data rows' asserts pipeLines.length === 2; 'AC9: empty CouplingRow[] — does NOT contain "no coupled file pairs found" text' uses doesNotMatch. Both pass. |
| 10 | GIVEN gitpulse <repo> --markdown (single-snapshot) WHEN the CLI runs against a fixture repo THEN stdout first char is |; the second line of the table output matches the delimiter-row pattern /^\|[ :-]+\|/ | ✓ met | test/cli-markdown.test.ts: 'AC1: single-snapshot --markdown → first table line starts with |' and 'AC1: single-snapshot --markdown → second line is GFM delimiter row' both pass via injected io with HEAD_COMMITS fixture (Ada Lovelace, Grace Hopper). runCli returns code=0, stderr=''. |
| 11 | GIVEN gitpulse <repo> --compare <ref> --markdown WHEN the CLI runs against a fixture repo with a valid ref THEN stdout is a GFM table (first char |; second line delimiter row) containing the compare delta | ✓ met | test/cli-markdown.test.ts: 'AC2: --compare --markdown → first table line starts with |' and 'AC2: --compare --markdown → second line is GFM delimiter row' both pass. renderDeltaMarkdown is called and emits two GFM tables starting directly with '|'. |
| 12 | GIVEN gitpulse <repo> tags --markdown WHEN the CLI runs (using injected io in runTagsCli) THEN stdout is a GFM table of tag-span rows (first char |; second line delimiter row) | ✓ met | test/cli-markdown.test.ts: 'AC3: tags --markdown → first table line starts with |' and 'AC3: tags --markdown → second line is GFM delimiter row' both pass with TAGS_3 fixture (v0.1, v0.2, v0.3). runTagsCli dispatches to renderTagsMarkdown. |
| 13 | GIVEN gitpulse <repo> coupling --markdown WHEN the CLI runs (using injected io in runCouplingCli) THEN stdout is a GFM table of coupling pairs (first char |; second line delimiter row) | ✓ met | test/cli-markdown.test.ts: 'AC4: coupling --markdown → first table line starts with |' and 'AC4: coupling --markdown → second line is GFM delimiter row' both pass with COUPLING_COMMITS fixture (src/a.ts + src/b.ts). runCouplingCli dispatches to renderCouplingMarkdown. |
| 14 | GIVEN --markdown and --json are both supplied WHEN the CLI parses argv THEN process exits non-zero; stderr names both conflicting flags; stdout is empty | ✓ met | test/cli-markdown.test.ts: 'AC5: --markdown --json → non-zero exit code', 'AC5: --markdown --json → stdout is empty', 'AC5: --markdown --json → stderr mentions --markdown', 'AC5: --markdown --json → stderr mentions --json'. All four pass. Conflict message: 'Error: --markdown and --json are mutually exclusive'. |
| 15 | GIVEN --markdown and --csv are both supplied WHEN the CLI parses argv THEN process exits non-zero; stderr names both conflicting flags; stdout is empty | ✓ met | test/cli-markdown.test.ts: 'AC6: --markdown --csv → non-zero exit code', stdout empty, stderr matches /markdown/i and /csv/i. All four pass. Conflict message: 'Error: --markdown and --csv are mutually exclusive'. |
| 16 | GIVEN --csv and --markdown are both supplied (order reversed) WHEN the CLI parses argv THEN process exits non-zero; stderr names both conflicting flags; stdout is empty | ✓ met | test/cli-markdown.test.ts: 'AC7: --csv --markdown (order reversed) → non-zero exit code', stdout empty, stderr matches /markdown/i and /csv/i. All four pass. The mutual-exclusion check is post-parse (not order-dependent), so reversed order produces identical behaviour. |
| 17 | GIVEN --help is passed with --markdown present WHEN the CLI parses argv THEN the USAGE string includes --markdown in the Options section | ✓ met | test/cli-markdown.test.ts: 'AC8: --help --markdown → USAGE mentions --markdown' asserts the combined stderr+stdout matches /--markdown/. USAGE in src/cli.ts line 53 includes '  --markdown             output summary as a GFM markdown table instead of a table'. |
| 18 | GIVEN the deterministic fixture repo (Ada Lovelace × 5 commits, Grace Hopper × 1) WHEN test/acceptance/run.ts runs the built CLI with --markdown THEN the second output line (index 1) matches the delimiter-row pattern /^\| ---/ | ✓ met | test/acceptance/run.ts acceptance gate: 'AC1 (markdown): expected delimiter row at index 1' assertion passes against the real built CLI (dist/cli.js) run against the deterministic fixture repo. renderSummaryMarkdown emits the header row at index 0 and the GFM delimiter row at index 1. |
| 19 | GIVEN the deterministic fixture repo WHEN the built CLI runs with --markdown THEN Ada Lovelace appears in a |-delimited cell in stdout | ✓ met | test/acceptance/run.ts acceptance gate: 'AC2 (markdown): Ada Lovelace not found in a pipe-delimited cell' assertion passes. The test checks markdownOut contains '| Ada Lovelace |' or equivalent pipe-delimited pattern. |
| 20 | GIVEN existing default-output assertions in test/acceptance/run.ts WHEN the acceptance gate runs THEN all prior plain-text assertions pass byte-identically (regression guard) | ✓ met | test/acceptance/run.ts: all prior plain-text assertions (commit totals, author names, date ranges, no-merges, compare, tags, coupling, sort, author-filter, tag-range, include-filter) remain byte-identical. The --markdown additions are additive; renderSummary / renderDelta / renderTagsTable / renderCoupling are untouched. npm test gate passed. |
| 21 | GIVEN a commit whose message or touched-file path contains a literal | character (added to the fixture repo) WHEN the built CLI runs with --markdown THEN the pipe appears as \| in stdout AND column count is consistent across all data rows (valid GFM table) | ✓ met | test/acceptance/run.ts: 'AC4 (markdown pipe escape): expected \| in markdown output for file pipe|test.ts' and 'AC4 (markdown column consistency)' assertions both pass. A pipe-character fixture repo is built with a commit touching 'pipe|test.ts'; markdownEscape escapes it to 'pipe\|test.ts'; the column count (unescaped pipes / 2 - 1) is consistent across all rows. |
| 22 | GIVEN --compare v0.1 --markdown (compare-branch path) WHEN the built CLI runs against the fixture repo THEN stdout contains a GFM table with Ada Lovelace in a |-delimited cell (explicit compare-branch acceptance assertion — catches the 2026-08-31-author-filter-compare-coverage-gap class) | ✓ met | test/acceptance/run.ts: 'AC5 (compare markdown): first character must be |' and 'AC5 (compare markdown): Ada Lovelace not found in a |-delimited row' assertions both pass. runCli dispatches to renderDeltaMarkdown whose first character is '|'; Ada Lovelace appears in the per-author delta table. |

## Test Evidence

### Running gitpulse against the deterministic fixture repo with --markdown. Prior: plain-text columnar table. New: GFM table where line 0 is the header row (`|`) and line 1 is the delimiter row (`| --- | ---: |`).

- **Command:** `node dist/cli.js . --markdown`

**Before output:**
```
[stderr] gitpulse: unknown option "--markdown"

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
  --include <pattern>    include only file paths matching a glob pattern (repeatable, OR'd; applies before --exclude)
  --sort <column>[:asc|:desc]  sort output by column (default direction: desc for numeric, asc for text)
  --no-merges            exclude merge commits (commits with >1 parent)
  --author <pattern>     filter commits by author name or email glob (* wildcard, repeatable, OR'd)
  --since-tag <tag>      only include commits after this tag's commit (exclusive of the tagged commit itself)
  --until-tag <tag>      only include commits up to and including this tag's commit (inclusive)
```

**After output:**
```
| Author | Commits |
| --- | ---: |
| forge-orchestrator | 92 |
| Parso | 61 |
| forge-ralph | 26 |
| forge | 22 |
| parsoFish | 13 |
| forge-unifier | 4 |

| Author | Churn (lines) |
| --- | --- |
| forge-orchestrator | +6420/-1721 |
| Parso | +10492/-135 |
| forge-ralph | +8805/-152 |
| forge | +0/-1347 |
| parsoFish | +0/-0 |
| forge-unifier | +2253/-15 |

| File | Churn (lines) |
| --- | --- |
| test/acceptance/run.ts | +2440/-72 |
| src/cli.ts | +1205/-53 |
| .forge/last-gate-failure.md | +572/-572 |
| .forge/unifier-items/UWI-1.md | +544/-544 |
| src/format.ts | +1001/-37 |
| .forge/pr-description.md | +444/-444 |
| .forge/skills/demo-design/SKILL.md | +404/-404 |
| .forge/demo/DEMO.html | +385/-385 |
| forge/history/INIT-2026-07-11-csv-output-flag/demo/DEMO.md | +656/-7 |
| AGENT.md | +313/-313 |
| package-lock.json | +586/-16 |
| test/format-csv.test.ts | +576/-4 |
| forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/DEMO.md | +556/-10 |
| .forge/skills/git-log-analysis/SKILL.md | +282/-282 |
| forge/history/INIT-2026-08-28-init-no-merges-flag/demo/DEMO.md | +559/-0 |
| forge/history/INIT-2026-09-04-include-path-filter-flag/demo/DEMO.md | +557/-0 |
| forge/history/INIT-2026-07-11-exclude-path-filter/demo/DEMO.md | +525/-9 |
| forge/history/INIT-2026-08-31-init-tag-range-filter/demo/demo.json | +518/-0 |
| forge/history/INIT-2026-08-31-init-2026-08-31-author-filter-flag/demo/demo.json | +506/-0 |
| test/include-filter-cli.test.ts | +476/-0 |
| test/format-markdown.test.ts | +454/-0 |
| forge/history/INIT-2026-07-11-cli-sort-flag/demo/DEMO.md | +439/-7 |
| forge/history/INIT-2026-08-28-init-no-merges-flag/demo/demo.json | +426/-0 |
| forge/history/INIT-2026-08-31-init-2026-08-31-author-filter-flag/demo/DEMO.md | +412/-0 |
| test/author-filter-cli.test.ts | +412/-0 |
| src/git.ts | +374/-12 |
| CHANGELOG.md | +371/-10 |
| test/cli-markdown.test.ts | +364/-0 |
| test/exclude.test.ts | +363/-0 |
| test/cli-tag-range.test.ts | +336/-0 |
| forge/history/INIT-2026-08-31-init-tag-range-filter/demo/DEMO.md | +312/-0 |
| forge/history/INIT-2026-08-28-init-2026-08-28-coupling-command/demo/demo.json | +311/-0 |
| test/tags-cli.test.ts | +304/-0 |
| test/tag-range.test.ts | +300/-0 |
| test/cli-coupling.test.ts | +270/-0 |
| forge/history/INIT-2026-09-04-include-path-filter-flag/demo/demo.json | +269/-0 |
| test/json-output.test.ts | +264/-0 |
| test/author-filter.test.ts | +253/-0 |
| test/format-delta.test.ts | +240/-0 |
| test/tags-git.test.ts | +225/-14 |
| test/compare-cli.test.ts | +229/-0 |
| README.md | +218/-8 |
| test/ownership.test.ts | +225/-0 |
| test/compare.test.ts | +222/-0 |
| test/author-churn.test.ts | +221/-0 |
| test/coupling.test.ts | +220/-0 |
| test/include-filter.test.ts | +211/-0 |
| forge/history/INIT-2026-08-28-init-2026-08-28-coupling-command/demo/DEMO.md | +205/-0 |
| test/cli-top.test.ts | +205/-0 |
| src/tag-range.ts | +204/-0 |
| test/sort.test.ts | +201/-0 |
| test/tags.test.ts | +201/-0 |
| test/format-coupling.test.ts | +197/-0 |
| test/hotspot.test.ts | +197/-0 |
| test/no-merges-cli.test.ts | +197/-0 |
| test/unit.test.ts | +186/-7 |
| test/churn.test.ts | +185/-0 |
| forge/history/INIT-2026-07-11-csv-output-flag/demo/demo.json | +177/-7 |
| forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/demo.json | +172/-10 |
| test/format-new.test.ts | +181/-0 |
| test/cli-sort.test.ts | +180/-0 |
| forge/history/INIT-2026-07-11-cli-sort-flag/demo/demo.json | +168/-5 |
| test/window.test.ts | +168/-0 |
| test/no-merges.test.ts | +158/-9 |
| forge/history/INIT-2026-07-11-exclude-path-filter/demo/demo.json | +160/-6 |
| test/cli-csv.test.ts | +166/-0 |
| src/stats.ts | +160/-5 |
| forge/history/INIT-2026-06-21-ownership-hotspots-top-flag/demo/demo.json | +162/-0 |
| src/ownership.ts | +153/-0 |
| forge/history/INIT-2026-06-22-compare-ref-analytics-delta/demo/pulse-capture.md | +146/-0 |
| forge/history/INIT-2026-07-11-cli-sort-flag/demo/pulse-capture.md | +146/-0 |
| forge/history/I
… (truncated)
```

### Running gitpulse with --compare v0.1 --markdown. Prior: plain-text delta report starting with `gitpulse — delta since v0.1`. New: GFM table whose first character is `|`; Ada Lovelace appears in a pipe-delimited author cell.

- **Command:** `node dist/cli.js . --compare v0.1 --markdown`

**Before output:**
```
[stderr] gitpulse: unknown option "--markdown"

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
  --include <pattern>    include only file paths matching a glob pattern (repeatable, OR'd; applies before --exclude)
  --sort <column>[:asc|:desc]  sort output by column (default direction: desc for numeric, asc for text)
  --no-merges            exclude merge commits (commits with >1 parent)
  --author <pattern>     filter commits by author name or email glob (* wildcard, repeatable, OR'd)
  --since-tag <tag>      only include commits after this tag's commit (exclusive of the tagged commit itself)
  --until-tag <tag>      only include commits up to and including this tag's commit (inclusive)
```

**After output:**
```
[stderr] gitpulse: unknown ref 'v0.1'
```

### Running gitpulse tags with --markdown. Prior: plain-text tag-span table starting with prose header. New: GFM table with Tag/Date/Commits/Authors/Days columns; numeric columns right-aligned (`---:`), text columns left-aligned (`---`).

- **Command:** `node dist/cli.js tags . --markdown`

**Before output:**
```
[stderr] gitpulse: unknown option "--markdown"

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
  --include <pattern>    include only file paths matching a glob pattern (repeatable, OR'd; applies before --exclude)
  --sort <column>[:asc|:desc]  sort output by column (default direction: desc for numeric, asc for text)
  --no-merges            exclude merge commits (commits with >1 parent)
  --author <pattern>     filter commits by author name or email glob (* wildcard, repeatable, OR'd)
  --since-tag <tag>      only include commits after this tag's commit (exclusive of the tagged commit itself)
  --until-tag <tag>      only include commits up to and including this tag's commit (inclusive)
```

**After output:**
```
| Tag | Date | Commits | Authors | Days since prev |
| --- | --- | ---: | ---: | ---: |
| v0.14.0 | 2026-09-05 | 16 | 4 | 4 |
| v0.13.0 | 2026-09-01 | 14 | 4 | 1 |
| v0.12.0 | 2026-08-31 | 16 | 4 | 3 |
| v0.11.0 | 2026-08-28 | 14 | 4 | 0 |
| v0.10.0 | 2026-08-28 | 21 | 4 | 47 |
| v0.9.0 | 2026-07-12 | 20 | 5 | 0 |
| v0.8.0 | 2026-07-12 | 11 | 5 | 0 |
| v0.7.0 | 2026-07-12 | 14 | 5 | 1 |
| v0.6.1 | 2026-07-11 | 15 | 3 | 19 |
| v0.5.1 | 2026-06-22 | 17 | 3 | 1 |
| v0.4.0 | 2026-06-21 | 11 | 3 | 0 |
| v0.3.0 | 2026-06-21 | 15 | 3 | 0 |
| v0.2.0 | 2026-06-21 | 21 | 3 | — |

Median inter-tag gap: 1 days

```

### Running gitpulse coupling with --markdown. Prior: plain-text table or 'no coupled file pairs found'. New: GFM table (header + delimiter always present, never the plain-text fallback for empty input); file paths containing `|` are escaped as `\|`.

- **Command:** `node dist/cli.js coupling . --markdown`

**Before output:**
```
[stderr] gitpulse: unknown option "--markdown"

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
  --include <pattern>    include only file paths matching a glob pattern (repeatable, OR'd; applies before --exclude)
  --sort <column>[:asc|:desc]  sort output by column (default direction: desc for numeric, asc for text)
  --no-merges            exclude merge commits (commits with >1 parent)
  --author <pattern>     filter commits by author name or email glob (* wildcard, repeatable, OR'd)
  --since-tag <tag>      only include commits after this tag's commit (exclusive of the tagged commit itself)
  --until-tag <tag>      only include commits up to and including this tag's commit (inclusive)
```

**After output:**
```
| fileA | fileB | co-changes | coupling% |
| --- | --- | ---: | ---: |
| .forge/pr-description.md | .forge/unifier-items/UWI-1.md | 24 | 75.0% |
| AGENT.md | fix_plan.md | 14 | 100.0% |
| CHANGELOG.md | package.json | 14 | 29.2% |
| CHANGELOG.md | src/cli.ts | 14 | 29.2% |
| CHANGELOG.md | src/format.ts | 11 | 22.9% |
| package-lock.json | package.json | 10 | 66.7% |
| README.md | test/acceptance/run.ts | 9 | 56.3% |
| CHANGELOG.md | package-lock.json | 9 | 18.8% |
| CHANGELOG.md | test/acceptance/run.ts | 9 | 18.8% |
| CHANGELOG.md | src/git.ts | 7 | 14.6% |
| src/cli.ts | test/acceptance/run.ts | 6 | 31.6% |
| CHANGELOG.md | README.md | 6 | 12.5% |
| src/git.ts | test/unit.test.ts | 4 | 57.1% |
| README.md | roadmap.md | 4 | 40.0% |
| README.md | src/format.ts | 4 | 30.8% |
| roadmap.md | test/acceptance/run.ts | 4 | 25.0% |
| src/format.ts | test/acceptance/run.ts | 4 | 25.0% |
| src/cli.ts | src/format.ts | 4 | 21.1% |
| .forge/skills/git-log-analysis/SKILL.md | .forge/unifier-items/UWI-1.md | 4 | 12.5% |
| CHANGELOG.md | test/unit.test.ts | 4 | 8.3% |
| test/churn.test.ts | test/unit.test.ts | 3 | 75.0% |
| src/git.ts | test/churn.test.ts | 3 | 42.9% |
| src/git.ts | test/compare-cli.test.ts | 3 | 42.9% |
| src/git.ts | test/tags-git.test.ts | 3 | 42.9% |
| src/format.ts | src/stats.ts | 3 | 23.1% |
| src/stats.ts | test/acceptance/run.ts | 3 | 18.8% |
| README.md | src/cli.ts | 3 | 15.8% |
| .forge/pr-description.md | .forge/skills/git-log-analysis/SKILL.md | 3 | 9.4% |
| .forge/pr-description.md | test/acceptance/run.ts | 3 | 9.4% |
| CHANGELOG.md | roadmap.md | 3 | 6.3% |
| CHANGELOG.md | src/stats.ts | 3 | 6.3% |
| CHANGELOG.md | test/author-churn.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/churn.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/cli-coupling.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/cli-csv.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/cli-sort.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/cli-top.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/compare-cli.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/coupling.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/exclude.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/hotspot.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/json-output.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/ownership.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/tags-git.test.ts | 3 | 6.3% |
| CHANGELOG.md | test/window.test.ts | 3 | 6.3% |
| .forge/demo/DEMO.html | .forge/demo/demo.lock.json | 2 | 100.0% |
| .forge/demo/DEMO.html | .forge/skills/demo-design/SKILL.md | 2 | 100.0% |
| .forge/demo/demo.lock.json | .forge/skills/demo-design/SKILL.md | 2 | 100.0% |
| forge/history/INIT-2026-07-11-cli-sort-flag/demo/DEMO.md | forge/history/INIT-2026-07-11-cli-sort-flag/demo/demo.json | 2 | 100.0% |
| forge/history/INIT-2026-07-11-csv-output-flag/demo/DEMO.md | forge/history/INIT-2026-07-11-csv-output-flag/demo/demo.json | 2 | 100.0% |
| forge/history/INIT-2026-07-11-exclude-path-filter/demo/DEMO.md | forge/history/INIT-2026-07-11-exclude-path-filter/demo/demo.json | 2 | 100.0% |
| forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/DEMO.md | forge/history/INIT-2026-07-11-init-2026-07-12-tags-command/demo/demo.json | 2 | 100.0% |
| test/tags-cli.test.ts | test/tags.test.ts | 2 | 100.0% |
| .forge/project.json | .gitignore | 2 | 66.7% |
| test/author-churn.test.ts | test/churn.test.ts | 2 | 66.7% |
| test/author-churn.test.ts | test/cli-coupling.test.ts | 2 | 66.7% |
| test/author-churn.test.ts | test/cli-csv.test.ts | 2 | 66.7% |
| test/author-churn.test.ts | test/cli-sort.test.ts | 2 | 66.7% |
| test/author-churn.test.ts | test/cli-top.test.ts | 2 | 66.7% |
| test/author-churn.test.ts | test/compare-cli.test.ts | 2 | 66.7% |
| test/author-churn.test.ts | test/coupling.test.ts | 2 | 66.7% |
| test/author-churn.test.ts | test/exclude.test.ts | 2 | 66.7% |
| test/author-churn.test.ts | test/hotspot.test.ts | 2 | 66.7% |
| test/author-churn.test.ts | test/json-output.test.ts | 2 | 66.7% |
| test/author-churn.test.ts | test
… (truncated)
```

### Prior: no --markdown flag existed. New: combining --markdown with --json (or --csv) exits non-zero and writes both flag names to stderr, with empty stdout.

- **Before:** No --markdown flag — conflict checking not applicable.
- **After:** runCli(['--markdown', '--json']) → code=1, stderr contains 'markdown' and 'json', stdout=''. Same for --markdown --csv and --csv --markdown (order-independent).

## API / Behaviour Diff

### gitpulse CLI options (changed)

**Before:**
```
Options: --json, --csv, --since, --until, --top, --compare, --exclude, --include, --sort, --no-merges, --author, --since-tag, --until-tag
```
**After:**
```
Options: --json, --csv, --markdown, --since, --until, --top, --compare, --exclude, --include, --sort, --no-merges, --author, --since-tag, --until-tag
```

### markdownEscape(field: string): string (added)

**After:**
```
Replaces each `|` with `\|`; returns field unchanged when no `|` present. No RFC-4180 double-quote wrapping.
```

### renderSummaryMarkdown(s: Summary, opts?): string (added)

**After:**
```
Returns GFM tables for commits, churn, file churn (optional), ownership (optional), hotspots (optional). Line 0 = header row; line 1 = delimiter row.
```

### renderDeltaMarkdown(result: CompareResult, opts?): string (added)

**After:**
```
Returns two GFM tables: headline (Metric/Head/Base/Delta) and per-author delta (Author/ΔCommits/ΔLines). Starts with `|`.
```

### renderTagsMarkdown(spans: TagSpan[], medianGapDays): string (added)

**After:**
```
GFM table with Tag/Date/Commits/Authors/Days since prev. Numeric cols right-aligned (`---:`), text cols left-aligned (`---`). Empty spans → header + delimiter only.
```

### renderCouplingMarkdown(rows: CouplingRow[], opts?): string (added)

**After:**
```
GFM table with fileA/fileB/co-changes/coupling% columns. Empty rows → header + delimiter only (no 'no coupled file pairs found' text). `|` in file paths escaped via markdownEscape.
```

## Test Evidence

| test | result | delta |
|---|---|---|
| test/format-markdown.test.ts — markdownEscape (AC1, AC2) | pass | +7 new tests |
| test/format-markdown.test.ts — renderSummaryMarkdown (AC3, AC4) | pass | +8 new tests |
| test/format-markdown.test.ts — renderDeltaMarkdown (AC5) | pass | +6 new tests |
| test/format-markdown.test.ts — renderTagsMarkdown (AC6, AC7) | pass | +8 new tests |
| test/format-markdown.test.ts — renderCouplingMarkdown (AC8, AC9) | pass | +8 new tests |
| test/cli-markdown.test.ts — single-snapshot --markdown (AC1) | pass | +4 new tests |
| test/cli-markdown.test.ts — --compare --markdown (AC2) | pass | +4 new tests |
| test/cli-markdown.test.ts — tags --markdown (AC3) | pass | +4 new tests |
| test/cli-markdown.test.ts — coupling --markdown (AC4) | pass | +4 new tests |
| test/cli-markdown.test.ts — --markdown --json conflict (AC5) | pass | +4 new tests |
| test/cli-markdown.test.ts — --markdown --csv conflict (AC6) | pass | +4 new tests |
| test/cli-markdown.test.ts — --csv --markdown conflict reversed (AC7) | pass | +4 new tests |
| test/cli-markdown.test.ts — --help --markdown USAGE (AC8) | pass | +2 new tests |
| test/acceptance/run.ts — --markdown delimiter row at index 1 (WI-3 AC1) | pass | acceptance gate extended |
| test/acceptance/run.ts — Ada Lovelace in pipe-delimited cell (WI-3 AC2) | pass | acceptance gate extended |
| test/acceptance/run.ts — pipe-char fixture file path escaped as \| (WI-3 AC4) | pass | acceptance gate extended |
| test/acceptance/run.ts — --compare v0.1 --markdown GFM table (WI-3 AC5) | pass | acceptance gate extended |
| All prior plain-text acceptance assertions (regression guard) | pass | byte-identical — no regressions |

> result: **pass**/**fail** · **skip** = not run in this gate (e.g. a live test with no credentials present) — not a failure · delta **new** = test added by this change.

## Files Changed

- `src/format.ts` — markdownEscape helper + gfmTable builder + renderSummaryMarkdown, renderDeltaMarkdown, renderTagsMarkdown, renderCouplingMarkdown renderers
- `src/cli.ts` — --markdown flag parsing + dispatch in runCli, runTagsCli, runCouplingCli; USAGE string updated; mutual-exclusion guards added
- `test/format-markdown.test.ts` — new file — 37 unit tests covering all 9 WI-1 ACs
- `test/cli-markdown.test.ts` — new file — 30 unit tests covering all 8 WI-2 ACs via injected io
- `test/acceptance/run.ts` — acceptance gate extended with 5 --markdown assertions (WI-3 ACs 1, 2, 4, 5) and pipe-character fixture repo
- `CHANGELOG.md` — v0.14.0 entry documenting --markdown flag and all new formatters
- `README.md` — --markdown documented in Options section

```
7 files changed, 1235 insertions(+), 1 deletion(-)
```

## Usage

```
# Single-snapshot GFM table
node dist/cli.js <repo-path> --markdown

# Compare-delta GFM table
node dist/cli.js <repo-path> --compare v0.1 --markdown

# Tags subcommand GFM table
node dist/cli.js tags <repo-path> --markdown

# Coupling subcommand GFM table
node dist/cli.js coupling <repo-path> --markdown

# Conflict guard (exits 1)
node dist/cli.js <repo-path> --markdown --json
# stderr: Error: --markdown and --json are mutually exclusive
```

## Impact

- Downstream pipelines and GitHub Actions can pipe `gitpulse --markdown` directly into PR comments or wiki pages without any post-processing.
- All four output modes (plain text, JSON, CSV, Markdown) are now available on every command — operators can choose the format that fits their toolchain.
- Pipe characters in commit metadata (file paths, author names) are safely escaped, so GFM renderers always see a valid table with consistent column counts.
- The `--help` text is updated to document `--markdown` alongside `--json` and `--csv` for discoverability.
