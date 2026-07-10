---
title: PM emits empty decomposition twice for 13-type graph+identity scope before succeeding
description: PM hit error_max_turns twice before producing 7 WIs for the graph+identity migration (2 resources + 11 data sources); the large scope caused turn-budget exhaustion before decomposition was committed.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity` (terraform-provider-betterado, graph+identity migration).

PM phases:

| Attempt | Result | Time |
|---|---|---|
| 1 | `pm.empty-decomposition` (`error_max_turns`) | 2026-07-01T21:56 |
| 2 | `pm.empty-decomposition` (`error_max_turns`) | 2026-07-02T07:26 |
| 3 | success — 7 WIs, brainReads=5 | 2026-07-02T10:11 |

The initiative scope (13 types across two packages: graph + identity) is the largest single-initiative migration scope attempted. The PM explored the worktree (Glob/Task/Read calls) while simultaneously reasoning about the decomposition, exhausting its turn budget before committing WIs on first two attempts.

Estimated wasted cost: ~$4 in PM tokens.

## Mitigation that worked on attempt 3

The PM on attempt 3 read profile.md and the spec-driven-work-items brain page early, then committed to a decomposition structure before exhaustive exploration. The result (7 WIs) was correct and complete.

## Fix direction

For initiatives with >8 types in scope, the operator should pre-decompose in the manifest (provide a rough WI list as a hint) to bound PM exploration cost. The PM can still refine; the hint prevents budget exhaustion on initial mapping.

## Related themes

- `2026-07-03-pm-scope-drop-under-max-turns.md` — PM drops headline resource under max-turns pressure (different failure mode, same root cause)
- `2026-07-03-pm-max-turns-on-wiki-migration-initiative.md` — wiki migration PM max-turns

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity/events.jsonl` (`pm.empty-decomposition` events at 2026-07-01T21:56 and 2026-07-02T07:26)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity.md`
