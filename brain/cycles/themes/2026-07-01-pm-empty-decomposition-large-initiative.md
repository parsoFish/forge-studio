---
title: PM emits empty decomposition twice on large 7-WI initiative before succeeding on 3rd attempt
description: On a 7-WI linear-chain initiative, the PM ran brain queries (5 and 7 reads) but emitted no work items both times; the 3rd attempt succeeded after spawning a Task subagent to explore the codebase first.
category: antipattern
created_at: 2026-07-01T10:11:22.291Z
updated_at: 2026-07-01T10:11:22.291Z
---

## What happened

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity` (terraform-provider-betterado)

PM phase ran 3 times before producing work items:

| Run | brain queries | outcome |
|-----|--------------|---------|
| 1 | 5 (`pm.brain-query` x5) | `pm.empty-decomposition` — no WIs emitted |
| 2 | 7 (`pm.brain-query` x7) | `pm.empty-decomposition` — no WIs emitted |
| 3 | 5 + Task subagent + Write calls | 7 WIs emitted (success) |

The 3rd run used a `tool.Task` call (spawned an explore subagent) and then wrote WI files directly before emitting the graph. This suggests the PM needed to first discover file paths and structure for the 13 resource/data-source targets before it could produce accurate WI specs.

## Cost

Two wasted PM runs estimated at ~$4 total (at $2/run typical cost). Added ~30min of wall-clock delay (timestamps: 21:54→21:56, 07:22→07:26, 10:05→10:11).

## Pattern

The initiative scope was large: 2 resources + 11 data sources across 2 packages (graph + identity), linear dependency chain WI-2→3→4→5→6→7 with one parallel WI-1. Each WI required specific file paths in the `files_in_scope` field. The PM apparently needed to probe the filesystem before it could fill those fields; when it didn't probe on runs 1-2, it had no work items to emit.

## Fix direction

For initiatives covering many files across multiple packages: the PM should run filesystem discovery (Glob/Grep) BEFORE the brain-query phase, not after. Alternatively, the PM SKILL contract could be updated to require a codebase scan when `files_in_scope` cannot be inferred from the initiative spec alone.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity/events.jsonl` — L26 (`pm.empty-decomposition`), L67 (`pm.empty-decomposition`), L113-L120 (WI emissions on 3rd run after Task subagent)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity.md`
