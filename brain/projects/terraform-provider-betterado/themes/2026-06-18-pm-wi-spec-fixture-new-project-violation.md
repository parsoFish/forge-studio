---
title: PM WI spec can include new-project HCL fixture violating org cap
description: PM decomposition for WI-2 (task-group-coverage) generated sample HCL using resource "betterado_project" — a new ADO project create — violating the org project-cap constraint. Ralph self-corrected silently by reading existing tests.
category: antipattern
created_at: 2026-06-18
updated_at: 2026-06-18
---

## Problem

WI-2 spec (task-group-coverage) included sample HCL:

```hcl
resource "betterado_project" "test" {
  name = "%[1]s"
  ...
}
resource "betterado_task_group" "test" {
  project_id = betterado_project.test.id
  ...
}
```

The org is at its project cap (`C9`). Any acceptance test that creates a new `betterado_project` will fail with an ADO project-limit error at live runtime. The PM read the profile.md gotcha during decomposition but still emitted the wrong fixture pattern in the WI spec.

## Outcome

Ralph agent read the existing `TestAccTaskGroup_basic` fixture and silently used the correct pattern:

```hcl
data "betterado_project" "test" {
  name = local.project_name  // SharedFixtureProjectName
}
```

Gate passed. No iteration waste. But the correction was invisible — if a future agent follows the spec literally it will hit a live-only cap failure.

## Why the PM makes this error

PM knows the constraint but generating WI specs is a synthesis task — it draws on the resource pattern (create + destroy) rather than the betterado-specific shared-fixture override. The override needs to be in the WI spec instruction, not just in the profile.md.

## Fix direction

Profile.md gotcha entry should be amplified to: **ALL acceptance test fixtures MUST use `data "betterado_project"` + SharedFixtureProjectName — NEVER `resource "betterado_project"` — org is at cap.** Add as a standing note in PM SKILL.md for betterado acceptance-test WIs.

## Sources

- `_logs/2026-06-18T09-23-23_INIT-2026-06-17-task-group-coverage/events.jsonl` (WI-2 report spec lines 162-199 show wrong fixture; delivered code L255 file_change uses correct fixture)
- `brain/cycles/_raw/2026-06-18T09-23-23_INIT-2026-06-17-task-group-coverage.md`
