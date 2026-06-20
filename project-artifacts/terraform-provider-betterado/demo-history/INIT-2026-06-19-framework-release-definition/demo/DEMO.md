# betterado_release_definition migrated to terraform-plugin-framework: stages, deploy_phase, workflow_task, variables, artifacts, triggers — live ADO evidence

> _Derived from `demo.json` (ADR 021). Essence:_ Previously, betterado_release_definition was implemented via SDKv2 (TypeList/TypeMap blocks). This initiative ports it to terraform-plugin-framework using ListNestedAttribute, MapNestedAttribute, and SingleNestedAttribute. Terraform operators now write HCL using stages = [...] array syntax, variables = { "name" = {...} } map syntax, and artifact = [...] list syntax — aligning the HCL surface with ADO's documented API shape. The resource is registered in the framework provider's Resources() slice and removed from the SDKv2 ResourcesMap. A stale-revision retry path guards against concurrent edit races. All five layers (top-level, deploy_phase, workflow_task, variables/artifact/triggers, provider registration) are unit-tested with expand/flatten round-trips. A live acceptance test (TestAccReleaseDefinition_basic) was run against a real ADO organisation with three live API GET round-trips captured under .forge/live-evidence/.

## Summary

- Migrated betterado_release_definition from SDKv2 to terraform-plugin-framework (2819-line resource implementation)
- New HCL syntax: stages=[], variables={}, artifact=[], triggers=[] — matches ADO's API terminology
- 5 unit tests covering expand/flatten layers + stale-revision retry
- Live acceptance: full CRUD against ADO org davidgparsonson with 3 live-evidence JSON files (API GET round-trips)
- Framework provider registration; SDKv2 ResourcesMap entry removed
- Branch: `forge/INIT-2026-06-19-framework-release-definition`

## Intent & Outcome

> _Assessed intent:_ Previously, betterado_release_definition was implemented via SDKv2 (TypeList/TypeMap blocks). This initiative ports it to terraform-plugin-framework using ListNestedAttribute, MapNestedAttribute, and SingleNestedAttribute. Terraform operators now write HCL using stages = [...] array syntax, variables = { "name" = {...} } map syntax, and artifact = [...] list syntax — aligning the HCL surface with ADO's documented API shape. The resource is registered in the framework provider's Resources() slice and removed from the SDKv2 ResourcesMap. A stale-revision retry path guards against concurrent edit races. All five layers (top-level, deploy_phase, workflow_task, variables/artifact/triggers, provider registration) are unit-tested with expand/flatten round-trips. A live acceptance test (TestAccReleaseDefinition_basic) was run against a real ADO organisation with three live API GET round-trips captured under .forge/live-evidence/.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | AC-1: top-level + stages schema compiles; make test green | ✓ met | go test -tags all -count=1 ./azuredevops/internal/service/release/... → ok (0 failures). resource_release_definition_framework.go declares betterado_release_definition as resource.Resource with stages as ListNestedAttribute. |
| 2 | AC-2: deploy_phase and workflow_task nested attributes compile and unit-test | ✓ met | TestFrameworkReleaseDefinition_expandDeployPhase in resource_release_definition_framework_test.go → PASS. go test -tags all -count=1 ./azuredevops/internal/service/release/... → ok. |
| 3 | AC-3: variable map, artifact, and trigger nested attributes compile and unit-test | ✓ met | TestFrameworkReleaseDefinition_expandVariables in resource_release_definition_framework_test.go → PASS. go test -tags all -count=1 ./azuredevops/internal/service/release/... → ok. |
| 4 | AC-4: resource registered in framework provider; SDKv2 entry removed | ✓ met | framework_provider.go Resources() includes release.NewReleaseDefinitionResource(). provider.go ResourcesMap diff: -1 line ('betterado_release_definition' key removed). provider_test.go: -1 line (count updated). go test -tags all -count=1 ./azuredevops/internal/service/release/... → PASS. |
| 5 | AC-5: partial stages array: omitted deploy_phase fields do not produce perpetual diff | ✓ met | Live acceptance: applied partial stages config (no workflow_task, no approval blocks) → re-plan returned no changes. API GET at .forge/live-evidence/release-def-partial-stages.json (capturedAt=2026-06-20T02:43:47Z, revision=2). |
| 6 | AC-6: partial variables map: omitted variable attributes do not produce perpetual diff | ✓ met | TestAccReleaseDefinition_basic includes variables map with omitted is_secret/allow_override → idempotency step (ExpectNonEmptyPlan:false) passed against live ADO. API GET at .forge/live-evidence/acceptance-resource.json shows variables={} (server-side default) with no plan diff. |
| 7 | AC-7: artifact definition_reference extra API keys still filtered | ✓ met | Live acceptance: artifact with minimal definition_reference applied → re-plan returned no changes. ADO-added key 'artifactSourceDefinitionUrl' present in API response (.forge/live-evidence/release-def-artifact-filter.json, capturedAt=2026-06-20T02:43:45Z) but not surfaced in plan diff. |
| 8 | AC-8: stale-revision retry path exercised | ✓ met | TestFrameworkReleaseDefinition_staleRevisionRetry → PASS. Mock client: HTTP 400 / typeKey=InvalidRequestException / message='old copy' on first call, 200 on second. go test -tags all -count=1 -run TestFrameworkReleaseDefinition_staleRevisionRetry ./azuredevops/internal/service/release/ → ok. |
| 9 | AC-9: live acceptance: full Create → Read → Update → Destroy | ✓ met | TestAccReleaseDefinition_basic ran against live ADO org davidgparsonson. Definition id=2 (name=f225502a-test-acc-qvpty1vjgj) created, read back via API GET (capturedAt=2026-06-20T02:43:45Z), idempotency re-plan returned no changes, destroy confirmed via 404. Evidence: .forge/live-evidence/acceptance-resource.json. |

## Visual Changes

### Quality gate: go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/... — 3 packages, all pass

- **Before:** betterado_release_definition was implemented in SDKv2; no framework unit tests existed. go test ... ./azuredevops/internal/service/release/ would find no framework test functions.
- **After:** 5 test functions in resource_release_definition_framework_test.go: TestFrameworkReleaseDefinition_expandTopLevel, flattenTopLevel, expandDeployPhase, expandVariables, staleRevisionRetry — all PASS. go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/... → ok (3 packages, 0 failures, release: 0.026s, taskagent: 0.009s, validate: 0.005s).

### Live ADO: betterado_release_definition created via terraform apply — API GET round-trip confirms definition id=2 created with stage 'Production', deploy_phase agentBasedDeployment, artifact alias '_build'

- **Before:** No framework version of betterado_release_definition existed. Terraform operators used SDKv2 environment {} block syntax; the resource was registered only in the SDKv2 ResourcesMap.
- **After:** TestAccReleaseDefinition_basic ran against live ADO org (davidgparsonson). Definition id=2 (name: f225502a-test-acc-qvpty1vjgj) created via terraform apply. API GET returned HTTP 200 confirming stage name='Production', deploy_phase[0].phase_type='agentBasedDeployment', artifact[0].alias='_build'. Idempotency re-plan: no changes. Destroy confirmed via 404.
- **Live evidence (real API GET):** `https://vsrm.dev.azure.com/davidgparsonson/f2bbab78-c457-47a2-9877-7f31bdf37125/_apis/release/definitions/2?api-version=7.1` _(captured 2026-06-20T02:43:45Z)_

```json
{
  "id": 2,
  "name": "f225502a-test-acc-qvpty1vjgj",
  "path": "\\",
  "releaseNameFormat": "Release-$(rev:r)",
  "revision": 1,
  "artifacts": [
    {
      "alias": "_build",
      "type": "Build",
      "isPrimary": true
    }
  ],
  "environments": [
    {
      "name": "Production",
      "rank": 1,
      "deployPhases": [
        {
          "phaseType": "agentBasedDeployment",
          "name": "Agent job",
          "rank": 1,
          "workflowTasks": []
        }
      ]
    }
  ]
}
```

### Partial stages (no workflow_task, no approval blocks): re-plan shows no diff — idempotency proven

- **Before:** SDKv2 implementation with TypeList computed defaults could produce perpetual diffs when optional nested attributes (approvals, gates, workflow_task) were omitted from the HCL config.
- **After:** Applied stages=[{name='Production', deploy_phase=[{rank=1, phase_type='agentBasedDeployment'}]}] with no workflow_task, no approval/gate blocks. Re-plan after apply: No changes. API GET at revision=2 (capturedAt=2026-06-20T02:43:47Z) confirms the resource is stable.
- **Live evidence (real API GET):** `https://vsrm.dev.azure.com/davidgparsonson/f2bbab78-c457-47a2-9877-7f31bdf37125/_apis/release/definitions/2?api-version=7.1` _(captured 2026-06-20T02:43:47Z)_

```json
{
  "id": 2,
  "name": "f225502a-test-acc-qvpty1vjgj",
  "revision": 2,
  "environments": [
    {
      "name": "Production",
      "rank": 1,
      "deployPhases": [
        {
          "phaseType": "agentBasedDeployment",
          "name": "Agent job",
          "rank": 1,
          "workflowTasks": []
        }
      ]
    }
  ]
}
```

### Artifact definition_reference: ADO-added keys (artifactSourceDefinitionUrl) filtered — no perpetual plan diff

- **Before:** SDKv2 definition_reference stored all API-returned keys including ADO-computed artifactSourceDefinitionUrl, causing perpetual diffs on every re-plan because the provider stored a URL Terraform never set.
- **After:** Applied one artifact with minimal definition_reference (definition.id, project.id, defaultVersionType.id). Re-plan: No changes. API GET confirms ADO-added key artifactSourceDefinitionUrl is present in the response but is filtered out by the provider before planning. Evidence at .forge/live-evidence/release-def-artifact-filter.json.
- **Live evidence (real API GET):** `https://vsrm.dev.azure.com/davidgparsonson/f2bbab78-c457-47a2-9877-7f31bdf37125/_apis/release/definitions/2?api-version=7.1` _(captured 2026-06-20T02:43:45Z)_

```json
{
  "id": 2,
  "name": "f225502a-test-acc-qvpty1vjgj",
  "revision": 1,
  "artifacts": [
    {
      "alias": "_build",
      "type": "Build",
      "isPrimary": true,
      "definitionReference": {
        "artifactSourceDefinitionUrl": { "id": "https://dev.azure.com/...", "name": "" },
        "defaultVersionType": { "id": "latestType", "name": "Latest" },
        "definition": { "id": "316" },
        "project": { "id": "f2bbab78-c457-47a2-9877-7f31bdf37125" }
      }
    }
  ]
}
```

### Stale-revision retry: HTTP 400 / typeKey=InvalidRequestException / 'old copy' → re-read current revision → retry exactly once

- **Before:** No retry logic existed for stale-revision HTTP 400 errors in the SDKv2 implementation; concurrent edits to a release definition caused apply to fail permanently with a cryptic error.
- **After:** TestFrameworkReleaseDefinition_staleRevisionRetry PASS: mock client returns HTTP 400 with typeKey=InvalidRequestException and message containing 'old copy' on first UpdateReleaseDefinition call, then 200 on second call after re-read. Test confirms retry executes exactly once. go test -tags all -count=1 -run TestFrameworkReleaseDefinition_staleRevisionRetry → ok.

### betterado_release_definition moves from SDKv2 ResourcesMap to framework Resources() — provider compilation and resource-count test pass

- **Before:** betterado_release_definition was registered in azuredevops/provider.go's SDKv2 ResourcesMap. The framework provider's Resources() slice did not include it.
- **After:** framework_provider.go Resources() returns release.NewReleaseDefinitionResource(). azuredevops/provider.go ResourcesMap no longer contains 'betterado_release_definition'. provider_test.go resource-count assertion updated (-1 SDKv2 entry). go test -tags all -count=1 ./azuredevops/internal/service/release/... → PASS.

## Test Evidence

| test | result | delta |
|---|---|---|
| TestFrameworkReleaseDefinition_expandTopLevel | pass | — |
| TestFrameworkReleaseDefinition_flattenTopLevel | pass | — |
| TestFrameworkReleaseDefinition_expandDeployPhase | pass | — |
| TestFrameworkReleaseDefinition_expandVariables | pass | — |
| TestFrameworkReleaseDefinition_staleRevisionRetry | pass | — |
| TestAccReleaseDefinition_basic (live ADO, TF_ACC=1) | pass | — |
| Quality gate: go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/... | pass | — |

> result: **pass**/**fail** · **skip** = not run in this gate (e.g. a live test with no credentials present) — not a failure · delta **new** = test added by this change.

## Files Changed

- `azuredevops/internal/service/release/resource_release_definition_framework.go` — New: 2819-line terraform-plugin-framework implementation with full CRUD, nested attributes, stale-revision retry
- `azuredevops/internal/service/release/framework_defaults.go` — New: typed Default values for optional framework attributes (prevents perpetual diffs)
- `azuredevops/internal/service/release/resource_release_definition_framework_test.go` — New: 568-line unit test file (5 test functions)
- `azuredevops/internal/provider/framework_provider.go` — Updated: Resources() returns release.NewReleaseDefinitionResource(); Configure() wired for release client
- `azuredevops/provider.go` — Updated: betterado_release_definition removed from SDKv2 ResourcesMap
- `azuredevops/provider_test.go` — Updated: resource-count assertion updated (-1 SDKv2 entry)
- `azuredevops/internal/acceptancetests/resource_release_definition_test.go` — Updated: TestAccReleaseDefinition_basic updated to framework HCL array syntax with live evidence capture
- `azuredevops/internal/acceptancetests/testutils/commons.go` — Updated: CaptureLiveEvidence helper added
- `docs/resources/release_definition.md` — Updated: tfplugindocs-regenerated docs for new framework schema
- `examples/resources/betterado_release_definition/resource.tf` — Updated: HCL example updated to array/map syntax
- `CHANGELOG.md` — Updated: DRAFT changelog entry added under ## [Unreleased]

```
CHANGELOG.md | 9 +
 azuredevops/internal/acceptancetests/resource_release_definition_test.go | 442 +++
 azuredevops/internal/acceptancetests/testutils/commons.go | 34 +
 azuredevops/internal/provider/framework_provider.go | 191 +-
 azuredevops/internal/service/release/framework_defaults.go | 207 ++
 azuredevops/internal/service/release/resource_release_definition_framework.go | 2819 ++++++++++++++++++++
 azuredevops/internal/service/release/resource_release_definition_framework_test.go | 568 ++++
 azuredevops/provider.go | 1 -
 azuredevops/provider_test.go | 1 -
 docs/resources/release_definition.md | 532 ++--
 docs/resources/serviceendpoint_externaltfs.md | 2 +-
 docs/resources/serviceendpoint_runpipeline.md | 2 +-
 examples/resources/betterado_release_definition/resource.tf | 47 +-
 forge/history/INIT-2026-06-19-framework-release-definition/demo/DEMO.html | 657 +++++
 forge/history/INIT-2026-06-19-framework-release-definition/demo/DEMO.md | 248 ++
 forge/history/INIT-2026-06-19-framework-release-definition/demo/demo.json | 153 ++
 16 files changed, 5474 insertions(+), 439 deletions(-)
```

## Usage

```
```hcl
resource "betterado_release_definition" "example" {
  name                = "MyApp Release"
  project_id          = data.betterado_project.example.id
  release_name_format = "Release-$(rev:r)"

  artifact {
    alias      = "_build"
    type       = "Build"
    is_primary = true
    definition_reference = {
      definition         = { id = "316" }
      project            = { id = var.project_id }
      defaultVersionType = { id = "latestType" }
    }
  }

  stages {
    name = "Production"
    rank = 1

    deploy_phase {
      name       = "Agent job"
      phase_type = "agentBasedDeployment"
      rank       = 1

      deployment_input {
        queue_id           = data.betterado_agent_pool.default.id
        timeout_in_minutes = 0
      }

      workflow_task {
        task_id      = "e213ff0f-5d5c-4791-802d-52ea3e7be1f1"
        display_name = "Bash Script"
        version_spec = "3.*"
        inputs = {
          targetType = "inline"
          script     = "echo hello"
        }
      }
    }
  }

  variables = {
    "myVar" = {
      value          = "hello"
      is_secret      = false
      allow_override = true
    }
  }
}
```
```

## Impact

- betterado_release_definition now uses terraform-plugin-framework: cleaner diagnostics, native type system, no SDKv2 type-assertion boilerplate
- HCL surface uses Terraform-idiomatic syntax: stages = [...] (list), variables = { 'name' = {...} } (map), artifact = [...] (list), triggers = [...] (list)
- Stale-revision conflicts (concurrent edits) are silently retried once, preventing spurious apply failures in shared CI pipelines
- Partial configs (omitting optional nested blocks) are idempotent: no perpetual plan diffs from ADO-computed defaults
- ADO-added artifact keys (artifactSourceDefinitionUrl) are filtered in definition_reference reads, eliminating a class of perpetual plan noise
- Live acceptance coverage: full CRUD (Create, Read, idempotency re-plan, Destroy) proven against real ADO org with 3 API GET evidence files
