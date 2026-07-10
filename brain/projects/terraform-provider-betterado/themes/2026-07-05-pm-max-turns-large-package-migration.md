---
title: PM hits max-turns on 17-item scope decomposition, emits incomplete WI set
description: >-
  PM first run on the workitemtrackingprocess initiative (17 in-scope types)
  exhausted its turn budget after emitting only 2 WIs. Operator decomposition-
  completeness annotation in the manifest forced a second PM run that correctly
  emitted all 9 WIs covering all 17 types.
category: antipattern
created_at: 2026-07-05T00:00:00.000Z
updated_at: 2026-07-05T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess`.

**First PM run (2026-07-01T22:18):** read brain 9 times, hit `error_max_turns`, emitted only 2 WIs. 14 of the 17 in-scope resources/data-sources had no covering WI. Cycle ended without a dev-loop.

**Second PM run (2026-07-03T04:50):** operator had added a "Decomposition completeness contract" block to the manifest:
> "The decomposition MUST map EVERY resource and data source listed in 'Resources in scope' to exactly one WI … Before emitting, enumerate the full scope list and verify each entry has an owning WI — do not stop at a representative subset."

Result: 9 WIs emitted, covering all 17 types. Cost $2.94.

## Cause

17 in-scope types, each requiring careful schema/test/provider-registration analysis, exhausted the PM turn budget before all types were assigned. Without the completeness-enumeration constraint, the PM stopped at a representative subset.

## Fix already applied

The operator annotation in the manifest is the effective fix. For future large-package migration initiatives: always include a completeness-verification directive naming every in-scope type.

The pattern is also consistent with `2026-07-03-pm-max-turns-large-initiative-decomp` (forge-level antipattern). For betterado specifically: any initiative naming >10 in-scope resource/data-source types should include an explicit enumeration check in the manifest.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess/events.jsonl` (PM end 2026-07-01T22:21 `result_subtype: error_max_turns`, PM end 2026-07-03T04:57 `result_subtype: success`)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess.md`
- Manifest: `/home/parso/forge/_queue/done/INIT-2026-07-01-migrate-framework-workitemtrackingprocess.md` (decomposition completeness contract block)
