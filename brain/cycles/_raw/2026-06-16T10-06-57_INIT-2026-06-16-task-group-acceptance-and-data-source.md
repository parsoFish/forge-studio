---
source_type: cycle
source_url: _logs/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source/events.jsonl
source_title: Cycle 2026-06-16T10-06-57 — Initiative INIT-2026-06-16-task-group-acceptance-and-data-source
cycle_id: 2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source
initiative_id: INIT-2026-06-16-task-group-acceptance-and-data-source
project: terraform-provider-betterado
ingested_at: 2026-06-16T11:00:00.000Z
ingested_by: reflector
retention: interesting
cited_by:
  - brain/cycles/themes/2026-06-16-unifier-demo-render-undiscoverable.md
  - projects/terraform-provider-betterado/brain/themes/2026-06-16-acceptance-test-fixture-discipline.md
  - projects/terraform-provider-betterado/brain/themes/2026-06-16-agent-crash-work-survives.md
  - projects/terraform-provider-betterado/brain/themes/2026-06-16-data-source-reader-pattern.md
---

## Summary

Added `betterado_task_group` data source + live acceptance tests for both the resource and the data source. Closed the proof-bar gap between task groups and release resources.

**Delivery:** 9 files, 1244 insertions, 0 deletions, 7 commits. PR #22. All 4 WIs complete, 0 failed.

**New files:**
- `azuredevops/internal/service/taskagent/data_task_group.go` — `DataTaskGroup()` data source
- `azuredevops/internal/service/taskagent/data_task_group_test.go` — creds-free unit tests (happy path + 404)
- `azuredevops/provider.go` (edit) — registered `"betterado_task_group"` in DataSourcesMap
- `azuredevops/provider_test.go` (edit) — updated `expectedDataSources`
- `azuredevops/internal/acceptancetests/resource_task_group_test.go` — `TestAccTaskGroup_basic` (live, TF_ACC)
- `azuredevops/internal/acceptancetests/data_task_group_test.go` — `TestAccTaskGroupDataSource_basic` (live, TF_ACC)

**Notable events:**
- 3/4 WIs hit `gate.expected-fail` with `no-work-indicator` on iteration 0 — correct; gate-tightening forced test writes before pass
- WI-3 had 1 agent crash (exit code 1); work survived; marked `already-complete` on recovery
- Unifier spent ~40 Bash calls exploring `forge demo render` CLI before finding correct invocation
- CI gate fixer committed before final gate pass (`cycle.ci-fix-committed` → `cycle.ci-gate ok:true`)
- Pattern reuse: `DataTaskGroup()` follows `data_release_folder.go`; acceptance tests reuse `testutils` fixtures

**Cycle duration:** 10:06:57 → ~10:38 (~31 minutes). Cost data not captured in usage_delta (zero in log).

## Event log

Full event log: `_logs/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source/events.jsonl` (522 lines)
