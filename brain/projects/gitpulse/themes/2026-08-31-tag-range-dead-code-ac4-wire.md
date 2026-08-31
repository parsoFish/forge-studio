---
title: "resolveEffectiveBounds exported and unit-tested but never imported by cli.ts — AC4 wire is dead code"
description: >-
  src/tag-range.ts exports resolveEffectiveBounds() for the narrower-date-wins + annotation contract (AC4).
  Unit tests pass. src/cli.ts never imports it — the CLI applies --since and filterCommitsByTagRange as two
  independent sequential passes with no annotation. Caught by adversarial review (RF-1 major); no per-WI
  gate detected the absent import.
category: antipattern
keywords:
  - resolveEffectiveBounds
  - dead-code
  - cli-wire
  - acceptance-gap
  - since-tag
  - since
  - narrower-bound
  - unit-test-passes-end-to-end-fails
  - adversarial-review
  - ac4
related_themes: [2026-08-31-tag-range-filter-delivery, 2026-08-31-author-filter-compare-coverage-gap, 2026-06-21-acceptance-gate-covers-only-headline-output]
created_at: 2026-08-31T22:30:00.000Z
updated_at: 2026-08-31T22:30:00.000Z
---

# `resolveEffectiveBounds` dead code — AC4 wire absent

## What happened

AC4 required: `--since-tag v1.0.0` + `--since 2024-03-01` (date bound narrower) → only commits after 2024-03-01, with header annotation naming which bound was applied.

`src/tag-range.ts` exports `resolveEffectiveBounds(opts)`. The WI-1 unit test file (`test/tag-range.test.ts`) exercises it in isolation — all 17 tests pass. The WI-1 gate (`node --test test/tag-range.test.ts`) passed.

`src/cli.ts` imports only `filterCommitsByTagRange` from `./tag-range.ts` — confirmed by the only import line at line 24:
```
import { filterCommitsByTagRange } from './tag-range.ts';
```
`resolveEffectiveBounds` is never imported, never called. The CLI applies the `--since` date filter (lines 886–893) and `filterCommitsByTagRange` (lines 896–898) as two independent sequential passes. The narrower-bound logic is never executed at runtime. The annotation is never emitted.

The WI-2 CLI unit test gate (`node --test test/cli-tag-range.test.ts`) also passed — meaning the CLI unit tests did not assert the end-to-end `--since-tag --since` composition with annotation output.

The WI-3 acceptance suite (`npm run acceptance`) contains no `--since-tag --since` composition assertion.

Adversarial review (RF-1, major) caught it by grepping all import and call sites.

The PR description stated: "src/cli.ts calls resolveEffectiveBounds() before filtering" — this claim was false.

## Why it was missed

- WI-1 scope: pure module + unit tests. Gate: unit test file. The unit test tests the function in isolation → green. No import-check in the gate.
- WI-2 scope: CLI wiring. Gate: CLI unit tests. The CLI unit tests apparently did not assert the `--since-tag --since` composition annotation in the rendered output.
- WI-3 scope: acceptance + docs. Gate: `npm run acceptance`. The acceptance fixture has no `--since-tag --since` composition test case.
- The AC4 end-to-end contract required: (a) the narrower bound is selected and (b) the header **names which was applied**. Only (a) was loosely satisfied by the independent passes; (b) was never tested at any boundary.

## Pattern

**Unit-test-passes / end-to-end-fails**: a function is exported, exercised in isolation (all green), but not connected to the runtime call path. This is the inverse of the `--author --compare` gap (that was a function called in 3 paths but not a 4th) — here the function is called in ZERO paths.

Distinct from `2026-08-31-author-filter-compare-coverage-gap` in structure (absent import vs missing code path) but same root cause: a CLI composition AC that was verified at the pure-module level only, without an end-to-end CLI assertion covering the composed behaviour.

## Fix

1. Import `resolveEffectiveBounds` in `src/cli.ts` and call it before `filterCommitsByTagRange` when both `--since-tag` and `--since` are present.
2. Add a CLI unit test in `test/cli-tag-range.test.ts`: `--since-tag --since <narrower>` → output annotation names which bound was applied.
3. Optionally: add an acceptance test for the composition.

## Prevention

When an AC requires an end-to-end observable output (header annotation, JSON field, exit code) based on a new function, the WI gate for CLI wiring must assert that output — not just that the function's unit tests pass. A `grep imports` scan could catch absent-import dead-code at gate time.

## Sources

- `_logs/2026-08-31T21-40-58_INIT-2026-08-31-init-tag-range-filter/events.jsonl` — `review.findings.authored` (RF-1 major)
- `_logs/INIT-2026-08-31-init-tag-range-filter/artifacts/review-findings.json` — RF-1 full detail with file/line evidence
- `/home/parso/forge-m3-a/brain/cycles/_raw/2026-08-31T21-40-58_INIT-2026-08-31-init-tag-range-filter.md`

## See also

- [[2026-08-31-tag-range-filter-delivery]] — the delivery this gap belongs to
- [[2026-08-31-author-filter-compare-coverage-gap]] — prior cycle: filter wired in 3 paths but not the 4th (compare); same class of incomplete-path coverage
- [[2026-06-21-acceptance-gate-covers-only-headline-output]] — acceptance gate covers only headline code path; same class
