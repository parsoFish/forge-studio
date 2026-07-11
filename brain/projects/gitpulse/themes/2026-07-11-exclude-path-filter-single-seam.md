---
title: --exclude flag filters at the git-truth seam, all pipelines inherit
description: >-
  Applying CommitFile exclusion immediately after readCommits() in cli.ts means
  churn, hotspot, ownership, compare, and JSON output all see pre-filtered file
  lists with no per-module duplication — zero-dep in-repo glob matcher covers
  the real use cases.
category: pattern
keywords:
  - exclude
  - glob
  - git-truth-seam
  - zero-deps
  - filter
created_at: 2026-07-11T00:00:00.000Z
updated_at: 2026-07-11T00:00:00.000Z
---

# `--exclude` flag filters at the git-truth seam

## Pattern

`src/glob.ts` implements a ~30-line `matchGlob(pattern, path)` supporting `*` (single segment) and `**` (any depth). No runtime deps. The CLI filters `CommitFile[]` inside each `Commit` immediately after `readCommits()` returns — before `summarize()`, `computeChurn()`, `computeOwnership()`, `computeHotspots()`, or `computeDelta()` are called.

Result: every downstream pipeline inherits the exclusion transparently. No per-module filter logic. The text output prints `(N paths excluded)` in the header when N > 0. JSON output carries `"excluded": N` at the top level.

## Why it worked

- Single filter point = single place to test and reason about correctness.
- `src/glob.ts` unit-tested independently (WI-1, `test/glob.test.ts`, 7 cases) before any CLI wiring.
- Acceptance fixture extended with `dist/bundle.js` + `vendor.lock` sentinel commits; exclusion assertions verified exact counts and absence of paths (WI-3, `test/acceptance/run.ts`).
- AC-3 (no flag = identical output) held without modification to existing assertions — only additions.

## Delivery

WI-1→WI-2→WI-3 linear chain, each completed in 1 iteration. 992 insertions, 5 deletions, 10 files. PR #7 merged, CI green, version 0.6.1.

## Sources

- `_logs/2026-07-11T07-29-19_INIT-2026-07-11-exclude-path-filter/events.jsonl` — `gate.pass` for WI-1/WI-2/WI-3; `dev-loop.delivered` final totals
- `/home/parso/forge/brain/cycles/_raw/2026-07-11T07-29-19_INIT-2026-07-11-exclude-path-filter.md`
