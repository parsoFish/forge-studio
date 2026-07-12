---
title: Acceptance test hermetic-fixture discipline
description: Live acceptance tests in this provider use UUID-prefixed names, explicit TestCheckResourceAttr (not AttrSet), idempotency step, CheckDestroy via API 404, PreCheck failing loud.
category: pattern
keywords: [fixture-discipline, uuid-prefix, checkdestroy, idempotency, tf_acc, precheck, testcheckresourceattr]
related_themes: [fixture-discipline-index]
created_at: 2026-06-16T00:00:00.000Z
updated_at: 2026-06-16T00:00:00.000Z
---

## Pattern

All live acceptance tests (`TF_ACC=1`) in `azuredevops/internal/acceptancetests/` follow:

1. **UUID-prefixed name** via `testutils.GenerateResourceName()` — guarantees no name collision across parallel runs.
2. **PreCheck** via `testutils.PreCheck(t, nil)` — loads `secrets.env`, fails loudly if `TF_ACC` / `AZDO_ORG_SERVICE_URL` / `AZDO_PERSONAL_ACCESS_TOKEN` are missing. No silent skips.
3. **Non-default field values** — description, category, at least one input parameter, at least one task step (for task groups). Catches flatten bugs that defaults would hide.
4. **Exact assertions** via `resource.TestCheckResourceAttr` on written fields — never `TestCheckResourceAttrSet` for fields the test controls.
5. **Idempotency step**: `PlanOnly: true, ExpectNonEmptyPlan: false` — confirms no perpetual diff.
6. **CheckDestroy** via `GetTaskGroups` (or equivalent) confirming 404 from the API after destroy.

For data-source tests: use `TestCheckResourceAttrPair` to assert data-source attributes match the creating resource's attributes.

Build tag: `//go:build (all || <resource>) && !exclude_<resource>`.

Proven in `resource_task_group_test.go` (`TestAccTaskGroup_basic`, 23.64s live pass) and `data_task_group_test.go` (`TestAccTaskGroupDataSource_basic`, 23.49s live pass).

## Sources

- `_logs/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source/events.jsonl` (WI-3 gate pass `2026-06-16T10:26:28.838Z`; WI-4 gate pass `2026-06-16T10:29:33.051Z`)
- `/home/parso/forge/brain/cycles/_raw/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source.md`
- `projects/terraform-provider-betterado/azuredevops/internal/acceptancetests/resource_task_group_test.go`
- `projects/terraform-provider-betterado/azuredevops/internal/acceptancetests/data_task_group_test.go`
