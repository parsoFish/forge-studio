---
title: "--since-tag / --until-tag release-window filter delivered; 3-WI TDD chain, all 1 iteration"
description: >-
  --since-tag (exclusive) and --until-tag (inclusive) resolve annotated and lightweight tags via
  git rev-parse --verify <tag>^{commit}; pure filterCommitsByTagRange in src/tag-range.ts; all
  four CLI paths wired; text/JSON/CSV renderers carry range annotation. 3-WI TDD chain, each
  1 iteration. resolveEffectiveBounds implemented but not wired in CLI (AC4 dead code — RF-1 major).
category: pattern
keywords:
  - tag-range
  - since-tag
  - until-tag
  - filterCommitsByTagRange
  - resolveTagToSha
  - tag-range.ts
  - git-truth-seam
  - release-window
  - tdd
  - annotated-tag
  - dereference
related_themes: [2026-08-31-author-filter-flag-delivery, 2026-07-11-tags-command-delivery, git-truth-and-pure-aggregation, 2026-08-31-tag-range-dead-code-ac4-wire, 2026-08-31-gitignored-scratch-eighth-cycle]
created_at: 2026-08-31T22:30:00.000Z
updated_at: 2026-08-31T22:30:00.000Z
---

# `--since-tag` / `--until-tag` delivery pattern

## What was built

- `src/git.ts`: `resolveTagToSha(repoPath, tag)` — shells `git rev-parse --verify <tag>^{commit}` (args array, no shell injection). Annotated tags: dereferences tag-object SHA → commit SHA. Unknown tag: throws structured error with `.code=2`, `.unknownTag`, `.knownTags` (newest-first from existing `readTags()`).
- `src/tag-range.ts` (new): `filterCommitsByTagRange(commits, {sinceTagSha?, untilTagSha?})` — pure array slice, no git spawn. Exclusive lower bound (since-tag commit excluded), inclusive upper bound. `resolveEffectiveBounds()` also exported — merges date bound with tag-commit-date bound, picks narrower, produces annotation. **Not imported by `src/cli.ts` — dead code post-merge (RF-1 major).**
- `src/cli.ts`: `--since-tag` / `--until-tag` parsed; `resolveTagToSha` called for each; `filterCommitsByTagRange` applied before aggregators in single-snapshot, `--compare`, `runTagsCli` (rejection exit 2), `runCouplingCli`. Tags subcommand rejects both flags with exit 2 + message.
- `src/format.ts`: `renderSummary`, `serializeSummary`, `renderSummaryCsv` extended with optional `TagRangeAnnotation`. Text: `(range v1.0.0..v2.0.0)`. JSON: `range: {sinceTag, untilTag, sinceSha, untilSha}`. CSV: `# range: ...` comment. Annotation emitted even when zero commits in window.
- `test/tag-range.test.ts` (new): 17 unit tests for `filterCommitsByTagRange` and `resolveEffectiveBounds`.
- `test/cli-tag-range.test.ts` (new): CLI unit tests with injected io — single-snapshot, `--compare`, coupling, tags rejection, all renderers.
- `test/acceptance/run.ts`: `makeTagRangeFixtureRepo()` — Charles Babbage fixture with fixed topology (PRE → annotated v1.0.0 → INTER-1 → INTER-2 → lightweight v2.0.0 → POST), fixed GIT_AUTHOR_DATE. 7 integration assertions covering `--since-tag`, `--until-tag`, `--json` SHA verification, `--compare` composition, inverted range, tags rejection, unknown-tag listing.

## WI decomposition

| WI | Scope | Iter | Files | +/- | Cost |
|---|---|---|---|---|---|
| WI-1 | git.ts + tag-range.ts + unit tests | 1 | 4 | +563/-0 | $0.92 |
| WI-2 | cli.ts wiring + format.ts + CLI unit tests | 1 | 4 | +503/-15 | $1.84 |
| WI-3 | acceptance fixture + README + help text | 1 | 3 | +346/-0 | $4.02 |
| **Total** | | | 9 | +1412/-15 | $6.78 |

## Key design decisions

- No Commit model change → no fixture-factory sweep (contrast: `--author` added `authorEmail`, swept 27 factories).
- Tag range applied at seam after readCommits, before all aggregators — same discipline as `--exclude`, `--no-merges`, `--author`.
- `resolveTagToSha` reuses `readTags()` pattern from `src/tags.ts` for the annotated-tag dereference. No new git-spawn sites.
- `--since-tag` + `--since` date conflict: AC4 spec required `resolveEffectiveBounds` to pick the narrower bound with annotation. The function was implemented and unit-tested but not wired in cli.ts — RF-1 (major) post-merge finding.

## Gate pattern

`gate.expected-fail` at iter=0 for all 3 WIs (test file not yet written); `gate.pass` at iter=1. No false-pass.

## Sources

- `_logs/2026-08-31T21-40-58_INIT-2026-08-31-init-tag-range-filter/events.jsonl` — `ralph.end` WI-1/WI-2/WI-3; `dev-loop.delivered` totals
- `/home/parso/forge-m3-a/brain/cycles/_raw/2026-08-31T21-40-58_INIT-2026-08-31-init-tag-range-filter.md`
- `_logs/INIT-2026-08-31-init-tag-range-filter/artifacts/review-findings.json` — RF-1 through RF-4

## See also

- [[2026-08-31-author-filter-flag-delivery]] — structural twin (filter-at-seam, 3-WI TDD chain, no Commit field change)
- [[2026-07-11-tags-command-delivery]] — `readTags()` pattern reused for annotated-tag dereference
- [[git-truth-and-pure-aggregation]] — the seam this filter extends
- [[2026-08-31-tag-range-dead-code-ac4-wire]] — the AC4 wire gap (resolveEffectiveBounds not imported)
- [[2026-08-31-gitignored-scratch-eighth-cycle]] — scratch-file sweep recurrence this cycle
