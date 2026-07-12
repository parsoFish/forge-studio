---
title: Serviceendpoint framework resources need UseStateForUnknown on computed-optional string attrs
description: Migrated serviceendpoint framework resources hit "inconsistent result after apply" for server_url, service_principal_id, workload_identity_federation_issuer, workload_identity_federation_subject — fixed by adding UseStateForUnknown plan modifier.
category: pattern
keywords: [usestateforunknown, plan-modifiers, computed-optional, serviceendpoint, inconsistent-result-after-apply, workload-identity-federation]
related_themes: [resource-datasource-patterns-index]
created_at: 2026-07-09T22:30:00.000Z
updated_at: 2026-07-09T22:30:00.000Z
---

## Pattern

Framework resources migrated from SDKv2 in the `serviceendpoint` package must declare `UseStateForUnknown()` in the `PlanModifiers` list for **computed+optional string attributes that the API may not echo back on every read**.

Affected attributes (confirmed in WI-3, `resource_serviceendpoint_azurerm_framework.go` and related):
- `workload_identity_federation_issuer`
- `workload_identity_federation_subject`
- `service_principal_id`
- `server_url`

Without the modifier, Terraform reports:

```
Error: Provider produced inconsistent result after apply
```

because the API returns an empty/null for these on subsequent GETs after creation, while the plan retains the value from `apply`.

## Implementation

```go
schema.StringAttribute{
    Optional: true,
    Computed: true,
    PlanModifiers: []planmodifier.String{
        stringplanmodifier.UseStateForUnknown(),
    },
},
```

Import: `"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"`

## Re-derivation cost

WI-3 hit 4 iterations ($8.13, 107 bash calls, 39 reads, brainReads=0) before arriving at this fix. This is a re-derivation of the pattern documented in `brain/projects/terraform-provider-betterado/themes/2026-07-03-inline-plan-modifier-pattern-re-derived.md`. It was not embedded in the WI spec.

## PM action required

For any framework-migration WI touching serviceendpoint resources with the above attributes, the WI spec must include:

```
AC-planmod: Attributes [workload_identity_federation_issuer, workload_identity_federation_subject,
service_principal_id, server_url] must declare UseStateForUnknown() PlanModifier.
Verify: apply → re-plan shows "No changes." (ExpectNonEmptyPlan: false).
```

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint/events.jsonl` — line 1037: `ralph.end` WI-3, `status: complete`, `iterations: 4`, `brainReads: 0`, cost $8.13
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint.md`
