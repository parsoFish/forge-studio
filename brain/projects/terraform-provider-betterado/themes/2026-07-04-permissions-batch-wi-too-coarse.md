---
title: Bundling 13 permissions resources into one WI drives high iteration count and deferred gap coverage
description: WI-4 migrated all 13 betterado_*_permissions types in one work item; 4 dev-loop iterations in run 1, re-ran entirely in run 2; gap-matrix coverage for individual types was implicit, not verified per-type.
category: antipattern
keywords: [permissions, batch-wi, coarse-decomposition, gap-matrix-coverage, iteration-count, wi-4]
related_themes: [pm-decomposition-index]
created_at: 2026-07-04T00:00:00.000Z
updated_at: 2026-07-04T00:00:00.000Z
---

## Pattern observed

PM decomposed WI-4 as: "migrate betterado_area_permissions, betterado_build_definition_permissions, … (13 types total) — test representative: `betterado_project_permissions`."

- Dev-loop run 1: 4 iterations, 139 bash calls, $5.21 — highest cost of any WI in the initiative.
- WI-4 re-ran entirely in dev-loop run 2 (full re-execution, not already-complete).
- 13 resources in a single WI means a single gate failure forces re-derivation of ALL 13 types' migration patterns.

## Why this matters

The 13 `*_permissions` resources in `internal/service/permissions/` share a common scaffold pattern (token, namespace_id, subject_descriptor, permission bits). One-WI bundling makes sense for cost amortisation but amplifies iteration cost when anything fails. The "one representative test" mitigation works at the gate level but leaves the other 12 types' test coverage implicit (not verified live per type).

## Fix direction

For large uniform-resource batches in future migrations:
- Group by ~4-5 resources per WI, using a shared test helper that verifies each group's representative type.
- Or: keep one WI but require `CaptureLiveEvidence` calls for every type (not just the representative), so unifier gate has per-type evidence to check.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions/events.jsonl` (WI-4 ralph.end: iterations=4, bashCalls=139, cost=$5.21)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions.md`
