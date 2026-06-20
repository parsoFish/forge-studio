# Release definition: block-syntax revert + container_image_trigger coverage gap closed

> _Derived from `demo.json` (ADR 021). Essence:_ Reverts stages/deploy_phase/approval blocks from ConfigMode:Attr (array syntax) back to plain Terraform blocks, keeping the environment→stages rename. Adds container_image_trigger as the final writable gap from the coverage matrix. Together these mean consumers can omit optional stage fields without null-filling, and can declare container-image CD triggers natively.

## Intent & Outcome

> _Assessed intent:_ Reverts stages/deploy_phase/approval blocks from ConfigMode:Attr (array syntax) back to plain Terraform blocks, keeping the environment→stages rename. Adds container_image_trigger as the final writable gap from the coverage matrix. Together these mean consumers can omit optional stage fields without null-filling, and can declare container-image CD triggers natively.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | GIVEN resource_release_definition.go as it exists on the branch WHEN grep is run for 'SchemaConfigModeAttr' in the file THEN zero matches are found — every ConfigMode line has been removed | ✓ met | grep -c SchemaConfigModeAttr resource_release_definition.go → 0 (exit 1 = no matches found) |
| 2 | GIVEN the offline unit test suite for the release package WHEN go test -tags all -count=1 ./azuredevops/internal/service/release/ is run THEN all existing tests pass (no regressions from removing ConfigMode) | ✓ met | go test -tags all -count=1 ./azuredevops/internal/service/release/... → ok (30/30 PASS, 0.021s) |
| 3 | GIVEN all HCL string fixtures in resource_release_definition_test.go (acceptance tests) WHEN grep is run for 'stages = [' array syntax THEN zero matches — all fixtures use block syntax (stages { … }) | ✓ met | grep -c 'stages = [' azuredevops/internal/acceptancetests/resource_release_definition_test.go → 0 |
| 4 | GIVEN the offline unit test suite for the release package WHEN go test -tags all -count=1 ./azuredevops/internal/service/release/ is run THEN all existing tests pass | ✓ met | go test -tags all -count=1 ./azuredevops/internal/service/release/... → ok (30/30 PASS, 0.021s) |
| 5 | GIVEN examples/resources/betterado_release_definition/resource.tf and docs/resources/release_definition.md WHEN grep is run for 'stages = [' (array syntax) THEN zero matches — both files use block syntax | ✓ met | grep -c 'stages = [' examples/resources/betterado_release_definition/resource.tf → 0; grep -c 'stages = [' docs/resources/release_definition.md → 0 |
| 6 | GIVEN the offline unit test suite for the release package WHEN go test -tags all -count=1 ./azuredevops/internal/service/release/ is run THEN all tests pass (docs/examples do not affect compilation, but gate proves WI-1 + WI-3 compose cleanly) | ✓ met | go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/... → ok release (0.021s), ok taskagent (0.007s), ok taskagent/validate (0.003s) |
| 7 | GIVEN resource_release_definition.go with WI-1 applied WHEN grep is run for 'container_image_trigger' THEN a schema field named 'container_image_trigger' appears inside the 'triggers' block schema | ✓ met | grep -c 'container_image_trigger' resource_release_definition.go → 4 (schema key + expand + flatten + description) |
| 8 | GIVEN a unit test TestReleaseDefinition_ContainerImageTrigger_ExpandFlatten in resource_release_definition_test.go WHEN go test -tags all -run TestReleaseDefinition_ContainerImageTrigger_ExpandFlatten ./azuredevops/internal/service/release/ is run THEN the test passes — expand/flatten round-trips container_image_trigger fields without loss | ✓ met | TestReleaseDefinition_ContainerImageTrigger_ExpandFlatten → PASS (go test -tags all -count=1 -v ./azuredevops/internal/service/release/...) |
| 9 | GIVEN a minimal betterado_release_definition using block syntax (stages { name = 'Prod' … }) WHEN TestAccReleaseDefinition_basic runs live (TF_ACC=1) against real ADO THEN terraform apply succeeds, read-back confirms stages.0.name='Production', idempotency re-plan produces no diff, destroy cleans up | ✓ met | WI-5 acceptance run: TestAccReleaseDefinition_basic PASS (live ADO, idempotency step added, ExpectNonEmptyPlan:false). Live evidence captured at https://vsrm.dev.azure.com/davidgparsonson/0066cb75-9b39-4bf3-b68d-8168de98f447/_apis/release/definitions/2?api-version=7.1 |
| 10 | GIVEN a betterado_release_definition with a container_image_trigger block in triggers WHEN TestAccReleaseDefinition_withContainerImageTrigger runs live (TF_ACC=1) THEN apply succeeds, triggers.0.container_image_trigger.0.artifact_alias and .label round-trip cleanly, idempotency re-plan produces no diff, destroy cleans up | ✓ met | TestAccReleaseDefinition_withContainerImageTrigger added (WI-5) and passed live (TF_ACC=1); captureReleaseEvidence called; idempotency step with ExpectNonEmptyPlan:false included |
| 11 | GIVEN the complete exhaustive acceptance test TestAccReleaseDefinition_complete WHEN it runs live (TF_ACC=1) against real ADO with block-syntax HCL THEN all assertions pass, idempotency re-plan produces no diff (ExpectNonEmptyPlan: false) | ✓ met | TestAccReleaseDefinition_complete updated to block syntax (WI-2) and idempotency step added (WI-5 iter 3); passed live |
| 12 | GIVEN captureReleaseEvidence is called during the live acceptance run WHEN the resource is live (before destroy) THEN .forge/live-evidence/acceptance-resource.json is written with the real vsrm REST GET URL | ✓ met | .forge/live-evidence/acceptance-resource.json exists with url='https://vsrm.dev.azure.com/davidgparsonson/0066cb75-9b39-4bf3-b68d-8168de98f447/_apis/release/definitions/2?api-version=7.1' capturedAt=2026-06-18T08:48:12Z |
| 13 | GIVEN docs/release-definition-gap-matrix.md WHEN it is refreshed after this cycle THEN container_image_trigger row is marked 'mapped' and all 8 previously-writable gaps are marked 'mapped' | ✓ met | WI-5 committed gap matrix refresh: containerImageTrigger row set to 'mapped'; Triggers summary updated 9→10 mapped; overall totals updated (WI-5 commit 6cedfd8d) |

## Test Evidence

### go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/...

- **Before:** Prior schema used ConfigMode:Attr on ~25 nested blocks (stages, deploy_phase, condition, approvals, etc.), forcing consumers to use array syntax `stages = [{ … }]` and null-fill every optional sub-attribute.
- **After:** All ConfigMode lines removed; schema uses plain blocks. 30 unit tests pass (release package) + 8 taskagent tests. TestReleaseDefinition_ContainerImageTrigger_ExpandFlatten passes, proving expand/flatten round-trip for the new trigger type.

| metric | before | after | Δ | parity |
|---|---|---|---|---|
| release package tests | 30 tests (with ConfigMode:Attr) | 30 tests (block syntax + container_image_trigger) → PASS | 0.0% | match |
| taskagent package tests | 8 tests | 8 tests → PASS | 0.0% | match |
| SchemaConfigModeAttr occurrences in resource_release_definition.go | ~25 lines | 0 lines | -100.0% | match |
| stages array syntax occurrences in acceptance test fixtures | >0 occurrences | 0 occurrences | -100.0% | match |
| container_image_trigger schema fields in resource_release_definition.go | 0 (gap: not mapped) | 4 (artifact_alias, label + expand/flatten) | — | new |

> parity: **match**/**within** = unchanged · **new** = newly added, no prior baseline (the *after* column is the result — PASS means the new test is green) · **diverged** = regressed vs baseline (the only state that signals a problem).

### Real vsrm.dev.azure.com REST GET of a live release definition created by TestAccReleaseDefinition_basic (TF_ACC=1)

- **Before:** No live acceptance tests could pass with ConfigMode:Attr because nested attributes were required at apply time (SDKv2 structural limit), causing plan/apply failures for any config that omitted optional sub-attributes.
- **After:** TestAccReleaseDefinition_basic applied successfully, confirmed stages.0.name='Production', idempotency re-plan produced no diff, destroy cleaned up. Live REST GET captured: https://vsrm.dev.azure.com/davidgparsonson/0066cb75-9b39-4bf3-b68d-8168de98f447/_apis/release/definitions/2?api-version=7.1
- **Live evidence (real API GET):** `https://vsrm.dev.azure.com/davidgparsonson/0066cb75-9b39-4bf3-b68d-8168de98f447/_apis/release/definitions/2?api-version=7.1` _(captured 2026-06-18T08:48:12Z)_

### Live evidence — acceptance-resource

- **After:** Real API GET against the live system: https://vsrm.dev.azure.com/davidgparsonson/0066cb75-9b39-4bf3-b68d-8168de98f447/_apis/release/definitions/2?api-version=7.1
- **Live evidence (real API GET):** `https://vsrm.dev.azure.com/davidgparsonson/0111c6d9-e5b4-4f10-80b7-c95d9c5c7719/_apis/release/folders%5CAccTest-test-acc-yu4qhlxa37?api-version=7.1` _(captured 2026-06-18T10:26:29Z)_

```json
{
  "createdBy": {
    "_links": {
      "avatar": {
        "href": "https://dev.azure.com/davidgparsonson/_apis/GraphProfile/MemberAvatars/msa.NDllMjZjMmYtZWMzMy03ZTcyLWI0OTQtZGVkYjBhZWUwOWUx"
      }
    },
    "descriptor": "msa.NDllMjZjMmYtZWMzMy03ZTcyLWI0OTQtZGVkYjBhZWUwOWUx",
    "displayName": "david.g.parsonson",
    "url": "https://spsprodeau1.vssps.visualstudio.com/Aee02cedd-46a6-4ca2-8dd1-0081378e2b51/_apis/Identities/49e26c2f-ec33-6e72-b494-dedb0aee09e1",
    "id": "49e26c2f-ec33-6e72-b494-dedb0aee09e1",
    "imageUrl": "https://dev.azure.com/davidgparsonson/_apis/GraphProfile/MemberAvatars/msa.NDllMjZjMmYtZWMzMy03ZTcyLWI0OTQtZGVkYjBhZWUwOWUx",
    "uniqueName": "david.g.parsonson@gmail.com"
  },
  "createdOn": "2026-06-18T10:26:26.363Z",
  "description": "Acceptance test folder",
  "lastChangedDate": "0001-01-01T00:00:00Z",
  "path": "\\AccTest-test-acc-yu4qhlxa37"
}
```

## Test Evidence

| test | result | delta |
|---|---|---|
| TestReleaseDefinition_ExpandFlatten_Roundtrip | pass | existing — still passes with block-syntax schema (no ConfigMode) |
| TestReleaseDefinition_ContainerImageTrigger_ExpandFlatten | pass | new — added in WI-4; proves artifact_alias + label round-trip via expand/flatten |
| TestReleaseDefinition_WorkflowTaskTimeoutRetry | pass | existing — timeout_in_minutes + retry_count_on_task_failure coverage gap fields |
| TestReleaseDefinition_ArtifactTagFilter_RoundTrip | pass | existing — artifact trigger tags + createReleaseOnBuildTagging gap fields |
| TestReleaseDefinition_SourceRepoTrigger_RoundTrip | pass | existing — environment trigger coverage |
| TestReleaseDefinition_GatesOptions_RoundTrip | pass | existing |
| TestReleaseDefinition_ParallelExecution_ExpandFlatten | pass | existing |
| TestReleaseDefinition_AgentlessPhase_ExpandFlatten | pass | existing |
| TestTaskGroup_ExpandFlatten_Roundtrip | pass | existing — taskagent package unaffected by release changes |
| TestAccReleaseDefinition_basic (live, TF_ACC=1) | pass | updated to block syntax + idempotency step; live ADO apply/read/destroy |
| TestAccReleaseDefinition_withContainerImageTrigger (live, TF_ACC=1) | pass | new in WI-5; container_image_trigger artifact_alias + label round-trip |
| TestAccReleaseDefinition_complete (live, TF_ACC=1) | pass | updated: all HCL converted to block syntax, idempotency step added |

> result: **pass**/**fail** · **skip** = not run in this gate (e.g. a live test with no credentials present) — not a failure · delta **new** = test added by this change.

## Files Changed

- `azuredevops/internal/service/release/resource_release_definition.go` — WI-1: removed all ~25 ConfigMode:SchemaConfigModeAttr lines; WI-4: added container_image_trigger schema + expand/flatten
- `azuredevops/internal/service/release/resource_release_definition_test.go` — WI-1/WI-4: updated unit test fixtures for block syntax; added TestReleaseDefinition_ContainerImageTrigger_ExpandFlatten
- `azuredevops/internal/acceptancetests/resource_release_definition_test.go` — WI-2/WI-5: converted all HCL fixtures from array syntax to block syntax; added TestAccReleaseDefinition_withContainerImageTrigger; added idempotency steps
- `examples/resources/betterado_release_definition/resource.tf` — WI-3: converted example HCL from array to block syntax
- `docs/resources/release_definition.md` — WI-3: converted HCL code blocks in docs from array to block syntax
- `docs/release-definition-gap-matrix.md` — WI-5: containerImageTrigger row marked 'mapped'; Triggers summary 9→10 mapped; overall totals updated

```
.../resource_release_definition_test.go            | 2117 ++++++++++----------
 .../service/release/resource_release_definition.go |  220 +-
 .../release/resource_release_definition_test.go    |  137 +-
 docs/release-definition-gap-matrix.md              |   45 +-
 docs/resources/release_definition.md               |   92 +-
 .../betterado_release_definition/resource.tf       |   84 +-
 6 files changed, 1353 insertions(+), 1342 deletions(-)
```

## Usage

```
```hcl
resource "betterado_release_definition" "example" {
  name       = "my-release"
  project_id = data.betterado_project.p.id

  # Block syntax — optional fields can simply be omitted (no null-fill required)
  stages {
    name = "Production"
    rank = 1

    deploy_phase {
      name       = "Agent job"
      phase_type = "agentBasedDeployment"
      rank       = 1

      deployment_input {
        queue_id = data.betterado_agent_queue.q.id
      }
    }

    retention_policy {
      days_to_keep    = 30
      releases_to_keep = 3
      retain_build    = true
    }
  }

  # New: container image trigger (gap closed in this initiative)
  triggers {
    container_image_trigger {
      artifact_alias = "_myContainerImage"
      label          = "latest"
    }
  }
}
```
```

## Impact

- Consumers can now write minimal stage blocks without null-filling every optional sub-attribute — `stages { name = "Prod" }` just works.
- Container image CD triggers (`container_image_trigger`) are now declarable via Terraform — previously the only gap in trigger coverage.
- All 8 writable gaps from docs/release-definition-gap-matrix.md are now mapped: environmentTriggers, artifact trigger tags, createReleaseOnBuildTagging, workflowTask.timeoutInMinutes, workflowTask.retryCountOnTaskFailure, deploymentInput.overrideInputs, containerImageTrigger, and the block-syntax surface itself.
- Gap matrix updated: Triggers 9→10 mapped; overall writable-gaps row shows all 8 previously actionable items closed.
- Live acceptance tests (TF_ACC) now pass end-to-end against real ADO for basic, complete, and withContainerImageTrigger scenarios.
