---
title: Squash-merging stacked PRs is forbidden
description: >-
  v1 Cycle 2 trafficGame produced 90 test failures + 12 TS errors after 8
  stacked PRs were squash-merged independently. Use layered merge order with
  health checks instead.
category: antipattern
keywords:
  - squash-merge
  - stacked-prs
  - layered-merge
  - git-history
  - antipattern
  - v1-cycle-2
  - trafficgame
  - 90-failures
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes:
  - gh-cli-and-worktrees
  - layered-merge-order
  - health-check-protocol
---

# Squash-merging stacked PRs is forbidden

When PRs are stacked (PR-A is base, PR-B targets PR-A's branch, PR-C targets PR-B's branch), squash-merging the parent rewrites history; child PRs end up containing the parent's pre-squash diff again.

**v1 Cycle 2 evidence — trafficGame (PRs #19–#26):** 32/32 work items "completed" (100%), but main had **90 test failures, 12 TS errors, 21 ESLint errors** after 8 stacked PRs were squash-merged independently. Four failure modes:

1. **Source files lost (~40%)** — `SimulationWarning.ts`, `ContinuousSpawnMode.ts` vanished when parent branches were squashed.
2. **Duplicate functions (~25%)** — overlapping PRs each added methods to `Game.ts`.
3. **Test expectation drift (~15%)** — tests against branch state didn't match post-squash code.
4. **Incomplete type work (~20%)** — type-safety improvements lost.

Fix: use **layered merge order** with post-merge health checks. Squash is safe *within* a layer (one PR squashed individually); layer ordering must be preserved.

The reviewer skill's PR-description template asks: *"is this a stacked PR? If so, link parents and use merge-commit or rebase, not squash."*

## Sources

- [`docs/phases/review-loop.md`](../../../docs/phases/review-loop.md) — failure-mode call-out.
- [`v1-themes-design-and-merge.cycle.md`](../../_raw/v1-wiki/v1-themes-design-and-merge.cycle.md) — full Cycle 2 post-mortem with the 4-failure-modes breakdown.

## See also

- [[gh-cli-and-worktrees]] — the tooling involved.
- [[layered-merge-order]] — the correct pattern this violation breaks.
- [[health-check-protocol]] — gate that catches the breakage.
