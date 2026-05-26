---
title: Post-merge health-check protocol
description: >-
  After every gh pr merge, run language-agnostic test discovery + execute tests
  in a worktree-isolated environment. The merge step is not the success
  condition; the test suite on updated main is.
category: operation
keywords:
  - health-check
  - post-merge
  - test-discovery
  - merge-train
  - worktree-isolation
  - source-test-pairing
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes:
  - layered-merge-order
  - quality-gates-orchestrator-verified
  - squash-merge-stacked-prs
---

# Post-merge health-check protocol

Added in forge v1 v0.6.0 after Cycle 2's trafficGame main breakage: 32/32 work items "completed" but main had 90 test failures, 12 TS errors, 21 ESLint errors. The fix: **the merge step itself is not the success condition. The test suite on updated main is.**

Protocol:

1. After `gh pr merge`, run language-agnostic test discovery (detect the test framework from the repo).
2. Execute tests in a **worktree-isolated environment** (clean checkout, no pollution from dev state).
3. If tests fail → emit `merge.health-check-failed` event, halt the merge train.
4. Do not proceed to the next stacked layer until health check passes.
5. Human review required to unblock a failed health check.

Also includes **source-test pairing validation** (added to developer quality gates and PR pre-flight): every test file has a corresponding source file; every new source file has corresponding tests. This catches the "source files lost during squash" failure mode early.

In v2 this is the reviewer skill's responsibility (review-prep stage) — the gate between "developer-loop says complete" and "human asked to look."

## Sources

- [`v1-themes-design-and-merge.cycle.md`](../../_raw/v1-wiki/v1-themes-design-and-merge.cycle.md) — full protocol + Cycle 2 motivation.

## See also

- [[layered-merge-order]] — health checks gate layer transitions.
- [[quality-gates-orchestrator-verified]] — same verification principle, applied to merges.
- [[squash-merge-stacked-prs]] — what health checks detect.
