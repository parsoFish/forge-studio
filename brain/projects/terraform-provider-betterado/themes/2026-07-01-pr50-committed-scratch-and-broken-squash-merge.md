---
title: PR #50 committed framework validators + 56MB test binary + broken squash-merge
description: Feed migration PR #50 (1) committed framework_validators.go, a 56MB test binary, and phantom demo citations (4th gitignored-scratch instance), and (2) the squash-merge shipped a broken main — CHANGELOG had raw conflict markers, two orphaned SDKv2 test files referenced deleted sources, feed package non-compiling for a day.
category: antipattern
keywords: [squash-merge, conflict-markers, orphaned-sdkv2-files, test-binary, phantom-citations, changelog, pre-pr-strip]
related_themes: [provider-registration-dedup-index, live-evidence-demo-index]
created_at: 2026-07-01T00:00:00.000Z
updated_at: 2026-07-01T00:00:00.000Z
---

# PR #50 — committed scratch + broken squash-merge

## What happened

`betterado` feed migration PR #50 had two quality failures caught only at review / post-merge:

### 1. Committed artifacts not belonging in the PR

- **`framework_validators.go`** — an intermediate file committed to the branch (validator helpers belonging to a shared location, not the feed package).
- **A 56 MB test binary** — a compiled acceptance test binary accidentally staged and committed.
- **Phantom test names in `demo.json` citations** — fourth instance of the gitignored-scratch antipattern: demo.json referenced test names that don't exist in the acceptance suite. Reviewer flagged as part of its "review-gate scoreboard" note.

### 2. Squash-merge shipped broken main

The operator squash-merged PR #50. Result:

- `CHANGELOG.md` contained raw Git conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`).
- Two orphaned SDKv2 `_test.go` files (`resource_feed_test.go`, `resource_feed_permission_test.go`) remained on main after their source files were deleted — these files referenced now-deleted symbols, causing the feed package to fail to compile under `-tags all`.
- The compilation failure was **undetected for approximately one day**.
- Fixed inside the next initiative's fan-in (PR #51, graph-identity migration).

## Why this recurs

- `brainReads:0` across all ralph sessions: the unifier's pre-PR strip removes `.forge/` scratch but does NOT detect intermediate build artifacts or validate `demo.json` test citation accuracy.
- SDKv2 `_test.go` orphan detection: `go vet -tags all ./azuredevops/...` would catch symbol-resolution failures, but the CI gate runs `make test` (no `-tags all`) and `golangci-lint`, which misses tag-gated orphans unless they're imported.
- Conflict markers in `CHANGELOG.md`: the unifier or reviewer did not run `git diff main...HEAD -- CHANGELOG.md | grep '<<<'` before opening/approving the PR.

## Verification steps that catch these

1. **Before PR open:** `grep -r '<<<<<<<' . --include='*.md'` — catches unresolved merge conflicts.
2. **Before PR open:** `go vet -tags all ./azuredevops/...` — catches orphaned tag-gated test files.
3. **In demo.json review:** verify each `test` field in citations is an actual Go test symbol in the acceptance suite.
4. **File size check:** `git diff --stat main...HEAD | awk '$1 > 1000'` — flags unexpectedly large binary adds.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed/events.jsonl` — user-feedback Q2 answer describing scope drift and broken squash-merge
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed.md`
- the betterado 2026-07 run-friction report (git history) (review-gate scoreboard + merge integrity sections)
