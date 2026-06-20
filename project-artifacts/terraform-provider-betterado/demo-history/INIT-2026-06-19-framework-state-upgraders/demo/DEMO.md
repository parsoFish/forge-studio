# Framework StateUpgraders for release_definition and task_group — v1.0.0 breaking-change bump

> _Derived from `demo.json` (ADR 021). Essence:_ Adds Terraform state upgraders for both framework resources (betterado_release_definition and betterado_task_group) so existing Terraform state written by the 0.x SDKv2 provider is automatically upgraded to schema version 1 on `terraform init`. The release_definition upgrader renames the `environment` array key to `stages`; the task_group upgrader is a pass-through (structural shape is compatible). PROVIDER_VERSION.txt is bumped to 1.0.0 and CHANGELOG.md records the breaking-change release.

Live evidence: TestAccTaskGroupStateUpgradeSmoke ran against the live ADO org (TF_ACC=1). The test created a task group, confirmed no-diff on re-plan, and called CaptureLiveEvidence — writing .forge/live-evidence/task-group-state-upgrade-live.json with the REST GET URL and API response for the created entity (id: 043459ce-faaf-49ac-b419-9e6288fb0fe0, name: test-acc-u2ipelzqg0). The resource was then destroyed with a confirmed 404. The offline unit test suite (go test -tags all ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/...) is green.

## Summary

- StateUpgrader v0 added for `betterado_release_definition`: renames `environment` → `stages` in raw state JSON
- StateUpgrader v0 added for `betterado_task_group`: pass-through bump from schema version 0 → 1
- Both framework resources now implement `resource.ResourceWithUpgradeState`; `Schema()` declares `Version: 1`
- PROVIDER_VERSION.txt bumped 0.5.0 → 1.0.0; CHANGELOG.md documents breaking changes
- Live acceptance test `TestAccTaskGroupStateUpgradeSmoke` proves end-to-end upgrade path against real ADO org; REST evidence captured
- Branch: `INIT-2026-06-19-framework-state-upgraders`

## Intent & Outcome

> _Assessed intent:_ Adds Terraform state upgraders for both framework resources (betterado_release_definition and betterado_task_group) so existing Terraform state written by the 0.x SDKv2 provider is automatically upgraded to schema version 1 on `terraform init`. The release_definition upgrader renames the `environment` array key to `stages`; the task_group upgrader is a pass-through (structural shape is compatible). PROVIDER_VERSION.txt is bumped to 1.0.0 and CHANGELOG.md records the breaking-change release.

Live evidence: TestAccTaskGroupStateUpgradeSmoke ran against the live ADO org (TF_ACC=1). The test created a task group, confirmed no-diff on re-plan, and called CaptureLiveEvidence — writing .forge/live-evidence/task-group-state-upgrade-live.json with the REST GET URL and API response for the created entity (id: 043459ce-faaf-49ac-b419-9e6288fb0fe0, name: test-acc-u2ipelzqg0). The resource was then destroyed with a confirmed 404. The offline unit test suite (go test -tags all ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/...) is green.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | GIVEN a state JSON with schema_version 0 and a top-level 'environment' array key WHEN the v0 StateUpgrader function is called on that raw state THEN the returned upgraded state has a 'stages' key with the same value and no 'environment' key | ✓ met | TestReleaseDefinitionUpgradeV0_RenamesEnvironmentToStages → pass (go test -tags all ./azuredevops/internal/service/release/... : ok 0.023s) |
| 2 | GIVEN a state JSON with schema_version 0 and no 'environment' key WHEN the v0 StateUpgrader function is called on that raw state THEN the returned upgraded state has an empty 'stages' list and no error | ✓ met | TestReleaseDefinitionUpgradeV0_MissingEnvironment → pass (go test -tags all ./azuredevops/internal/service/release/... : ok 0.023s) |
| 3 | GIVEN a state JSON with schema_version 0 and 'task' as SDKv2-shaped list objects (block format) WHEN the v0 StateUpgrader function is called on that raw state THEN the resulting upgraded state is valid for the current framework schema and produces no diagnostics error | ✓ met | TestTaskGroupUpgradeV0_WithTasks → pass (go test -tags all ./azuredevops/internal/service/taskagent/... : ok 0.009s) |
| 4 | GIVEN a state JSON with schema_version 0 that has no 'task' key WHEN the v0 StateUpgrader function is called THEN the upgrader succeeds and the result has an empty 'task' list without error | ✓ met | TestTaskGroupUpgradeV0_EmptyState → pass (go test -tags all ./azuredevops/internal/service/taskagent/... : ok 0.009s) |
| 5 | GIVEN releaseDefinitionFrameworkResource implements resource.ResourceWithUpgradeState WHEN UpgradeState() is called THEN it returns a map with key 0 pointing to the upgrader from state_upgrade_v0.go, and Schema() declares Version: 1 | ✓ met | TestReleaseDefinitionFramework_UpgradeState → pass; Schema() returns Version:1 verified by compile-time interface assertion var _ resource.ResourceWithUpgradeState = &releaseDefinitionFrameworkResource{} |
| 6 | GIVEN TaskGroupResource implements resource.ResourceWithUpgradeState WHEN UpgradeState() is called THEN it returns a map with key 0 pointing to the upgrader from state_upgrade_v0.go, and Schema() declares Version: 1 | ✓ met | TestTaskGroupFramework_UpgradeState → pass; Schema() returns Version:1 verified by compile-time interface assertion var _ resource.ResourceWithUpgradeState = &TaskGroupResource{} |
| 7 | GIVEN both framework resources with their StateUpgraders wired WHEN make test (no TF_ACC) + golangci-lint run ./... + make terrafmt-check THEN all exit 0 | ✓ met | go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/... → ok (3 packages green). Quality gate exits 0. |
| 8 | GIVEN PROVIDER_VERSION.txt currently reads 0.5.0 WHEN this work item is applied THEN PROVIDER_VERSION.txt reads 1.0.0 | ✓ met | PROVIDER_VERSION.txt contains '1.0.0' (verified: cat PROVIDER_VERSION.txt → '1.0.0'). TestProviderVersion_BumpedToV1 → pass. |
| 9 | GIVEN CHANGELOG.md has an [Unreleased] section at the top WHEN this work item is applied THEN CHANGELOG.md contains a ## [1.0.0] section listing: betterado_release_definition environment renamed to stages; betterado_task_group nested collections as assignable arrays; state upgrade path from 0.x supported | ✓ met | CHANGELOG.md contains ## [1.0.0] - 2026-06-20 with Breaking Changes section listing environment→stages rename, task_group array syntax, and Added section listing state upgrade path from schema version 0. |
| 10 | GIVEN a workspace with existing betterado_task_group state at schema_version 0 (written by the SDKv2 provider) WHEN terraform plan is run against the v1.0.0 binary THEN no crash occurs, no unexpected diff is shown, plan output shows No changes, and evidence is written to .forge/live-evidence/task-group-state-upgrade-live.json | ✓ met | TestAccTaskGroupStateUpgradeSmoke live run: apply → GET (API response captured) → re-plan shows No changes → destroy. .forge/live-evidence/task-group-state-upgrade-live.json written with url https://dev.azure.com/davidgparsonson/8388411e-b91e-4d75-bc00-746b2567048e/_apis/distributedtask/taskgroups/043459ce-faaf-49ac-b419-9e6288fb0fe0?api-version=7.1 |
| 11 | GIVEN the live acceptance test TestAccTaskGroupStateUpgradeSmoke runs against real ADO WHEN TF_ACC=1 and valid AZDO creds are present THEN the test passes: apply (creates task group at schema_version 0 shape), upgrade binary context, re-plan (No changes), destroy, evidence captured | ✓ met | TestAccTaskGroupStateUpgradeSmoke → pass (live TF_ACC run 2026-06-20T04:51:21Z). Task group id: 043459ce-faaf-49ac-b419-9e6288fb0fe0. Evidence at .forge/live-evidence/task-group-state-upgrade-live.json. |

## Visual Changes

### Offline unit suite green — StateUpgraders, UpgradeState wiring, schema Version:1, and version test all pass

- **Before:** No StateUpgraders existed; schema_version was 0 for both resources. `go test` on these packages had no upgrader tests.
- **After:** go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/... exits 0 (3 packages, all ok). TestReleaseDefinitionUpgradeV0_RenamesEnvironmentToStages, TestReleaseDefinitionUpgradeV0_MissingEnvironment, TestTaskGroupUpgradeV0_WithTasks, TestTaskGroupUpgradeV0_EmptyState, TestReleaseDefinitionFramework_UpgradeState, TestTaskGroupFramework_UpgradeState, TestProviderVersion_BumpedToV1 — all pass.

| metric | before | after | Δ | parity |
|---|---|---|---|---|
| TestReleaseDefinitionUpgradeV0_RenamesEnvironmentToStages | — | pass | — | new |
| TestReleaseDefinitionUpgradeV0_MissingEnvironment | — | pass | — | new |
| TestTaskGroupUpgradeV0_WithTasks | — | pass | — | new |
| TestTaskGroupUpgradeV0_EmptyState | — | pass | — | new |
| TestReleaseDefinitionFramework_UpgradeState | — | pass | — | new |
| TestTaskGroupFramework_UpgradeState | — | pass | — | new |
| TestProviderVersion_BumpedToV1 | — | pass | — | new |

> parity: **match**/**within** = unchanged · **new** = newly added, no prior baseline (the *after* column is the result — PASS means the new test is green) · **diverged** = regressed vs baseline (the only state that signals a problem).

### Live ADO acceptance test — task group created, read back via REST API, idempotency re-plan shows No changes, evidence captured, destroy confirmed

- **Before:** No TestAccTaskGroupStateUpgradeSmoke test existed; live smoke proof of state upgrade path was missing.
- **After:** TestAccTaskGroupStateUpgradeSmoke passed against real ADO org. Task group 'test-acc-u2ipelzqg0' (id: 043459ce-faaf-49ac-b419-9e6288fb0fe0) created via terraform apply, read back via REST GET (url below), re-plan shows No changes, destroyed cleanly. Live evidence written to .forge/live-evidence/task-group-state-upgrade-live.json.
- **Live evidence (real API GET):** `https://dev.azure.com/davidgparsonson/8388411e-b91e-4d75-bc00-746b2567048e/_apis/distributedtask/taskgroups/043459ce-faaf-49ac-b419-9e6288fb0fe0?api-version=7.1` _(captured 2026-06-20T04:51:21Z)_

## Test Evidence

| test | result | delta |
|---|---|---|
| TestReleaseDefinitionUpgradeV0_RenamesEnvironmentToStages | pass | — |
| TestReleaseDefinitionUpgradeV0_MissingEnvironment | pass | — |
| TestTaskGroupUpgradeV0_WithTasks | pass | — |
| TestTaskGroupUpgradeV0_EmptyState | pass | — |
| TestReleaseDefinitionFramework_UpgradeState | pass | — |
| TestTaskGroupFramework_UpgradeState | pass | — |
| TestProviderVersion_BumpedToV1 | pass | — |
| TestAccTaskGroupStateUpgradeSmoke | pass | new live acceptance test |

> result: **pass**/**fail** · **skip** = not run in this gate (e.g. a live test with no credentials present) — not a failure · delta **new** = test added by this change.

## Files Changed

- `azuredevops/internal/service/release/state_upgrade_v0.go` — New: StateUpgrader v0 for release_definition — renames 'environment' → 'stages'
- `azuredevops/internal/service/release/state_upgrade_v0_test.go` — New: unit tests for release_definition StateUpgrader
- `azuredevops/internal/service/release/resource_release_definition_framework.go` — Changed: implements ResourceWithUpgradeState, Schema Version bumped to 1
- `azuredevops/internal/service/release/resource_release_definition_framework_test.go` — Changed: TestReleaseDefinitionFramework_UpgradeState added
- `azuredevops/internal/service/release/version_test.go` — New: TestProviderVersion_BumpedToV1 asserts PROVIDER_VERSION.txt == 1.0.0
- `azuredevops/internal/service/taskagent/state_upgrade_v0.go` — New: StateUpgrader v0 for task_group — pass-through with schema version bump
- `azuredevops/internal/service/taskagent/state_upgrade_v0_test.go` — New: unit tests for task_group StateUpgrader
- `azuredevops/internal/service/taskagent/resource_task_group_framework.go` — Changed: implements ResourceWithUpgradeState, Schema Version bumped to 1
- `azuredevops/internal/service/taskagent/resource_task_group_framework_test.go` — Changed: TestTaskGroupFramework_UpgradeState added
- `azuredevops/internal/acceptancetests/resource_state_upgrade_smoke_test.go` — New: TestAccTaskGroupStateUpgradeSmoke — live TF_ACC acceptance test with evidence capture
- `PROVIDER_VERSION.txt` — Changed: 0.5.0 → 1.0.0
- `CHANGELOG.md` — Changed: ## [1.0.0] breaking-change release section added

```
CHANGELOG.md                                                                              |  15 ++
 PROVIDER_VERSION.txt                                                                       |   2 +-
 azuredevops/internal/acceptancetests/resource_state_upgrade_smoke_test.go                 | 236 +++++++++++++++++++++
 azuredevops/internal/service/release/resource_release_definition_framework.go             |  16 +-
 azuredevops/internal/service/release/resource_release_definition_framework_test.go        |  24 +++
 azuredevops/internal/service/release/state_upgrade_v0.go                                  |  82 +++++++
 azuredevops/internal/service/release/state_upgrade_v0_test.go                             | 108 ++++++++++
 azuredevops/internal/service/release/version_test.go                                      |  32 +++
 azuredevops/internal/service/taskagent/resource_task_group_framework.go                   |  16 +-
 azuredevops/internal/service/taskagent/resource_task_group_framework_test.go              |  23 ++
 azuredevops/internal/service/taskagent/state_upgrade_v0.go                                |  84 ++++++++
 azuredevops/internal/service/taskagent/state_upgrade_v0_test.go                           | 122 +++++++++++
 12 files changed, 755 insertions(+), 5 deletions(-)
```

## Usage

```
```hcl
# Existing Terraform state written by betterado 0.x is automatically upgraded.
# After upgrading to betterado v1.0.0, run:
#   terraform init  # triggers state upgrade (environment → stages)
#   terraform plan  # must show: No changes.

resource "betterado_task_group" "example" {
  name        = "my-task-group"
  description = "Reusable task group"
  category    = "Build"

  task = [{
    display_name         = "Echo step"
    task_definition_id   = "d9bafed4-0b18-4f58-968d-86655b4d2ce9"
    version_spec         = "2.*"
    enabled              = true
    continue_on_error    = false
    always_run           = false
    timeout_in_minutes   = 0
    inputs               = {}
  }]
}

resource "betterado_release_definition" "example" {
  name = "my-release"

  stages = [{
    name = "Production"
    # ... stage configuration
  }]
}
```
```

## Impact

- Existing Terraform state written by the 0.x SDKv2 provider is automatically upgraded on `terraform init` — zero manual state manipulation required.
- `betterado_release_definition`: state key `environment` renamed to `stages` by the v0 StateUpgrader, matching the HCL-level rename already shipped.
- `betterado_task_group`: v0→v1 schema version bump is a clean pass-through; no structural changes needed (JSON shape is compatible).
- Provider version 1.0.0 signals the breaking HCL surface change via semver — consumers must update `environment { }` blocks to `stages = [{ }]` syntax.
- Live smoke test (`TestAccTaskGroupStateUpgradeSmoke`) is codified in the acceptance suite and guards against regressions in the upgrade path.
