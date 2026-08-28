---
title: --no-merges flag delivered via parentCount at the git-truth seam; 3-WI TDD chain, all 1-iter
description: >-
  Global --no-merges flag added to all gitpulse subcommands. LOG_ARGS drops the
  hard-coded --no-merges; Commit gains parentCount from %P; filterMergeCommits()
  applied once in cli.ts after readCommits(), before any aggregation. Text
  annotation + JSON field + byte-identical invariant. 3-WI TDD chain, each 1
  iteration; WI-1 touched 20 test files for the new required Commit field.
category: pattern
keywords:
  - no-merges
  - parent-count
  - git-truth-seam
  - filter-at-seam
  - tdd
  - parentCount
  - breaking-change
  - single-seam
related_themes: [2026-07-11-exclude-path-filter-single-seam, 2026-07-12-sort-flag-delivery, git-truth-and-pure-aggregation]
created_at: 2026-08-28T12:30:00.000Z
updated_at: 2026-08-28T12:30:00.000Z
---

# `--no-merges` flag: delivery pattern

## What was built

- `src/git.ts`: `LOG_FORMAT` extended with `%x09%P` (4th tab-separated field; space-separated parent SHAs). `LOG_ARGS` drops `--no-merges`. `parseLog()` reads `parts[3]`, counts non-empty tokens → `parentCount`. Initial commit yields `parentCount === 0`.
- `src/cli.ts`: exported `filterMergeCommits(commits)` → `{ filtered, excludedCount }`. Applied immediately after `readCommits()` and path-filter exclusions, before `summarize()`/aggregators. `--no-merges` parsed through all sub-CLIs (`runTagsCli`, `runCouplingCli`, main). Text header appends `(N merge commits excluded)` when N > 0; JSON gains `mergesExcluded`.
- `test/no-merges.test.ts`: 8 unit tests (parentCount 0/1/2, LOG_ARGS absence, numstat regression, mixed sequence).
- `test/no-merges-cli.test.ts`: 12 unit tests (filter purity, text annotation, filter-before-summarize ordering, `--help`, JSON field, byte-identical, flag composition).
- `test/acceptance/run.ts`: fixture extended with real merge commit via `git commit-tree -p <mainTip> -p <prevParent>`. `EXPECTED_TOTAL_WITH_MERGE=7`, `EXPECTED_TOP_COUNT_WITH_MERGE=6`. 4 new assertion blocks: plain run=7, `--no-merges`=6 with annotation, `--no-merges --json` has `mergesExcluded`, byte-identical on merge-free fixture.
- All 20 existing test files updated with `parentCount: 1` in Commit fixture factories.

## WI decomposition

- WI-1 (`src/git.ts` + `test/no-merges.test.ts` + 20 test fixture updates): 1 iter. Gate: `node --test --experimental-strip-types test/no-merges.test.ts`. 18 files, +209/-16. Cost $2.31. Tool runs: 28 reads, 31 writes, 26 bash, 12 test runs.
- WI-2 (`src/cli.ts` wiring + `test/no-merges-cli.test.ts`): 1 iter. Gate: `node --test --experimental-strip-types test/no-merges-cli.test.ts`. 3 files, +242/0. Cost $1.03.
- WI-3 (acceptance fixture + `README.md`): 1 iter. Gate: `npm run acceptance`. 2 files, +195/-28. Cost $2.26. WI-3 gate passed at iter=0 (old acceptance green, new assertions not yet written); gate-diff requirement forced iter=1 where the real work happened.

## Design decisions

- `parentCount` is a non-optional field on `Commit` — failing loudly if missing rather than defaulting. Consequence: 20 test fixture factories required updates, all done in WI-1.
- Filter applied at the seam (immediately after `readCommits()`) — all subcommands (churn, ownership, hotspots, coupling, compare, tags) inherit it without per-module logic. Consistent with `--exclude` and `--sort` discipline.
- Byte-identical invariant: `--no-merges` on a merge-free repo produces output identical to no flag.
- This is an intentional breaking change: repos with merge commits show different analytics without the flag.

## Sources

- `_logs/2026-08-28T11-33-00_INIT-2026-08-28-init-no-merges-flag/events.jsonl`
- `/home/parso/forge-m0-a/brain/cycles/_raw/2026-08-28T11-33-00_INIT-2026-08-28-init-no-merges-flag.md`

## See also

- [[2026-07-11-exclude-path-filter-single-seam]] — structural twin (apply filter once at seam, all pipelines inherit; text annotation + JSON field conventions)
- [[2026-07-12-sort-flag-delivery]] — apply transformation once before any renderer
- [[git-truth-and-pure-aggregation]] — the seam this filter sits at
