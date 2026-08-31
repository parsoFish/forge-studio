---
title: "--author silently ignored under --compare; acceptance suite had no --compare + --author assertion"
description: >-
  filterAuthorCommits() was wired into runCli single-snapshot, runTagsCli, and runCouplingCli but
  not into the --compare branch. gitpulse /repo --compare v1.0 --author Ada* returns an unfiltered
  delta with no warning. Adversarial review caught it; none of the 7 WI-3 acceptance assertions
  tested this composition.
category: antipattern
keywords:
  - author-filter
  - compare
  - silent-discard
  - acceptance-gap
  - composition
  - filterAuthorCommits
  - subcommand-coverage
  - adversarial-review
related_themes: [2026-08-31-author-filter-flag-delivery, 2026-06-21-acceptance-gate-covers-only-headline-output, 2026-08-31-tag-range-dead-code-ac4-wire]
created_at: 2026-08-31T02:15:00.000Z
updated_at: 2026-08-31T02:15:00.000Z
---

# `--author` silent discard under `--compare`

## What happened

`src/cli.ts` applies `filterAuthorCommits()` in three code paths:

1. Single-snapshot `runCli` (after path exclusions + merge filter, before `summarize()`) ✓
2. `runTagsCli` (per tag-span commit list) ✓
3. `runCouplingCli` (before coupling aggregation) ✓

But the compare branch (`if (compare !== null)`, lines 719–773 of `src/cli.ts` as of the merged PR) passes `headCommits` and `baseCommits` directly into `summarize()` without calling `filterAuthorCommits()`. Result: `gitpulse /repo --compare v1.0 --author Ada*` returns an unfiltered delta — identical output to running without `--author`. No warning, no error, no annotation.

The PR description stated "all subcommands inherit the filter transparently" — technically true for independent subcommands (tags, coupling) but not for the compare mode within `runCli`.

## Why it was missed

- The manifest's `## Edge cases` table listed `--since --author` composition as covered and `--no-merges --author` as covered, but had **no entry for `--compare --author`**.
- WI-3's 7 acceptance assertions (ACs 20–26) covered name-glob, email-glob, OR-union, byte-identical, zero-match, JSON field, and honest-count — all against the single-snapshot (`gitpulse <repo> --author ...`). No `--compare --author` test.
- The WI-2 gate (`node --test --experimental-strip-types test/author-filter-cli.test.ts`) and WI-3 gate (`npm run acceptance`) both passed; neither exercised the compare code path with `--author`.

## Impact

Merged with RF-1 (major, adversarial review finding). `--compare --author` is silently broken. Users who combine the flags receive unfiltered delta output.

## Fix

Apply `filterAuthorCommits(headCommits, authorPatterns)` and `filterAuthorCommits(baseCommits, authorPatterns)` in the compare branch before `summarize()`. Add an acceptance assertion: `--compare main --author Ada*` should produce a filtered delta. Alternatively, reject the combination with exit 2 (following the pattern of tags subcommand rejecting unsupported flags).

## Prevention

When a new filter/flag is added that applies "to all subcommands," the manifest's edge-case table and acceptance assertions should enumerate **every distinct code path** in `cli.ts` that invokes aggregators — not just the headline path. The compare branch is a separate aggregation pipeline from the single-snapshot path.

## Sources

- `_logs/2026-08-31T01-33-01_INIT-2026-08-31-init-2026-08-31-author-filter-flag/events.jsonl` — `review.findings.authored` (major RF-1); `reviewer.pr-opened` (PR #13)
- `/home/parso/forge-m2-b/_logs/INIT-2026-08-31-init-2026-08-31-author-filter-flag/artifacts/review-findings.json` — RF-1 detail with `src/cli.ts` line references
- `/home/parso/forge-m2-b/brain/cycles/_raw/2026-08-31T01-33-01_INIT-2026-08-31-init-2026-08-31-author-filter-flag.md`

## See also

- [[2026-08-31-author-filter-flag-delivery]] — the delivery pattern this gap belongs to
- [[2026-06-21-acceptance-gate-covers-only-headline-output]] — prior cycle's theme on acceptance gate covering only the headline happy-path; same class of gap
- [[2026-08-31-tag-range-dead-code-ac4-wire]] — analogous gap: function unit-tested in isolation but not imported by cli.ts; same incomplete-coverage class
