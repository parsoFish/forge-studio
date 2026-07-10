---
title: "ConfigFile + in-process provider: required_providers block not auto-injected"
description: "terraform-plugin-testing does NOT prepend the required_providers terraform block when ConfigFile is used instead of Config; TF_REATTACH_PROVIDERS is used for binary injection but the source block must still be in the HCL file, or use Config string instead."
category: pattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

# ConfigFile + in-process provider pattern

## Problem

When using `ConfigFile: "/path/to/file.tf"` in a `resource.TestStep`, `terraform-plugin-testing` does NOT prepend the `terraform { required_providers { ... } }` block that it auto-prepends when using `Config: "..."` (via `mergedConfig`/`providerConfigTestCase`).

The in-process provider is injected via `TF_REATTACH_PROVIDERS`, which maps by provider source address. Without the `required_providers` block, Terraform doesn't know to look up the `betterado` provider by that source.

## Dev-loop discovery cost

The WI-4 agent spent ~40 min (3 gate.fail events, 6 logged reasoning messages) re-deriving this from `testStepNewConfig` source in `terraform-plugin-testing`:
- `mergedConfig` appends `s.Config` at line 61 — only for the `Config` string case
- `ConfigFile` path skips `mergedConfig`
- `addTerraformBlockSource` checks `s.Config` (empty when `ConfigFile` is set)

## Correct approach

Two options:
1. **Use `Config: "..."` string** for all acceptance test steps — the framework auto-prepends `required_providers`. Use `os.ReadFile` + string interpolation if HCL is complex.
2. **Embed `required_providers` in the HCL file** itself when `ConfigFile` is required (e.g. dynamic multi-step config). The `TF_REATTACH_PROVIDERS` env var then matches the provider by source.

For `TestAccDataPipelineRun` (which needs a dynamic `ConfigFile` because `run_id` is only known after step 1's Check func runs), option 2 was used: the dynamically-written HCL file includes `terraform { required_providers { betterado = { source = "..." } } }`.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelines-v2/events.jsonl` — WI-4/WI-5 gate.fail events 06:26-07:06, ralph log messages exploring `testStepNewConfig`
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelines-v2.md`
- `azuredevops/internal/acceptancetests/data_pipeline_run_test.go` — reference implementation
