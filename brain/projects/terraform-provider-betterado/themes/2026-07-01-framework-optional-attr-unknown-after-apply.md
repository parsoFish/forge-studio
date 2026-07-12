---
title: Framework optional attrs return unknown value after apply
description: Framework resources migrated from SDKv2 return "Provider returned invalid result object after apply — unknown value" for optional attrs that were Computed+Optional in SDKv2; fix is UseStateForUnknown plan modifier or equivalent.
category: antipattern
keywords: [usestateforunknown, unknown-value, plan-modifier, optional-computed, framework-migration, apply-error]
related_themes: [framework-migration-index]
created_at: 2026-07-01T00:00:00.000Z
updated_at: 2026-07-01T00:00:00.000Z
---

## Pattern observed

During WI-4 (approvalsandchecks migration, `betterado_check_rest_api`), the framework resource returned unknown values post-apply for `body`, `headers`, `success_criteria`, `url_suffix`, `variable_group_name`. Terraform rejected these with:

```
Error: Provider returned invalid result object after apply
After the apply operation, the provider still indicated an unknown value for
betterado_check_rest_api.test.body. All values must be known after apply.
```

This is separate from the nil-Meta panic (WI-4 iter 3). Required 2 additional gate-fail iterations (iters 3–4) to diagnose and fix.

## Root cause

SDKv2 `Computed: true, Optional: true` attrs automatically retain their prior state value when the API response omits them. Framework equivalents must explicitly declare `PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}` (or equivalent for each type) to achieve the same semantics.

## Checklist addition (per-resource migration, clause 5b)

Every SDKv2 attr with `Computed: true, Optional: true` that can be absent from the API response MUST have `UseStateForUnknown` in the framework equivalent, or the attr must be forced `Computed: false` if it is truly write-only.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-policy-branch/events.jsonl` (L2649 `gate.fail` for `TestAccCheckRestAPI_update`, output: "unknown value for betterado_check_rest_api.test.body/headers/...")
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-policy-branch.md`
