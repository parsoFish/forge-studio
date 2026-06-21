---
title: Framework StateUpgrader V0→V1 pattern for betterado resources
description: Pattern for wiring StateVersion=1 and a V0→V1 upgrader into plugin-framework resources in this provider; includes file layout, upgrade function signature, and unit test shape.
category: pattern
created_at: 2026-06-20
updated_at: 2026-06-20
---

# Framework StateUpgrader V0→V1 pattern

## Canonical implementation

Two resources now use this pattern: `betterado_release_definition` and `betterado_task_group`.

**Files added per resource:**
- `azuredevops/internal/service/<pkg>/state_upgrade_v0.go` — upgrade function + `StateUpgradersV0ToV1()`
- `azuredevops/internal/service/<pkg>/state_upgrade_v0_test.go` — unit test for the upgrader

**Resource change:**
```go
func (r *ResourceFoo) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
    resp.Schema = schema.Schema{
        Version: 1,
        ...
    }
}

func (r *ResourceFoo) StateUpgraders(ctx context.Context) []resource.StateUpgrader {
    return StateUpgradersV0ToV1()
}
```

**Upgrade function shape:**
```go
func StateUpgradersV0ToV1() []resource.StateUpgrader {
    return []resource.StateUpgrader{
        {
            PriorSchema: &schema.Schema{Version: 0, Attributes: v0Attrs},
            StateUpgrader: func(ctx context.Context, req resource.UpgradeStateRequest, resp *resource.UpgradeStateResponse) {
                // read from req.State (v0), write to resp.State (v1)
            },
        },
    }
}
```

**Unit test gate command:**
```
go test -tags all -run TestUnit<Resource>StateUpgrade ./azuredevops/internal/service/<pkg>/...
```

**Live smoke gate command (WI-5 pattern):**
```
go test -tags all -run TestAcc<Resource>StateUpgradeSmoke ./azuredevops/internal/acceptancetests/
```
Uses `testutils.GetMuxedProviderFactories()` + `data "betterado_project"` (never creates projects).

## Sources

- `_logs/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders/events.jsonl` (EV_mqlvrcxw_6u56c25i ralph.end WI-5, EV_mqlw3fx8_srhxxtlu dev-loop.delivered)
- `brain/cycles/_raw/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders.md`
