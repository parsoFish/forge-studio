---
title: Framework resource registration WI must update existing provider tests, not invent new ones
description: When registering a framework resource in framework_provider.go and removing the SDKv2 registration from provider.go, the WI must update TestProvider_HasChildResources (not a guessed name) so the expected resource count still matches.
category: pattern
created_at: 2026-06-20T00:00:00.000Z
updated_at: 2026-06-20T00:00:00.000Z
---

## Pattern

The real provider-level tests in `azuredevops/provider_test.go` are:
- `TestProvider_HasChildResources` — asserts the SDKv2 `ResourcesMap` contains an expected set of resource names
- `TestProvider_HasChildDataSources` — same for data sources
- `TestProvider_SchemaIsValid` — validates provider schema

When `betterado_task_group` moves from `provider.go`'s `ResourcesMap` to `framework_provider.go`'s `Resources()`:
1. `TestProvider_HasChildResources` must be updated to **remove** `betterado_task_group` from the expected set (it is no longer in the SDKv2 map).
2. The quality gate for the registration WI should be: `go test -tags all -count=1 -run TestProvider_HasChildResources ./azuredevops/` — a test that FAILS before the WI removes the SDKv2 entry (resource count wrong) and PASSES after (resource count matches updated expected set).

## Wrong approach (antipattern — cycle-specific failure)

Using `-run TestProvider_HasCorrectResources` (invented name) → `[no tests to run]` → no-work guard fires → WI budget exhausted.

## Gate design rule

For any WI that changes provider registration:
- Gate MUST reference a test that ALREADY EXISTS or that the WI CREATES.
- Grep `azuredevops/provider_test.go` for test function names before writing the gate.
- The gate must fail on a clean tree (before the WI's changes) and pass after.

## Sources

- `_logs/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group/events.jsonl` (WI-2 gate.fail × 5 at lines 267, 426, 557, 751, 884; WI-2 pass 2 ralph.end at EV_mqlmzy0c)
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group.md`
- `/home/parso/forge/_queue/done/INIT-2026-06-19-framework-task-group.md` (operator recovery guidance)
- `projects/terraform-provider-betterado/azuredevops/provider_test.go`
