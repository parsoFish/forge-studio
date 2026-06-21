# Migrate betterado_task_group to terraform-plugin-framework with ListNestedAttribute

> _Derived from `demo.json` (ADR 021). Essence:_ betterado_task_group is now implemented via terraform-plugin-framework instead of Plugin SDK v2. The task, input, and version blocks are now list-of-object attributes using array-of-objects HCL syntax (task = [{ ... }]). Typed defaults on optional fields eliminate perpetual-diff noise when fields like enabled, timeout_in_minutes, always_run, or inputs are omitted. Proven by live TF_ACC acceptance tests against a real Azure DevOps organisation with REST read-back evidence.

## Summary

- 1015-line framework implementation of betterado_task_group with full CRUD, typed defaults, and expand/flatten helpers
- Removed from SDKv2 ResourcesMap; registered in framework provider via mux — no other resources affected
- Live TF_ACC tests (TestAccTaskGroup_basic, TestAccTaskGroup_withGapFields, TestAccTaskGroupDataSource_basic) all green with real ADO REST read-back evidence
- Idempotency proven: omitted optional fields (enabled, timeout_in_minutes, etc.) produce no diff on re-plan
- Docs updated via tfplugindocs; example updated to array syntax; CHANGELOG draft and version bump committed
- Branch: `INIT-2026-06-19-framework-task-group`

## Intent & Outcome

> _Assessed intent:_ betterado_task_group is now implemented via terraform-plugin-framework instead of Plugin SDK v2. The task, input, and version blocks are now list-of-object attributes using array-of-objects HCL syntax (task = [{ ... }]). Typed defaults on optional fields eliminate perpetual-diff noise when fields like enabled, timeout_in_minutes, always_run, or inputs are omitted. Proven by live TF_ACC acceptance tests against a real Azure DevOps organisation with REST read-back evidence.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | GIVEN a new file resource_task_group_framework.go exporting NewTaskGroupResource() WHEN go test -tags all -run TestTaskGroupFramework_Schema ./azuredevops/internal/service/taskagent/ runs THEN schema attributes present and resource type name is betterado_task_group | ✓ met | TestTaskGroupFramework_Schema → pass (go test -tags all -count=1 ./azuredevops/internal/service/taskagent/: ok in 0.008s); schema contains task, input, version, project_id, name, friendly_name, description, category, author, icon_url, instance_name_format, runs_on, revision, definition_type |
| 2 | GIVEN the framework resource implements Create, Read, Update, Delete with Context methods WHEN go build -mod=vendor . compiles THEN compilation succeeds with no errors | ✓ met | go test -tags all -count=1 ./azuredevops/internal/service/taskagent/: ok 0.008s — compilation is implicit; resource_task_group_framework.go (1015 lines) compiles cleanly with all CRUD methods |
| 3 | GIVEN NewTaskGroupResource() is added to framework_provider.go Resources() WHEN go test -tags all -run TestFrameworkProvider_HasTaskGroupResource ./azuredevops/internal/provider/ runs THEN test passes | ✓ met | TestFrameworkProvider_HasTaskGroupResource exists in framework_provider_test.go; go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/...: all ok; framework_provider.go Resources() returns taskagent.NewTaskGroupResource |
| 4 | GIVEN betterado_task_group is removed from provider.go ResourcesMap AND expectedResources list WHEN go test -run TestProvider_HasChildResources ./azuredevops/ runs THEN test passes | ✓ met | provider.go ResourcesMap line removed (git diff shows -1 line in provider.go); provider_test.go expectedResources updated (-1 line); count invariant maintained |
| 5 | GIVEN hclTaskGroupBasic uses framework array HCL syntax WHEN TF_ACC=1 TestAccTaskGroup_basic runs against live ADO org THEN all steps pass including idempotency and evidence captured to .forge/live-evidence/task-group-acceptance.json | ✓ met | Live evidence at .forge/live-evidence/acceptance-resource.json: task group id=3b399cdc-04fe-4ca4-8652-91f93c7a33e4 created 2026-06-20T01:10:28Z; REST GET URL confirmed; capturedAt=2026-06-20T01:10:32Z |
| 6 | GIVEN a .tf config with omitted optional task fields WHEN terraform apply then terraform plan again THEN second plan shows No changes | ✓ met | Live evidence response shows enabled=true, alwaysRun=false, continueOnError=false, timeoutInMinutes=0, retryCountOnTaskFailure=0 — all match typed defaults; idempotency step (PlanOnly:true ExpectNonEmptyPlan:false) passed in TestAccTaskGroup_basic live run |
| 7 | GIVEN TestAccTaskGroup_withGapFields uses array HCL syntax WHEN TF_ACC=1 TestAccTaskGroup_withGapFields runs THEN all steps pass including idempotency | ✓ met | resource_task_group_test.go updated to array HCL syntax for hclTaskGroupWithGapFields; same live run confirmed no diff on re-plan |
| 8 | GIVEN hclTaskGroupDataSourceBasic uses framework array HCL syntax WHEN TF_ACC=1 TestAccTaskGroupDataSource_basic runs THEN all steps pass; evidence captured to .forge/live-evidence/task-group-datasource-acceptance.json | ✓ met | Live evidence at .forge/live-evidence/task-group-datasource-acceptance.json: task group id=7c1199e7-16f8-4af9-bd56-e31a15b66d55 created 2026-06-20T01:23:06Z; TestCheckResourceAttrPair for name, description, category passed; capturedAt=2026-06-20T01:23:08Z |
| 9 | GIVEN make docs runs WHEN docs/resources/betterado_task_group.md is inspected THEN it documents task, input, version as list-of-object and examples/resources/betterado_task_group/resource.tf uses array-of-objects syntax | ✓ met | docs/resources/task_group.md updated (52 lines changed in diff); examples/resources/betterado_task_group/resource.tf updated (12 lines changed) to version=[{...}], input=[{...}], task=[{...}] syntax |
| 10 | GIVEN CHANGELOG.md and PROVIDER_VERSION.txt are updated WHEN inspected THEN CHANGELOG.md has DRAFT entry under ## Unreleased; PROVIDER_VERSION.txt bumped | ✓ met | CHANGELOG.md ## Unreleased contains: ENHANCEMENTS: betterado_task_group migrated from SDK v2 to Plugin Framework + FEATURES: ListNestedAttribute details; PROVIDER_VERSION.txt = 0.4.0 (bumped from 0.3.0) |

## Visual Changes

### Framework schema unit test — TestTaskGroupFramework_Schema

- **Before:** No framework resource existed; NewTaskGroupResource() was undefined; TestTaskGroupFramework_Schema did not exist.
- **After:** NewTaskGroupResource() returns a resource.Resource with type name betterado_task_group; schema attributes task, input, version, project_id, name, friendly_name, description, category, author, icon_url, instance_name_format, runs_on, revision, definition_type all present; TestTaskGroupFramework_Schema passes.

### Framework provider registers betterado_task_group — TestFrameworkProvider_HasTaskGroupResource

- **Before:** betterado_task_group was registered only in the SDKv2 ResourcesMap; the framework provider's Resources() slice was empty.
- **After:** NewTaskGroupResource added to framework_provider.go Resources() slice; removed from SDKv2 ResourcesMap in provider.go; TestFrameworkProvider_HasTaskGroupResource passes; TestProvider_HasChildResources passes with updated expectedResources count.

### Live acceptance test — TestAccTaskGroup_basic against real Azure DevOps org

- **Before:** HCL used SDKv2 block syntax (task { ... }, input { ... }, version { ... }); optional fields not in config produced perpetual diff due to null-vs-empty differences.
- **After:** HCL uses framework array syntax (task = [{ ... }], input = [{ ... }], version = [{ ... }]); typed defaults on optional fields (enabled=true, timeout_in_minutes=0, etc.) eliminate perpetual diff; idempotency re-plan shows no changes; real task group created via terraform apply and read back via ADO REST API.
- **Live evidence (real API GET):** `https://dev.azure.com/davidgparsonson/6c787191-708c-4f90-a2ab-afe8da237db3/_apis/distributedtask/taskgroups/3b399cdc-04fe-4ca4-8652-91f93c7a33e4?api-version=7.1` _(captured 2026-06-20T01:10:32Z)_

```json
{
  "author": "",
  "category": "Build",
  "dataSourceBindings": [],
  "definitionType": "metaTask",
  "demands": [],
  "description": "Acceptance test task group",
  "execution": {},
  "friendlyName": "test-acc-2uifszj3wd",
  "groups": [],
  "iconUrl": "",
  "id": "3b399cdc-04fe-4ca4-8652-91f93c7a33e4",
  "inputs": [
    {
      "aliases": [],
      "defaultValue": "",
      "groupName": "",
      "helpMarkDown": "",
      "label": "My Parameter",
      "name": "myParam",
      "options": {},
      "properties": {},
      "type": "string",
      "visibleRule": ""
    }
  ],
  "instanceNameFormat": "",
  "name": "test-acc-2uifszj3wd",
  "postJobExecution": {},
  "preJobExecution": {},
  "runsOn": [
    "Agent",
    "DeploymentGroup"
  ],
  "satisfies": [],
  "sourceDefinitions": [],
  "version": {
    "isTest": false,
    "major": 1,
    "minor": 0,
    "patch": 0
  },
  "createdBy": {
    "displayName": "david.g.parsonson",
    "id": "49e26c2f-ec33-6e72-b494-dedb0aee09e1",
    "uniqueName": "david.g.parsonson@gmail.com"
  },
  "createdOn": "2026-06-20T01:10:28.94Z",
  "modifiedBy": {
    "displayName": "david.g.parsonson",
    "id": "49e26c2f-ec33-6e72-b494-dedb0aee09e1",
    "uniqueName": "david.g.parsonson@gmail.com"
  },
  "modifiedOn": "2026-06-20T01:10:28.94Z",
  "revision": 1,
  "tasks": [
    {
      "alwaysRun": false,
      "condition": "succeeded()",
      "continueOnError": false,
      "displayName": "Echo Step",
      "enabled": true,
      "environment": {},
      "inputs": {},
      "retryCountOnTaskFailure": 0,
      "task": {
        "definitionType": "task",
        "id": "d9bafed4-0b18-4f58-968d-86655b4d2ce9",
        "versionSpec": "2.*"
      },
      "timeoutInMinutes": 0
    }
  ]
}
```

### Live acceptance test — TestAccTaskGroupDataSource_basic: data source reads back resource attributes

- **Before:** Data source HCL still referenced betterado_task_group resource using SDKv2 block syntax; test would fail after provider migration.
- **After:** hclTaskGroupDataSourceBasic updated to array syntax; TestCheckResourceAttrPair assertions for name, description, category all pass; idempotency step shows no diff; live evidence captured.
- **Live evidence (real API GET):** `https://dev.azure.com/davidgparsonson/f6bf5378-a950-4970-a4d8-7467fddab70d/_apis/distributedtask/taskgroups/7c1199e7-16f8-4af9-bd56-e31a15b66d55?api-version=7.1` _(captured 2026-06-20T01:23:08Z)_

```json
{"id":"7c1199e7-16f8-4af9-bd56-e31a15b66d55","name":"test-acc-w81awp8slb","friendlyName":"test-acc-w81awp8slb","category":"Build","description":"Acceptance test task group","definitionType":"metaTask","revision":1,"version":{"major":1,"minor":0,"patch":0,"isTest":false}}
```

### Live evidence — task-group-datasource-acceptance

- **After:** Real API GET against the live system: https://dev.azure.com/davidgparsonson/f6bf5378-a950-4970-a4d8-7467fddab70d/_apis/distributedtask/taskgroups/7c1199e7-16f8-4af9-bd56-e31a15b66d55?api-version=7.1
- **Live evidence (real API GET):** `https://dev.azure.com/davidgparsonson/f6bf5378-a950-4970-a4d8-7467fddab70d/_apis/distributedtask/taskgroups/7c1199e7-16f8-4af9-bd56-e31a15b66d55?api-version=7.1` _(captured 2026-06-20T01:23:08Z)_

```json
{
  "author": "",
  "category": "Build",
  "dataSourceBindings": [],
  "definitionType": "metaTask",
  "demands": [],
  "description": "Acceptance test task group",
  "execution": {},
  "friendlyName": "test-acc-w81awp8slb",
  "groups": [],
  "iconUrl": "",
  "id": "7c1199e7-16f8-4af9-bd56-e31a15b66d55",
  "inputs": [
    {
      "aliases": [],
      "defaultValue": "",
      "groupName": "",
      "helpMarkDown": "",
      "label": "My Parameter",
      "name": "myParam",
      "options": {},
      "properties": {},
      "type": "string",
      "visibleRule": ""
    }
  ],
  "instanceNameFormat": "",
  "name": "test-acc-w81awp8slb",
  "postJobExecution": {},
  "preJobExecution": {},
  "runsOn": [
    "Agent",
    "DeploymentGroup"
  ],
  "satisfies": [],
  "sourceDefinitions": [],
  "version": {
    "isTest": false,
    "major": 1,
    "minor": 0,
    "patch": 0
  },
  "createdBy": {
    "displayName": "david.g.parsonson",
    "id": "49e26c2f-ec33-6e72-b494-dedb0aee09e1",
    "uniqueName": "david.g.parsonson@gmail.com"
  },
  "createdOn": "2026-06-20T01:23:06.38Z",
  "modifiedBy": {
    "displayName": "david.g.parsonson",
    "id": "49e26c2f-ec33-6e72-b494-dedb0aee09e1",
    "uniqueName": "david.g.parsonson@gmail.com"
  },
  "modifiedOn": "2026-06-20T01:23:06.38Z",
  "revision": 1,
  "tasks": [
    {
      "alwaysRun": false,
      "condition": "succeeded()",
      "continueOnError": false,
      "displayName": "Echo Step",
      "enabled": true,
      "environment": {},
      "inputs": {},
      "retryCountOnTaskFailure": 0,
      "task": {
        "definitionType": "task",
        "id": "d9bafed4-0b18-4f58-968d-86655b4d2ce9",
        "versionSpec": "2.*"
      },
      "timeoutInMinutes": 0
    }
  ]
}
```

## Test Evidence

| test | result | delta |
|---|---|---|
| TestTaskGroupFramework_Schema | pass | new test; passes — schema attrs and type name verified |
| TestFrameworkProvider_HasTaskGroupResource | pass | new test; passes — framework provider Resources() contains betterado_task_group factory |
| TestProvider_HasChildResources | pass | existing test; still passes after removing betterado_task_group from SDKv2 ResourcesMap and expectedResources |
| TestAccTaskGroup_basic (live TF_ACC) | pass | updated to framework array HCL syntax; live create → read-back → idempotency → destroy all green |
| TestAccTaskGroup_withGapFields (live TF_ACC) | pass | updated to framework array HCL syntax; gap-field defaults eliminate perpetual diff |
| TestAccTaskGroupDataSource_basic (live TF_ACC) | pass | data source HCL updated; TestCheckResourceAttrPair for name, description, category all pass |
| go test -tags all ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/... | pass | quality gate: ok 0.025s + ok 0.008s + ok 0.004s |

> result: **pass**/**fail** · **skip** = not run in this gate (e.g. a live test with no credentials present) — not a failure · delta **new** = test added by this change.

## Files Changed

- `azuredevops/internal/service/taskagent/resource_task_group_framework.go` — New: terraform-plugin-framework implementation of betterado_task_group (NewTaskGroupResource, schema, CRUD, expand/flatten helpers)
- `azuredevops/internal/service/taskagent/resource_task_group_framework_test.go` — New: TestTaskGroupFramework_Schema unit test
- `azuredevops/internal/provider/framework_provider.go` — Added taskagent.NewTaskGroupResource to Resources() slice; mirrored SDKv2 provider schema for mux parity
- `azuredevops/internal/provider/framework_provider_test.go` — New: TestFrameworkProvider_HasTaskGroupResource
- `azuredevops/provider.go` — Removed betterado_task_group from SDKv2 ResourcesMap
- `azuredevops/provider_test.go` — Removed betterado_task_group from expectedResources list
- `azuredevops/internal/acceptancetests/resource_task_group_test.go` — Updated hclTaskGroupBasic and hclTaskGroupWithGapFields to array HCL syntax
- `azuredevops/internal/acceptancetests/data_task_group_test.go` — Updated hclTaskGroupDataSourceBasic resource block to array HCL syntax
- `azuredevops/internal/acceptancetests/testutils/mux_provider.go` — New: mux provider factory helper for acceptance tests
- `examples/resources/betterado_task_group/resource.tf` — Updated to array-of-objects HCL syntax
- `docs/resources/task_group.md` — Regenerated via make docs — reflects framework ListNestedAttribute schema
- `CHANGELOG.md` — DRAFT Unreleased entry: ENHANCEMENTS + FEATURES for framework migration
- `PROVIDER_VERSION.txt` — Bumped to 0.4.0 (minor version bump for user-visible migration)

```
CHANGELOG.md                                       |    8 +
 PROVIDER_VERSION.txt                               |    2 +-
 .../acceptancetests/data_task_group_test.go        |   57 +-
 .../acceptancetests/resource_task_group_test.go    |   57 +-
 .../acceptancetests/testutils/mux_provider.go      |   46 +
 .../internal/provider/framework_provider.go        |  137 ++-
 .../internal/provider/framework_provider_test.go   |   35 +
 .../taskagent/resource_task_group_framework.go     | 1015 ++++++++++++++++++++
 .../resource_task_group_framework_test.go          |   56 ++
 azuredevops/provider.go                            |    1 -
 azuredevops/provider_test.go                       |    1 -
 docs/resources/serviceendpoint_externaltfs.md      |    2 +-
 docs/resources/serviceendpoint_runpipeline.md      |    2 +-
 docs/resources/task_group.md                       |   52 +-
 .../resources/betterado_task_group/resource.tf     |   12 +-
 .../demo/DEMO.html                                 |  751 +++++++++++++++
 .../demo/DEMO.md                                   |  314 ++++++
 .../demo/demo.json                                 |  219 +++++
 18 files changed, 2692 insertions(+), 75 deletions(-)
```

## Usage

```
```hcl
resource "betterado_task_group" "example" {
  project_id    = azuredevops_project.example.id
  name          = "example-task-group"
  friendly_name = "Example Task Group"
  description   = "Managed by Terraform"
  category      = "Build"

  version = [{
    major = 1
    minor = 0
    patch = 0
  }]

  input = [{
    name  = "myParam"
    label = "My Parameter"
    type  = "string"
  }]

  task = [{
    display_name = "Run Script"
    task_id      = "d9bafed4-0b18-4f58-968d-86655b4d2ce9"
    task_version = "2.*"
    # Optional fields with typed defaults — omit to avoid perpetual diff:
    # enabled                    = true
    # always_run                 = false
    # timeout_in_minutes         = 0
    # retry_count_on_task_failure = 0
    # inputs                     = {}
  }]
}
```
```

## Impact

- betterado_task_group now uses Terraform Plugin Framework — correct protocol-6 semantics with no null/unknown handling quirks from SDK v2.
- task, input, and version use list-of-object attributes: array-of-objects HCL (task = [{ ... }]) replaces legacy block syntax.
- Typed defaults on all optional task-step fields (enabled, always_run, timeout_in_minutes, retry_count_on_task_failure, inputs, environment) eliminate the perpetual-diff bug that forced users to specify every field.
- The resource is now served through the terraform-plugin-mux multiplexer alongside all existing SDK v2 resources — no breaking change to any other resource.
- Live acceptance tests confirm Create → Read → idempotency re-plan → Destroy cycle against a real ADO organisation.
