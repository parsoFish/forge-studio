---
title: PM turn budget exhausted on large multi-resource migration packages
description: PM hit error_max_turns twice on the 11-WI taskagent migration; hidden-coupling validation over 8+ shared-file resource types consumed the full budget before WIs were written.
category: antipattern
created_at: 2026-07-05T00:00:00.000Z
updated_at: 2026-07-05T00:00:00.000Z
---

## Pattern observed

Initiative: `INIT-2026-07-01-migrate-framework-taskagent` (taskagent package, 8 resource types + 5 data sources, 11 WIs).

PM run 1: 0 WIs emitted, $1.10, `error_max_turns`.
PM run 2: 11 WIs written but 5 hidden-coupling violations flagged (WI-6/7/8/9/10 all touching `framework_provider.go`, `provider.go`, `provider_test.go`) — budget exhausted during violation-resolution pass, $1.82, `error_max_turns`.
PM run 3: 11 WIs, success, $1.73.
Total PM cost: ~$4.65, ~20 min before dev-loop could start.

## Root cause

Every resource-migration WI must update `framework_provider.go`, `provider.go`, and `provider_test.go`. With 8+ resource types in a single initiative, the coupling-validator fires on all of them. Resolving the violations (splitting files, adding `depends_on` edges) requires additional read+rewrite passes that exhaust the PM's turn budget on top of the WI-writing cost.

## Fix options

1. Architect pre-splits shared-file WIs — one WI per resource, with explicit `depends_on` on a "shared-file cleanup" WI — so PM sees no coupling at all.
2. PM turn budget increase for migration initiatives with >8 resource types (detect heuristically from initiative body).
3. Two-phase PM: write WIs first, validate coupling second (separate tool calls with no budget overlap).

## Recurrence

Same class as `2026-07-05-pm-max-turns-large-package-migration.md` (workitemtrackingprocess, 13 resources). Pattern: package size > ~8 types → PM budget exhaustion.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-taskagent/events.jsonl` (lines 29-33 PM run 1, lines 154 PM run 2, line 222 PM run 3)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-taskagent.md`
