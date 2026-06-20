---
title: Framework ListNestedAttribute requires array HCL syntax in acceptance tests
description: When betterado_task_group migrates from SDKv2 TypeList blocks to framework ListNestedAttribute, all acceptance test HCL must change from block syntax (task { … }) to array-attribute syntax (task = [{ … }]).
category: pattern
created_at: 2026-06-20T00:00:00.000Z
updated_at: 2026-06-20T00:00:00.000Z
---

## Pattern

SDKv2 `TypeList` + `Elem: &schema.Resource{}` exposes blocks:
```hcl
task {
  task_id      = "uuid"
  display_name = "My step"
}
```

Framework `schema.ListNestedAttribute` exposes attribute-style lists:
```hcl
task = [
  {
    task_id      = "uuid"
    display_name = "My step"
  }
]
```

**Required changes when migrating acceptance tests:**
- `hclTaskGroupBasic`: all three nested list blocks (`task`, `input`, `version`) → array-attribute syntax
- `hclTaskGroupWithGapFields`: same
- Provider factory: `Providers: testutils.GetProviders()` → `ProtoV6ProviderFactories: testutils.GetMuxedProviderFactories()`
- Destroy checks / evidence captures that used `GetProvider().Meta()` → `getDirectClient()` that builds `*client.AggregatedClient` from env vars directly (since `Meta()` is nil under `ProtoV6ProviderFactories`)

## Idempotency requirement

The framework resource must handle partial attribute specification without a perpetual diff. If a user specifies only `task_id` and `display_name`, omitting `enabled`, `timeout_in_minutes`, etc., the Read must set defaults matching what the API returns. Use per-attribute `Computed + Optional + Default` to achieve this.

## Sources

- `_logs/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group/events.jsonl` (WI-3 iteration 1 summary at event EV_mqlnaox4; WI-3 ralph.end at EV_mqlnvhs0)
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group.md`
- `projects/terraform-provider-betterado/azuredevops/internal/acceptancetests/resource_task_group_test.go`
