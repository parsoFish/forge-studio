---
title: Operator decomposition-completeness annotation in manifest forced full scope coverage
description: A "Decomposition completeness contract" prose annotation added to the initiative manifest by the operator (2026-07-02) successfully prevented PM from dropping in-scope types; all 30+ serviceendpoint types were covered in 10 WIs — contrasting with the prior run that dropped 15 types.
category: pattern
keywords: [decomposition-completeness, manifest-annotation, scope-coverage, operator-override, pm-decomposition, serviceendpoint]
related_themes: [pm-decomposition-index]
created_at: 2026-07-03T22:00:00.000Z
updated_at: 2026-07-03T22:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint`.

The operator added this block to the initiative manifest before requeue:

```
## Decomposition completeness contract (operator, 2026-07-02)

A previous decomposition of this initiative dropped in-scope work (15 in-scope
service endpoint types had no covering WI). The decomposition MUST map EVERY
resource and data source listed in "Resources in scope" to exactly one WI that
names it in its own scope and acceptance criteria. Before emitting, enumerate
the full scope list and verify each entry has an owning WI — do not stop at a
representative subset. Bundling several related resources into one WI is fine;
dropping any is not.
```

The PM produced 10 WIs that collectively covered all 30+ in-scope resource and data-source types. Zero types were dropped. The prior decomposition (un-annotated) had covered only ~15 of the 30+ types.

## Why it worked

The annotation gives the PM an explicit enumeration mandate and a failure mode to avoid ("do not stop at a representative subset"). Combined with the existing scope list in the manifest, the PM had both the list and the instruction to verify completeness before emitting. The prior run had no such instruction and defaulted to a representative sample.

## Generalisation

This is an instance of the `2026-06-12-manifest-regrounding-annotation-as-operator-override` pattern: a prose block at the top of the manifest overrides PM defaults. The specific form that works for decomposition completeness:

1. State what went wrong in the prior run (dropped N items).
2. Give an explicit verification step ("enumerate the full scope list and verify each entry has an owning WI before emitting").
3. State what bundling is acceptable vs not ("bundling several is fine; dropping any is not").

## When to use

Any initiative where the scope list is enumerated in the manifest and a prior PM pass covered only a subset. Add the annotation before requeue; PM will enforce it.

## Sources

- `/home/parso/forge/_queue/done/INIT-2026-07-01-migrate-framework-serviceendpoint.md` — "Decomposition completeness contract" section
- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint/events.jsonl` — pm.work-item-emitted ×15 events (10 WIs + 5 graph events), covering all 30+ types
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint.md`
