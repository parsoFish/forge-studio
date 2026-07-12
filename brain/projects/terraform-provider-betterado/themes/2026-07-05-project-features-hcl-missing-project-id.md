---
title: betterado_project_features HCL fixture must include project_id
description: The framework resource betterado_project_features requires project_id as a required attribute; if the acceptance test HCL fixture omits it, terraform fails at plan time with "Missing Configuration for Required Attribute".
category: antipattern
keywords: [project_features, hcl-fixture, project_id, required-attribute, missing-configuration, acceptance-test]
related_themes: [fixture-discipline-index]
created_at: 2026-07-05
updated_at: 2026-07-05
---

# betterado_project_features HCL fixture must include project_id

## What happened

WI-3 (`betterado_project_features` framework migration) exhausted its 5-iteration budget without passing. The gate failure on every iteration was:

```
--- FAIL: TestAccProjectFeatures_roundtrip (0.70s)
    resource_project_features_test.go:27: Step 1/2 error: Error running pre-apply plan: exit status 1

    Error: Missing Configuration for Required Attribute

      with betterado_project_features.test,
      on terraform_plugin_test.tf line 21, in resource "betterado_project_features" "test":
      21:   project_i[d]
```

The agent wrote the framework resource with `project_id` as a `Required` attribute (correct), but the HCL generator in the test omitted `project_id` from the resource block. The framework provider's plan-time validation rejected the config before any API call.

## Impact

WI-3 failure cascaded to WI-4, WI-5, WI-6, WI-7, WI-8, WI-9 all skipping (`prerequisite-failed`), placing first-time implementation work on the unifier across multiple subsequent cycle restarts.

## Rule

When writing a framework resource acceptance test, verify the HCL fixture includes ALL `Required` attributes of the resource schema. For `betterado_project_features`, the minimal block is:

```hcl
resource "betterado_project_features" "test" {
  project_id = data.betterado_project.demo.id
  features = {
    boards      = "enabled"
    ...
  }
}
```

Check `resource.go` `Schema()` for all `Required: true` attributes before writing the test HCL.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core/events.jsonl` — `gate.fail` events for WI-3 at 2026-07-02T08:59:35 through 2026-07-02T09:17:13
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core.md`
