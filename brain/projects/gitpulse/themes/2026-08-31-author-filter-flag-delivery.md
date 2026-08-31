---
title: "--author glob filter delivered via dedicated pure module; OR-semantics, name+email, applied at seam"
description: >-
  Repeatable --author <glob> flag filters commits by name OR email (case-insensitive, *-only wildcard)
  via src/author-filter.ts, applied immediately after readCommits() before any aggregator. 3-WI TDD
  chain, all 1 iteration. Adding authorEmail to Commit required updating 27 test fixture factories.
category: pattern
keywords:
  - author-filter
  - author-email
  - filterAuthorCommits
  - author-filter.ts
  - git-truth-seam
  - tdd
  - breaking-change
  - fixture-sweep
  - or-semantics
  - case-insensitive
related_themes: [2026-08-28-no-merges-flag-delivery, 2026-07-11-exclude-path-filter-single-seam, git-truth-and-pure-aggregation, 2026-08-31-author-filter-compare-coverage-gap]
created_at: 2026-08-31T02:15:00.000Z
updated_at: 2026-08-31T02:15:00.000Z
---

# `--author` flag: delivery pattern

## What was built

- `src/git.ts`: `LOG_FORMAT` extended with `%x09%ae` (5th tab-separated field). `parseLog()` reads `parts[4]` → `authorEmail: string` (non-optional, required field). All 27 test fixture factories updated with `authorEmail: ''` or explicit email values.
- `src/author-filter.ts` (new): `filterAuthorCommits(commits, patterns)` → `{ filtered: Commit[], excludedCount: number }`. Each pattern compiled to a case-insensitive regex via `*`-split inline builder (no import from `src/glob.ts` — path-segment-aware glob not suitable for author strings). Commit passes if ANY pattern matches its `author` (name) OR `authorEmail` independently. Empty-string pattern → matches nothing. `*` → matches everything.
- `src/cli.ts`: `--author` parsed as repeatable flag (collected into `string[]`) in `runCli`, `runTagsCli`, `runCouplingCli`. `filterAuthorCommits` called after path exclusions + merge filter, before any aggregator. Text annotation: `(N commits excluded by author filter)` when N > 0. JSON: `authorsFiltered: N`. CSV: `# authorsFiltered: N` comment line.
- `test/author-filter.test.ts` (new): 21 pure unit tests (parentCount, authorEmail field, filterAuthorCommits all cases).
- `test/author-filter-cli.test.ts` (new): 15 injected-IO unit tests (flag parsing, composition, zero-match, empty-string rejection exit 2).
- `test/acceptance/run.ts`: 7 new assertion blocks (name-glob, email-glob, OR-union, byte-identical, zero-match, JSON field, honest-count).

## WI decomposition

| WI | Scope | Iter | Files | +/- | Cost |
|---|---|---|---|---|---|
| WI-1 | git.ts + author-filter.ts + 27 fixture updates | 1 | 23 | +391/-23 | $3.05 |
| WI-2 | cli.ts wiring + author-filter-cli.test.ts | 1 | 2 | +483/-3 | $1.39 |
| WI-3 | acceptance assertions + README + roadmap | 1 | 4 | +178/-0 | $1.16 |
| **Total** | | | 28 | +1052/-26 | $5.60 |

## Key design decisions

- `authorEmail` is non-optional on `Commit` — fails loudly if missing; consequence: 27 test files required updates in WI-1 (same pattern as `parentCount` requiring 20 files in no-merges cycle). WI-1 scope was wide but completed in 1 iteration.
- Separate inline matcher, not `src/glob.ts` — path-aware `matchGlob` normalises hyphens and handles segments; that semantics doesn't apply to author strings.
- Filter at seam: all subcommands (`tags`, `coupling`, and all renderers) inherit transparently. **Exception found post-merge: `--compare` branch skipped filter (see `2026-08-31-author-filter-compare-coverage-gap`).**
- Byte-identical invariant: `--author '*'` on any repo produces output identical to an unfiltered run.

## Gate pattern

`gate.expected-fail` at iter=0 for all 3 WIs (test file / acceptance paths not yet written); gate-diff-requirement forced iter=1 where real work happened. No iter=0 false-pass.

## Sources

- `_logs/2026-08-31T01-33-01_INIT-2026-08-31-init-2026-08-31-author-filter-flag/events.jsonl` — `ralph.end` WI-1/WI-2/WI-3; `dev-loop.delivered` totals
- `/home/parso/forge-m2-b/brain/cycles/_raw/2026-08-31T01-33-01_INIT-2026-08-31-init-2026-08-31-author-filter-flag.md`

## See also

- [[2026-08-28-no-merges-flag-delivery]] — structural twin (breaking-change field sweep; filter at seam; byte-identical invariant)
- [[2026-07-11-exclude-path-filter-single-seam]] — filter-at-seam discipline + text annotation + JSON field conventions
- [[git-truth-and-pure-aggregation]] — the seam this filter extends
- [[2026-08-31-author-filter-compare-coverage-gap]] — coverage gap found post-merge: compare branch skips the filter
