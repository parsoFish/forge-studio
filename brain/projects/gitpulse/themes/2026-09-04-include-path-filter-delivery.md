---
title: "--include glob filter delivered inline in cli.ts; all 4 code paths + compare path covered; 3-WI TDD chain"
description: >-
  `applyInclusions(commits, patterns)` inlined in src/cli.ts (mirrors applyExclusions). Applied in all
  4 CLI code paths including the compare branch — explicitly pre-empting the RF-1 gap from the prior
  --author cycle. 3-WI TDD chain, all 1 iteration. +1225/-34, 6 files, PR #15, v0.14.0.
category: pattern
keywords:
  - include-filter
  - applyInclusions
  - cli.ts
  - glob
  - compare-path
  - tdd
  - all-four-code-paths
  - byte-identical-invariant
  - filter-at-seam
  - or-semantics
related_themes: [2026-07-11-exclude-path-filter-single-seam, 2026-08-31-author-filter-flag-delivery, 2026-08-31-author-filter-compare-coverage-gap, git-truth-and-pure-aggregation, 2026-08-31-tag-range-filter-delivery, 2026-09-05-markdown-output-flag-delivery]
created_at: 2026-09-04T16:06:03.000Z
updated_at: 2026-09-04T16:06:03.000Z
---

# `--include` flag: delivery pattern

## What was built

- `src/cli.ts`: `applyInclusions(commits, includePatterns)` inlined (not a separate module). Mirrors `applyExclusions` structurally. Fast-path when `patterns` is empty (same-array reference). Filters `CommitFile[]` within each `Commit`; removes commits that end up file-empty.
- `src/cli.ts`: `--include` parsed as repeatable flag in all three argv parsers (`runCli`, `runTagsCli`, `runCouplingCli`). Same validation structure as `--exclude`: undefined-next-token → exit 2 "requires a value"; empty-string → exit 2 "requires a non-empty pattern".
- Pipeline order: `applyInclusions` runs before `applyExclusions`, `filterMergeCommits`, `filterAuthorCommits` in single-snapshot and compare paths.
- **Compare path explicitly covered**: `applyInclusions` applied to both `headCommits` and `baseCommits` before `summarize()` — AC-2.2 mandated this, preventing recurrence of the RF-1 compare-gap from the prior `--author` cycle.
- Output annotations: text `(N paths excluded by include filter)`, JSON `includeFiltered: N`, CSV `# includeFiltered: N`.
- `test/include-filter.test.ts` (new): 13 pure unit tests.
- `test/include-filter-cli.test.ts` (new): 21 CLI-layer unit tests (all 4 paths, validation, annotations).
- `test/acceptance/run.ts`: 12 acceptance assertions including compare path (AC-5), tags subcommand (AC-6), and byte-identical invariant `--include '**'` (AC-7).

## WI decomposition

| WI | Scope | Iter | Files | +/- | Cost (est) |
|---|---|---|---|---|---|
| WI-1 | applyInclusions inline + pure unit tests | 1 | 3 | +248/-0 | ~$0.39 |
| WI-2 | CLI wiring (4 code paths) + CLI unit tests | 1 | 2 | +572/-1 | ~$1.06 |
| WI-3 | Acceptance assertions + README + CHANGELOG | 1 | 2 | +405/-33 | ~$1.60 |
| **Total** | | | **6** | **+1225/-34** | **~$3.05** |

## Key design decisions

- **Inline vs module**: chose inline in `src/cli.ts` to mirror `applyExclusions` and avoid dead-code risk seen in tag-range cycle (`2026-08-31-tag-range-dead-code-ac4-wire`). WI-1 gate included `grep -q 'applyInclusions' src/cli.ts` dead-code guard.
- **Include before exclude**: pipeline order mandated so `--include 'src/**' --exclude '**/*.test.ts'` composes intuitively.
- **Annotation wording**: `(N paths excluded by include filter)` — "excluded" refers to files dropped by the include predicate, consistent with `applyExclusions` semantics.

## Gate pattern

`gate.expected-fail` at iter=0 for all 3 WIs. WI-3 exit code was -3 (required-paths-missing, not the usual 1) because the acceptance file existed but the new assertion blocks were absent. All 3 gate.pass at iter=1.

## Compare-path prevention

Prior cycle (`2026-08-31-author-filter-flag-delivery`): `--author` silently ignored on `--compare` path, caught as RF-1 major by adversarial review. This cycle: AC-2.2 explicitly required `applyInclusions` on both `headCommits` and `baseCommits`. Acceptance AC-5 (`--compare <base> --include 'src/**'`) verified it. No review send-back. Lesson-to-spec propagation worked.

## Sources

- `_logs/2026-09-04T15-35-29_INIT-2026-09-04-include-path-filter-flag/events.jsonl` — `ralph.end` WI-1/WI-2/WI-3; `dev-loop.delivered` totals; `reviewer.pr-opened` (PR #15)
- `/home/parso/forge-m5-a/brain/cycles/_raw/2026-09-04T15-35-29_INIT-2026-09-04-include-path-filter-flag.md`

## See also

- [[2026-07-11-exclude-path-filter-single-seam]] — structural twin: filter at seam, text/JSON annotation, byte-identical invariant
- [[2026-08-31-author-filter-flag-delivery]] — 3-WI TDD chain structural twin; all-subcommand wiring discipline
- [[2026-08-31-author-filter-compare-coverage-gap]] — the RF-1 compare-gap this cycle explicitly pre-empted
- [[git-truth-and-pure-aggregation]] — the seam this filter extends
- [[2026-08-31-tag-range-filter-delivery]] — structural twin: 3-WI TDD chain, filter at seam
