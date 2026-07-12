---
title: betterado_release_definition acceptance test fixture must use stages block, not environment
description: Any acceptance test that wraps a betterado_release_definition resource must use a `stages {}` block, not `environment {}`. Using `environment {}` triggers a Terraform schema validation error at plan time, failing the hollow gate before any ADO call.
category: antipattern
keywords: [stages-block, environment-block, schema-validation, hollow-gate, release-definition, hcl-fixture]
related_themes: [gate-mechanics-index]
created_at: 2026-07-10T10:45:06.472Z
updated_at: 2026-07-10T10:45:06.472Z
---

## Problem

WI-3 in the permissions-coverage initiative wrote an acceptance test using:

```hcl
resource "betterado_release_definition" "release" {
  ...
  environment {
    name = "Stage 1"
    ...
  }
}
```

This fails Terraform schema validation at plan time:

```
Error: Insufficient stages blocks
  on terraform_plugin_test.tf line 20, in resource "betterado_release_definition" "release"
  At least 1 "stages" blocks are required.

Error: Blocks of type "environment" are not expected here.
```

## Root cause

`environment` is the legacy upstream ADO provider attribute name. The betterado `betterado_release_definition` schema uses `stages {}` (not `environment {}`). The hollow gate (no `TF_ACC`) still runs `terraform plan` internally via `resource.ParallelTest`, so schema validation fires even without live ADO credentials.

## Impact

WI-3: 5 iterations, all failed with the identical error. Budget exhausted. WI-4 skipped (prerequisite-failed). Unifier absorbed the partial output.

## Correct pattern

```hcl
resource "betterado_release_definition" "release" {
  name        = "..."
  project_id  = data.betterado_project.test.id
  stages {
    name = "Stage 1"
    rank = 1
    ...
  }
}
```

See `azuredevops/internal/service/release/resource_release_definition.go` for the canonical schema block names.

## Sources

- `_logs/2026-06-18T10-27-18_INIT-2026-06-17-release-definition-permissions-coverage/events.jsonl` — lines 332, 355, 414, 437, 456 (five identical gate.fail with "Insufficient stages blocks")
- `brain/cycles/_raw/2026-06-18T10-27-18_INIT-2026-06-17-release-definition-permissions-coverage.md`
