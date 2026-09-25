# Changelog

All notable changes to **gitpulse** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/). The `## [Unreleased]` section is the
in-cycle draft (forge's release contract C10); forge's release-finalizer promotes
it to a versioned heading at pre-merge, and CI tags + cuts the release on merge.

## [Unreleased]

## [0.15.1] - 2026-09-25

### Added

- `docs/usage.md`: comprehensive CLI flag reference covering every flag in `--help` order, with accepted values, defaults, worked examples, and documented known limitations (--author silently ignored on --compare path; range annotation absent from --markdown output; --since-tag/--until-tag exclusive/inclusive boundary asymmetry; tags subcommand flag compatibility matrix).

## [0.15.0] - 2026-09-05

### Added

- `--markdown` flag: emit GitHub-Flavoured Markdown tables for all table-producing commands (`gitpulse <repo> --markdown`, `--compare <ref> --markdown`, `tags --markdown`, `coupling --markdown`). Output starts directly with the GFM table header row (no prose intro line), so `output.split('\n')[1]` is always a delimiter row (`| --- |`). Mutually exclusive with `--json` and `--csv` (exits 1 with a descriptive error if combined).
- `markdownEscape(field)` helper in `src/format.ts`: escapes `|` characters as `\|` for safe GFM table cell embedding (no RFC-4180 double-quote wrapping).
- `renderSummaryMarkdown(summary)` in `src/format.ts`: renders a `Summary` as a bare GFM table (no intro prose, no section headings) with additional tables for churn, file churn, ownership, and hotspots separated by blank lines. Zero-author case produces header + delimiter row only.
- `renderDeltaMarkdown(result, opts?)` in `src/format.ts`: renders a `CompareResult` as two GFM tables (headline: Metric/Head/Base/Delta; per-author: Author/ΔCommits/ΔLines). First character of output is `|`.
- `renderTagsMarkdown(spans, medianGapDays)` in `src/format.ts`: renders a `TagSpan[]` as a GFM table with right-aligned numeric columns (Commits, Authors, Days since prev) and left-aligned text columns (Tag, Date); appends a median gap prose line.
- `renderCouplingMarkdown(rows, opts?)` in `src/format.ts`: renders a `CouplingRow[]` as a GFM table; file paths containing `|` are escaped via `markdownEscape`; empty rows produce header + delimiter only (no plain-text fallback).
- Acceptance gate in `test/acceptance/run.ts` extended with `--markdown` assertions (AC1–AC5): delimiter row at index 1, Ada Lovelace in a pipe-delimited cell, pipe-character escaping end-to-end via the built CLI, and compare-branch coverage.

## [0.14.0] - 2026-09-05

### Added

- `applyInclusions(commits, patterns)` pure function in `src/cli.ts`: filters a
  `Commit[]` so only files matching any of the given glob patterns survive.
  An empty patterns list is a no-op (fast-path, identical array returned).
  Commits whose every file is dropped are removed entirely to prevent inflated
  per-commit statistics. Empty-string patterns match nothing (consistent with
  `applyExclusions`). Covered by `test/include-filter.test.ts`.

## [0.13.0] - 2026-09-01

### Added

- `--since-tag <tag>` and `--until-tag <tag>` flags on all four CLI code paths
  (single-snapshot, `--compare`, `coupling` subcommand). Tag names are resolved
  to commit SHAs via `resolveTagToSha` and commits are filtered through
  `filterCommitsByTagRange` before summarization. The `tags` subcommand rejects
  these flags with exit code 2 and an explicit error message.
- Tag-range annotation in all three output formats: text headers gain
  `(range sinceTag..untilTag)`, JSON output gains a top-level `range` object
  with `sinceTag`, `untilTag`, `sinceSha`, `untilSha` keys, and CSV output
  gains a `# range: sinceTag..untilTag (sinceSha: ..., untilSha: ...)` comment
  line. Annotations are present even when the range yields zero commits.
- `TagRangeAnnotation` type exported from `src/format.ts` for use by callers.

- `resolveTagToSha(repoPath, tag)` in `src/git.ts`: resolves any tag name
  (annotated or lightweight) to its underlying commit SHA via
  `git rev-parse --verify <tag>^{commit}`. On failure throws a structured
  error carrying `code: 2`, the verbatim unknown tag name, and a
  sorted (newest-first) list of all known tags.
- `filterCommitsByTagRange(commits, { sinceTagSha, untilTagSha })` in new
  `src/tag-range.ts`: pure, zero-I/O filter that slices a `Commit[]`
  (newest-first) to a SHA-bounded window. `sinceTagSha` is the exclusive
  older boundary; `untilTagSha` is the inclusive newer boundary. Inverted
  or empty ranges return `[]`.
- `resolveEffectiveBounds(opts)` in `src/tag-range.ts`: picks the narrower
  of a `--since` date vs a `--since-tag` commit date (and similarly for
  `--until` / `--until-tag`), returning the effective bound plus a human-
  readable annotation naming which bound won and why.

## [0.12.0] - 2026-08-31

### Added

- `authorEmail: string` field on the `Commit` type in `src/git.ts`, populated
  from `%ae` (the 5th tab-separated field in `LOG_FORMAT`). All existing
  `parseLog` callers receive the new field automatically.
- `filterAuthorCommits(commits, patterns)` in new `src/author-filter.ts`:
  pure, zero-I/O filter that narrows a `Commit[]` by author name OR email
  using case-insensitive `*`-wildcard glob patterns (union / OR semantics).
  Returns `{ filtered: Commit[], excludedCount: number }`. An empty-string
  pattern matches nothing; `'*'` matches all; an empty patterns list is a
  pass-through.
- `--author <pattern>` flag (repeatable, OR'd) wired into all CLI paths:
  filters commits by author name or email using `*`-wildcard glob patterns
  (case-insensitive). Zero-match is a valid result (not an error) — the text
  report header carries `(N commits excluded by author filter)` and JSON
  output gains a top-level `authorsFiltered: N` field. Composes with
  `--no-merges`, `--since`, `--until`, `--exclude`, `--sort`, and all
  subcommands (`tags`, `coupling`). Wildcard vocabulary: `*` only (no `**`).
- Acceptance gate (`test/acceptance/run.ts`): seven new `--author` assertion
  blocks covering name glob (Ada Lovelace, AC1), email glob (grace@*, AC2),
  multi-flag OR (AC3), byte-identical wildcard `*` (AC4), zero-match nobody*
  (AC5), JSON `authorsFiltered` field (AC6), and the honest-count invariant
  `excluded + included = total` (AC7). All pre-existing assertions still pass.
- `README.md`: `--author` row added to the options table with description,
  wildcard vocabulary, multi-flag union semantics, composition notes, and
  zero-match behaviour.
- `roadmap.md`: `--author` filter entry (Feature 4d) marked as shipped.

## [0.11.0] - 2026-08-28

### Changed

- `Commit` type in `src/git.ts` now carries a `parentCount: number` field (0 for
  initial commits, 1 for regular commits, ≥2 for merge commits). The `LOG_FORMAT`
  appends `%P` (space-separated parent SHAs) so git log output is parsed into this
  field automatically.
- Removed `--no-merges` from `LOG_ARGS` in `src/git.ts`; merge commits are now
  included in all analytics commands by default. Callers that previously relied on
  implicit merge-commit exclusion should filter by `parentCount < 2` if needed.

### Added

- `--no-merges` CLI flag for `gitpulse`: filters out merge commits (commits
  with `parentCount > 1`) immediately after `readCommits()` and before
  aggregation. Text output annotates the header with `(N merge commits
  excluded)` when N > 0; JSON output gains a top-level `mergesExcluded` field
  (omitted when absent or N=0). The flag composes with `--since`, `--until`,
  `--exclude`, `--sort`, and `--json`. A `filterMergeCommits` pure function is
  exported from `src/cli.ts` for testability.

## [0.10.0] - 2026-08-28

### Added

- `computeCoupling(commits)` in `src/coupling.ts`: pure, zero-I/O analytics
  module that computes file co-change coupling from a `Commit[]`. Returns a
  sorted `CouplingRow[]` (coChanges, couplingPct) with normalised pair keys so
  file order within commits never produces duplicate rows.
- `gitpulse coupling <repo>` subcommand in `src/cli.ts`: dispatches the
  coupling analytics pipeline. Supports `--top N`, `--json`, `--csv`,
  `--exclude <glob>`, `--since <date>`, `--until <date>`. Glob exclusions are
  applied per-commit before `computeCoupling` so excluded files never appear in
  any pair row. Prints `no coupled file pairs found` (exit 0) when no pairs
  exist. Legacy `gitpulse <repo>` form unchanged.

## [0.9.0] - 2026-07-12

### Added

- `sortRecords<T>` helper in `src/sort.ts`: stable, type-safe sort of record
  arrays by a named column with `'asc'`/`'desc'` direction. Numeric columns
  are sorted by value (not lexicographically), text columns by direct `<`/`>`
  comparison. Input array is never mutated.
- `COLUMNS` registry in `src/sort.ts`: maps each command slug (`churn`,
  `ownership`, `hotspots`, `authors`, `compare`, `tags`) to the
  `ReadonlySet<string>` of valid sortable column names — used by the CLI to
  validate `--sort` arguments.
- `NUMERIC_COLUMNS` registry in `src/sort.ts`: per-slug subset of numeric
  columns, enabling default-direction inference in the upcoming `--sort` flag
  (WI-2).
- `--sort <column>[:asc|:desc]` CLI flag for `gitpulse` and `gitpulse tags`:
  sorts the primary output table by any valid column for the active command.
  Numeric columns default to descending; text columns default to ascending.
  Unknown column names or invalid direction tokens print a clear error and exit
  with code 2. When absent, output ordering is unchanged (backwards-compatible).
- Acceptance fixture coverage for `--sort`: the `npm run acceptance` gate now
  verifies sort ordering (ascending commits, descending author name, JSON and
  CSV output parity, `--compare` with sort, `tags --sort commitsSince:asc`,
  multiset invariant, and baseline stability without `--sort`). All six WI-3
  acceptance criteria are exercised against the deterministic temp-repo fixture.

## [0.8.0] - 2026-07-12

### Added

- `gitpulse tags [repo]` subcommand: release-cadence analytics table showing
  tag name, date, commits since previous tag, unique authors in that span, and
  days since the previous tag (newest-first). Footer line reports the median
  inter-tag gap in days. Zero-tag repos (or no tags in the `--since`/`--until`
  window) print "no tags found" and exit 0. Supports `--json` (structured
  object with `tags[]` and `medianGapDays`), `--csv` (RFC-4180 with header row
  and trailing Median Gap Days row), `--since`/`--until` (filter which tags
  appear in the output), and `--exclude` (commits touching only excluded paths
  are not counted in commitsSince). Both annotated and lightweight tags are
  supported; the backward-compatible legacy `gitpulse <path>` call site is
  unchanged. (`src/tags.ts`: `computeTagSpans` + `computeMedianGapDays` pure
  analytics; `src/format.ts`: `renderTagsTable`, `serializeTagsJson`,
  `renderTagsCsv`; `src/git.ts`: `readTags`, `readCommitsBetweenTags`,
  `parseTagsOutput`; `test/tags-git.test.ts` (13 unit), `test/tags.test.ts`
  (14 unit), `test/tags-cli.test.ts` (18 unit), `test/acceptance/run.ts`: new
  `makeTagsFixtureRepo()` + tags sentinel assertions proving v0.3 commitsSince=2,
  uniqueAuthors=2, daysSince=19; v0.2 daysSince=13; v0.1 daysSince=null;
  medianGapDays=16.)

## [0.7.0] - 2026-07-12

### Added

- `csvEscape(field: string): string` helper in `src/format.ts`: RFC-4180 CSV
  field escaping — wraps fields in double-quotes and doubles inner double-quotes
  when the field contains a comma, double-quote, or newline; returns plain fields
  unchanged (no unnecessary quoting). Unicode fields are preserved without
  corruption. (`test/format-csv.test.ts`: 5 unit tests covering all ACs.)
- Seven CSV renderer functions in `src/format.ts` for all table types:
  `renderAuthorsCsv`, `renderChurnFileCsv`, `renderChurnAuthorCsv`,
  `renderOwnershipCsv`, `renderHotspotsCsv`, `renderCompareCsv`, and
  `renderSummaryCsv`. Each produces a RFC-4180-escaped CSV string with a
  correct header row. `renderCompareCsv` emits two sections (headline then
  per-author) separated by a blank row. `renderSummaryCsv` emits all applicable
  sections in the same order as the text renderer, omitting empty sections.
  Numeric values are drawn directly from pre-aggregated data objects — no
  re-computation. (`test/format-csv.test.ts`: 55 new unit tests covering all ACs.)
- `--csv` flag for the `gitpulse` CLI (`src/cli.ts`): when passed, all analytics
  commands emit RFC-4180 CSV to stdout instead of the human-readable table. The
  flag is mutually exclusive with `--json` — passing both exits 1 with a clear
  stderr message `"Error: --csv and --json are mutually exclusive"`. The default
  summary path calls `renderSummaryCsv`; the `--compare` path calls
  `renderCompareCsv`. Human-table output when neither flag is passed is
  byte-for-byte unchanged (no regression). (`test/cli-csv.test.ts`: 9 unit
  tests; `test/acceptance/run.ts`: acceptance fixture assertions for `--csv` and
  `--csv --compare`.)
- Acceptance fixture extended with CSV read-back assertions
  (`test/acceptance/run.ts`): two new fixture runs verify `--csv` (author CSV
  header present, 2 author data rows with Ada Lovelace sentinel first at 5
  commits) and `--csv --compare v0.1` (two-section CSV, blank-row separator,
  correct per-author header). All pre-existing assertions still pass.

## [0.6.1] - 2026-07-11

### Added

- In-repo glob matcher (`src/glob.ts`): new `matchGlob(pattern, path)` function
  supporting `**` (depth-unlimited wildcard), `*` (single-segment wildcard), and
  exact-match patterns — the foundation for the `--exclude` path-filter flag
  (WI-2).
- `--exclude <pattern>` flag for `gitpulse` CLI (`src/cli.ts`): repeatable flag
  that filters out file paths matching glob patterns from all analytics output.
  Filtered paths are excluded from `fileChurn`, `ownershipEntries`, and
  `hotspotEntries`; author churn totals reflect only non-excluded files. The text
  report header is annotated with `(N paths excluded)` when N > 0 (including N = 0
  when the pattern matches nothing). JSON output gains a top-level `excluded: N`
  field when `--exclude` is passed. An empty pattern (`--exclude ''`) exits
  non-zero (code 2) with a clear error message. The `--compare` path applies the
  same filtering to both HEAD and base commit sets. No change to output when
  `--exclude` is absent (backward-compatible). (`test/exclude.test.ts`: 22 new
  unit tests covering all ACs.)
- Acceptance fixture extended with vendored/generated path commits
  (`test/acceptance/run.ts`): fixture repo now includes two extra commits
  touching `dist/bundle.js` and `vendor.lock` (sentinel content
  `sentinel-excluded`). Three new acceptance assertions verify the built CLI
  with `--exclude 'dist/**' --exclude '*.lock'`: excluded files are absent from
  the text report, the `(N paths excluded)` header annotation is present, and
  the JSON `excluded` field equals 2. Backward-compatibility assertion confirms
  the plain (no-`--exclude`) run produces no exclusion annotation. All
  pre-existing assertions still pass.

## [0.5.1] - 2026-06-22

### Added

- Pure delta model for `--compare <ref>` analytics (`src/compare.ts`): new
  `computeDelta(base, head, ref)` function that accepts two `Summary` snapshots
  and returns a `CompareResult` with signed headline deltas (commits,
  linesAdded, linesRemoved) and per-author `AuthorDelta` entries (base/head/
  delta commits and churn) sorted descending by `|deltaCommits|`.
- Delta rendering (`src/format.ts`): new `renderDelta(result, opts?)` function
  that produces a plain-text report with a headline table (head/base/delta
  columns, signed values `+N`/`-N`/`0`) and a per-author delta table sorted
  by `|Δcommits|` descending; `opts.top` truncates the author list. New
  `serializeDelta(result)` function that serialises a `CompareResult` as
  2-space-indented JSON.
- `--compare <ref>` CLI flag (`src/cli.ts` + `src/git.ts`): wires the delta
  model and rendering into the `gitpulse` entry point. When `--compare <ref>`
  is passed, `validateRef` checks the ref is valid (exit 2 + stderr containing
  the ref name on failure), then `readCommitsAtRef` reads the base snapshot, and
  `computeDelta` / `renderDelta` produce a "delta since <ref>" report. Combines
  with `--json` (outputs `CompareResult` JSON with a top-level `delta` key) and
  `--top`. The single-snapshot output path is fully unchanged when `--compare`
  is absent (no regression). New `test/compare-cli.test.ts` covers all four ACs.
- Acceptance fixture extended with git tags (`test/acceptance/run.ts`): fixture
  repo now places a `v0.1` tag after the initial commits and adds two further
  Ada Lovelace commits before tagging `v0.2` at HEAD. Three new acceptance
  assertions verify `--compare v0.1` (stdout contains "delta since v0.1" and
  correct inter-tag author), `--compare nonexistent-tag` (non-zero exit + stderr
  with ref name), and `--compare v0.1 --json` (`delta.commits` equals
  `COMPARE_INTER_TAG_COMMITS`). All pre-existing assertions still pass.

## [0.4.0] - 2026-06-21

### Added

- `--json` flag for `gitpulse`: when passed, the CLI outputs the full analytics
  summary as a JSON string to stdout (instead of the human-readable table).
  JSON shape: `{ totalCommits, firstDate, lastDate, byAuthor, authorChurn,
  fileChurn, ownershipEntries, hotspotEntries }`. Error behaviour (exit codes 1
  and 2) is unchanged. `--top` cap applies to all arrays in JSON output as it
  does for table output. (`src/format.ts`: new `serializeSummary` export;
  `src/cli.ts`: `--json` flag wired through arg parser.)

## [0.3.0] - 2026-06-21

### Added

- Churn × recency hotspot ranking (`src/hotspot.ts`: `computeHotspots` takes a
  `Commit[]` and a `referenceDate` string, computes per-file scores using
  `score = commits / (daysSince + 1)` where `daysSince` is calendar days between
  the file's most-recent commit date and `referenceDate`, and returns
  `HotspotEntry[]` sorted by score descending (ties broken by file path
  ascending). Files changed recently score higher than stale files with the same
  commit count. Negative `daysSince` values are clamped to 0 to handle
  edge-case reference dates earlier than a file's last commit date.

- File ownership + bus-factor analysis (`src/ownership.ts`: `computeOwnership`
  takes the commit list and repo path, runs `git blame --porcelain` per file,
  and returns `FileOwnership[]` sorted by descending bus-factor with file-path
  tie-break). Each entry exposes `owner` (author with most surviving lines),
  `ownerLines`, and `busFactor` (distinct authors with ≥1 surviving line).
  Files where blame fails (deleted, binary) are omitted gracefully. The pure
  `parseBlameOutput` helper is exported separately for unit testing without I/O.

- `--top <n>` flag for the `gitpulse` CLI (`src/cli.ts`): caps every ranked
  list (byAuthor, authorChurn, fileChurn, ownershipEntries, hotspotEntries) to
  the top `n` entries. Requires an integer `n >= 1`; exits 2 with a descriptive
  stderr message for `--top 0`, non-integer values, or a missing value. Combines
  correctly with `--since`/`--until` (date filter applied first, then top-cap).
  `summarize` (`src/stats.ts`) extended with an optional `{ top?, repoPath? }`
  options argument; backward-compatible (no options = no cap). `Summary` type
  gains `ownershipEntries` and `hotspotEntries` fields, always present and typed.

- Ownership and hotspot sections in CLI output (`src/format.ts`): `renderSummary`
  now appends an **ownership** table (columns: owner, bus-factor, file) and a
  **hotspots** table (columns: score, commits, last-date, file) at the end of the
  report when the respective `Summary` fields are non-empty. Both sections are
  omitted entirely when the data is empty (no heading, no table). Score values are
  rendered to 2 decimal places and right-aligned; bus-factor values are
  right-aligned. The ownership section appears before hotspots, after all churn
  tables. Unit tests added in `test/format-new.test.ts`.

## [0.2.0] - 2026-06-21

### Added

- Date-window filtering for `gitpulse` CLI (`src/cli.ts`): `--since <YYYY-MM-DD>`
  and `--until <YYYY-MM-DD>` flags restrict the commit range passed to `summarize`.
  Both bounds are inclusive; string comparison on ISO-8601 dates is exact. Validation
  rejects malformed dates (exit 2) and reversed windows where `--since` is later than
  `--until` (exit 2). Omitting either flag preserves the existing all-history behaviour.

- Per-author code-churn summary (`src/stats.ts`: `summarize` now populates
  `authorChurn` — per-author `insertions` and `deletions` accumulated from all
  commits, sorted by total lines changed descending with author-name ascending
  tie-break). The `AuthorChurn` type is exported alongside `AuthorCount`.
  `renderSummary` (`src/format.ts`) appends a `churn (lines)` table after the
  commit-count table showing `+ins/-del` per author in churn order. Backwards
  compatible: all existing `byAuthor` / `renderSummary` contracts unchanged.

- Per-file code-churn aggregation (`src/churn.ts`: `computeChurn` → per-file
  insertions, deletions, and commit counts, sorted by total lines changed
  descending with tie-break on file path ascending). Binary numstat (`-`)
  entries are treated as 0 lines; renamed files (`{old => new}` numstat path
  syntax) are counted under the new path. The `Commit` type in `src/git.ts`
  gains a `files` field so `computeChurn` can operate on per-file data without
  re-parsing git output.

## [0.1.0] - 2026-06-21

### Added

- Git-history reading (`src/git.ts`: `readCommits` via `git -C <repo> log
  --no-merges --numstat`) with binary-`-` numstat tolerance and non-repo fail-fast.
- Pure commit aggregation (`src/stats.ts`: `summarize` → total commits,
  per-author counts (descending, name tie-break), and the first/last date range).
- Deterministic text rendering (`src/format.ts`) and the `gitpulse <repo>` CLI
  (`src/cli.ts`) with fail-fast argv validation + `--help`.
- Unit quality gate (`npm test`, pure) and a creds-free acceptance gate
  (`npm run acceptance`) that builds a deterministic temp git repo and reads back
  the built CLI's analytics.
