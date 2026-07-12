---
title: Servicehook framework resources — null vs empty-string state inconsistency
description: Both servicehook framework resources needed extra iterations to fix attributes (stage_name, pipeline_id, git_push branch/pushed_by/repository_id) that the ADO API returns as empty string but were stored as null in Terraform state, causing "inconsistent result after apply".
category: antipattern
keywords: [servicehook, null-vs-empty-string, "inconsistent result after apply", stage_name, pipeline_id, git_push]
related_themes: [resource-datasource-patterns-index]
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook` (terraform-provider-betterado, servicehook framework migration).

**WI-4** (`betterado_servicehook_storage_queue_pipelines`): gate.fail iter 1 — missing required arg `account_name`; gate.fail iter 2 — `inconsistent result after apply: stage_name`, `pipeline_id` null→empty string. Gate passed on iter 3.

**WI-5** (`betterado_servicehook_webhook_tfs`): gate.fail iter 1 — `inconsistent result after apply: git_push[0].branch`, `pushed_by`, `repository_id` null→empty string. Gate passed on iter 2.

## Root cause

In terraform-plugin-framework, optional string attributes that the ADO ServiceHooks API returns as `""` (empty string) must be explicitly mapped to `types.StringValue("")` or to `types.StringNull()` consistently. If the plan stores null but apply returns `""`, Terraform detects an inconsistency. The SDKv2 resources used `schema.TypeString` with `Optional: true` and the SDK silently normalised this; the framework resource must be explicit.

## Fix pattern

For each optional string attribute in servicehook resources, check the API response: if the API can return `""`, use `types.StringValue(apiVal)` unconditionally in `Read`/`Create` (not `types.StringNull()` when empty). Add a flatten helper that normalises `""` to null only when the API field is truly absent vs. intentionally empty.

## Implication for future resources

Any framework resource wrapping an ADO API that uses empty strings to signal "not set" will hit this class of error. Check the OpenAPI schema for `minLength: 0` string fields and handle them explicitly.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook/events.jsonl` (gate.fail events for WI-4 iter 1-2, WI-5 iter 1)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook.md`
