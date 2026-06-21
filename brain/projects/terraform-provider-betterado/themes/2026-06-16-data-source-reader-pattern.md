---
title: Data source reader pattern mirrors resource schema
description: New data sources follow data_release_folder.go — Read (not ReadContext), 5-min timeout, mirrored schema, 404 surfaces as error.
category: pattern
created_at: 2026-06-16T00:00:00.000Z
updated_at: 2026-06-16T00:00:00.000Z
---

## Pattern

When adding a new data source for an existing resource in this provider, follow `data_release_folder.go`:

- Return type: `*schema.Resource` with `Read` (not `ReadContext`), `Timeouts: &schema.ResourceTimeout{Read: schema.DefaultTimeout(5 * time.Minute)}`.
- Schema: accept `project_id` + `id` as required inputs; all other attributes computed, mirroring the resource schema exactly.
- Read function: call `GetTaskGroups` (or equivalent list-by-id API); if result is empty or API returns 404 (`utils.ResponseWasNotFound`), return a formatted error — data sources must find their target or fail clearly.
- Call the resource's existing `flattenX()` function on success to avoid duplicating flatten logic.

This pattern was proven in `data_task_group.go` (WI-1, 1 iteration to green, `TestDataTaskGroup_Read_Populates` + `TestDataTaskGroup_Read_NotFound`).

## Unit test convention

Unit tests for data sources reuse package-level fixtures from the sibling resource test file (same package). Build tag: `//go:build (all || data_<resource>) && !exclude_data_<resource>`.

## Sources

- `_logs/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source/events.jsonl` (WI-1 iteration event, `started_at: 2026-06-16T10:14:36.109Z`)
- `/home/parso/forge/brain/cycles/_raw/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source.md`
- `projects/terraform-provider-betterado/azuredevops/internal/service/taskagent/data_task_group.go`
