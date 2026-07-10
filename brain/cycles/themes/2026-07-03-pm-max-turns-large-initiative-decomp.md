---
title: PM max_turns on large live-acceptance initiatives produces zero-WI output at full cost
description: PM hit max_turns on a 6-WI live-acceptance initiative (workitemtracking migration), emitting 0 work items and spending $1.11 — wasting a full cycle run.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking` (terraform-provider-betterado, workitemtracking framework migration).

PM run 1 (2026-07-01): `error_max_turns` — PM reached the turn budget before emitting any work items. Cost: $1.11. Work items emitted: 0. The orchestrator classified the cycle as terminal and required a full re-queue.

The initiative had: 4 resources + 2 data sources to migrate, 3 ACs including live-acceptance tests, and an explicit decomposition note added by the operator after run 2.

## Why it happens

Large live-acceptance initiatives with many files in scope push the PM through extensive brain queries, profile reads, and spec elaboration before it can begin writing WIs. The max_turns cap fires mid-decomposition, producing no output.

## Prior occurrences

Observed on large migration initiatives. The workitemtracking initiative is the second occurrence after the release-folder-permissions initiative in the same project.

## Mitigation options

- Increase PM turn budget for initiatives with >4 resources or live-acceptance ACs.
- PM should checkpoint partial WI output (emit WIs as it goes, not all at end) so partial progress survives a turn-budget hit.
- Architect can pre-size initiatives to ≤4 WIs to stay under the turn budget.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking/events.jsonl` (EV_mr2n1a1p_7b1xg6zm, `pm.empty-decomposition`, `result_subtype: error_max_turns`)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking.md`
