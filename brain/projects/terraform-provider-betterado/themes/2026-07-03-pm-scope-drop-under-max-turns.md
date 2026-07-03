---
title: PM scope-drop under max-turns pressure — headline resource missing from decomposition
description: PM exhausted its turn budget before verifying all in-scope resources had a covering WI; betterado_extension (the headline resource) was absent from the first two valid decompositions. Operator manifest annotation was the unblock.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-dashboard-extension`.

PM ran 4 times before producing a correct decomposition:

| Cycle | Result | betterado_dashboard | betterado_extension |
|---|---|---|---|
| 1 (2026-07-01T21:51) | `error_max_turns`, 0 WIs | absent | absent |
| 2 (2026-07-02T07:16) | `error_max_turns`, 2 WIs | WI-1 gap matrix ✓ | absent ✗ |
| 3 (2026-07-02T08:04) | success, 3 WIs | WI-1 gap matrix ✓ | WI-2 gap matrix only (no impl WI) ✗ |
| 4+ | correct after operator annotation | ✓ | ✓ |

The manifest stated plainly: `Resources in scope: betterado_dashboard, betterado_extension`. The PM read the profile, read the brain, and still dropped `betterado_extension`. The `error_max_turns` runs stopped mid-way through writing WIs; the successful run cycle 3 treated a gap-matrix WI as sufficient coverage for a resource that also needed an implementation WI.

## Root cause

PM does not enumerate the full scope list and assert coverage before emitting. Under max-turns pressure, PM stops at a representative subset. Even on a successful run, a gap-matrix WI was accepted as "covering" a resource that also required a framework implementation WI.

## Unblock

Operator appended a `decomposition completeness contract` prose block to the manifest (operator re-grounding annotation pattern, see `brain/cycles/themes/2026-06-12-manifest-regrounding-annotation-as-operator-override.md`):

> A previous decomposition dropped betterado_extension. The decomposition MUST map EVERY resource to exactly one WI. Before emitting, enumerate the full scope list and verify each entry has an owning WI.

This forced PM to enumerate and verify on the next run.

## Fix direction

PM skill should enforce a coverage-closure step as the final pre-emit action: iterate every resource named in scope, assert a WI names it in its own scope + ACs, fail if any are uncovered. This is the same "finalize completeness-critic" gap identified in `brain/forge-dev/themes/2026-07-01-architect-coverage-scope-fidelity.md` — applies to PM decomposition as much as architect planning.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-dashboard-extension/events.jsonl` (L32 `pm.empty-decomposition`, L82-84 cycle-2 PM WIs, L120-124 cycle-3 PM WIs, all lack a `betterado_extension` implementation WI)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-dashboard-extension.md`
- Prior pattern: `brain/cycles/themes/2026-06-12-manifest-regrounding-annotation-as-operator-override.md`
