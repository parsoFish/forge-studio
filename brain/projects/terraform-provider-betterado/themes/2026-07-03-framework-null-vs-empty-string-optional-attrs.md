---
title: terraform-plugin-framework null vs empty-string for optional string attributes
description: Absent optional string attributes are StringNull() in framework, not StringValue(""); SDKv2 normalised both to "" causing drift on plan diff when switching.
category: antipattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

# terraform-plugin-framework null vs empty-string for optional string attributes

## Problem

`betterado_feed` has `project_id` as optional — omitting it means org-scoped. SDKv2 stored `""` for absent string (via `d.Set("project_id", "")`). Framework stores `types.StringNull()`. On the first apply after migration, plan shows `project_id: null → ""` (or vice versa), triggering a perpetual destroy+recreate cycle.

Observed in WI-2 iteration 1 (live gate): idempotency check failed because plan diff showed `project_id` changing on every refresh.

## Rule

When migrating an optional `project_id`-style attribute:
1. If the ADO API returns `""` or `nil`/omitted, map to `types.StringNull()` (not `types.StringValue("")`).
2. Accept both `null` and `""` in `Read` → always write `null` back to state for "not set".
3. In `Create`/`Update`, treat `types.StringNull()` and `types.StringValue("")` identically (send empty/omit to API).
4. Test: include an idempotency check step (`PlanOnly: true`) after `Create` to catch refresh-induced drift before merging.

Pattern used in `resource_feed_framework.go` and `resource_feed_retention_policy_framework.go` after WI-2/WI-4.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed/events.jsonl` — WI-2 iteration 1 gate failure, reasoning block "null-vs-empty-string"
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed.md`
