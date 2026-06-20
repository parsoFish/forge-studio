# Architect plan — 2026-06-08T10-21-35

- Project: `terraform-provider-betterado`
- Repo: `/home/parso/forge/projects/terraform-provider-betterado`

> **Operator review.** This plan is presented on the `/architect/2026-06-08T10-21-35` screen in the forge UI. Read each section there, then click **approve**, **revise**, or **reject** — the runner finalizes your verdict, promoting the manifests to the queue only on approve.

## Operator brief + interview

Bring betterado_release_definition to feature-complete status against ADO REST API 7.2 by: (1) auditing the full CRUD/configuration surface gap between the current provider schema and the ADO models, (2) producing a prioritised roadmap of remaining schema fields, data sources, and acceptance test gaps, and (3) implementing the high-priority configuration surface to achieve declarative parity with what ADO's vsrm host exposes for classic release pipelines.

### Interview

| # | Question | Operator answer |
|---|---|---|
| 1 | Is this initiative producing an evaluation report and implementation plan, or actually implementing the missing CRUD operations and configurations? | Evaluation/audit (recommended) |
| 2 | What does 'feature complete' mean for the release resource in this context? | Specifically in relation to CRUD operations inline with a terraform provider typical layout and the rest of the project |
| 3 | Should this initiative include live ADO acceptance test fixes, or focus purely on CRUD/schema analysis? | Include test fixes (recommended) |
| 4 | When you say 'CRUD operations available on classic releases,' do you mean the resource lifecycle operations (Create/Read/Update/Delete on the resource itself) OR the configuration surface (schema features like gates, triggers, parallel execution)? | Configuration surface (recommended) |
| 5 | Should this initiative produce only an evaluation report, or also implement fixes for the stale acceptance tests? | And just to confirm, this is not a pure test fix initiative. this is planning all the way through to full feature parity. |
| 6 | What does 'feature complete' mean for release_definition in your view — ADO API 7.2 parity, or a narrower scope? | Read only/computed values would be good to exclude given terraform cant influence them anyway, but otherwise ado rest parity is desired |
| 7 | This initiative will produce an evaluation report + implementation plan. Should it ALSO implement the missing schema fields it identifies, or stop at the planning stage? | I feel like the audit should be part of this architecting in order to generate initiatives as relevant given its investigation |
| 8 | For 'feature complete' on release_definition, should the audit also evaluate whether data sources (List definitions, GetRevision, GetHistory) are needed, or focus purely on the resource schema? | Include data sources in scope |

## Brain context

- `/Users/jchannon/Projects/forge/projects/terraform-provider-betterado/brain/profile.md` — consulted during architect draft
- `/Users/jchannon/Projects/forge/brain/cycles/themes/spec-driven-development.md` — consulted during architect draft
- `/Users/jchannon/Projects/forge/brain/cycles/themes/eval-driven-development.md` — consulted during architect draft
- `/Users/jchannon/Projects/forge/brain/cycles/themes/dependency-ordered-work.md` — consulted during architect draft
- `/Users/jchannon/Projects/forge/brain/forge-dev/themes/exploration-vs-implementation-initiatives.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/profile.md` — consulted during architect draft
- `/home/parso/forge/brain/cycles/themes/spec-driven-development.md` — consulted during architect draft
- `/home/parso/forge/brain/cycles/themes/eval-driven-development.md` — consulted during architect draft
- `/home/parso/forge/brain/cycles/themes/dependency-ordered-work.md` — consulted during architect draft
- `/home/parso/forge/brain/forge-dev/themes/exploration-vs-implementation-initiatives.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/themes/release-substrate-context.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/themes/2026-05-31-release-definition-unit-test-substrate.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/themes/2026-06-06-data-source-split-read-only-pattern.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/themes/2026-06-07-data-source-parity-pattern-confirmed.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/themes/2026-06-05-ado-silent-field-discard-idempotency.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/themes/2026-06-06-environment-templates-spike-findings.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/themes/2026-06-05-live-acceptance-gate-for-acceptance-wis.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/themes/2026-06-06-acceptance-test-compile-only-gate.md` — consulted during architect draft

## Proposed initiatives

| ID | Title | Iteration budget | Depends on |
|---|---|---|---|
| `INIT-2026-06-08-release-definition-schema-audit` | Audit release_definition schema vs ADO REST 7.2 — produce gap matrix and implementation roadmap | 8 | — |
| `INIT-2026-06-08-release-definition-environment-config-surface` | Implement missing environment configuration fields (environmentTriggers, schedules, processParameters, properties) | 20 | INIT-2026-06-08-release-definition-schema-audit |
| `INIT-2026-06-08-release-definition-artifact-trigger-enhancements` | Implement artifact trigger enhancements (tag filters, source branch defaults, artifact filters) | 12 | INIT-2026-06-08-release-definition-schema-audit |
| `INIT-2026-06-08-release-definition-approval-options-gates-comple` | Complete approval options and deployment gates schema (ApprovalOptions fields, gate options, sampling interval) | 15 | INIT-2026-06-08-release-definition-schema-audit |
| `INIT-2026-06-08-release-data-sources-completion` | Implement missing release data sources (revision history, definition history) | 10 | INIT-2026-06-08-release-definition-schema-audit |
| `INIT-2026-06-08-release-acceptance-test-fixes` | Fix stale acceptance tests and add comprehensive test coverage for new schema fields | 12 | INIT-2026-06-08-release-definition-environment-config-surface, INIT-2026-06-08-release-definition-artifact-trigger-enhancements, INIT-2026-06-08-release-definition-approval-options-gates-comple |

### INIT-2026-06-08-release-definition-schema-audit — drawer

```markdown
## Summary

Systematically compare the current `betterado_release_definition` Terraform schema against the ADO REST 7.2 `ReleaseDefinition` and `ReleaseDefinitionEnvironment` models. Produce a gap matrix documenting every unmapped field, categorised by CRUD lifecycle (Create-writable vs Read-only/Computed), and a prioritised implementation roadmap for the gaps.

This initiative is pure evaluation and planning — no code implementation. The output feeds directly into subsequent implementation initiatives.

## Acceptance criteria

### AC-1: Gap matrix document

**Given** the vendored `release/models.go` types (`ReleaseDefinition`, `ReleaseDefinitionEnvironment`, `Artifact`, triggers, `DeployPhase` subtypes, `ApprovalOptions`, `ReleaseDefinitionGatesStep`, `EnvironmentOptions`, `EnvironmentRetentionPolicy`, etc.)
**When** compared field-by-field against the current `resource_release_definition.go` schema
**Then** produce `docs/release-definition-gap-matrix.md` containing:
- A table of every ADO model field with columns: Field path | ADO type | TF schema status (mapped / missing / partial) | Writable? | Notes
- A summary count: N mapped, M missing, P partial
- Explicit callout of read-only/computed fields (excluded from implementation scope per operator's brief)

### AC-2: Data source gap assessment

**Given** the SDK client methods `GetReleaseDefinition`, `GetReleaseDefinitions`, `GetDefinitionRevision`, `GetReleaseDefinitionHistory`
**When** compared against existing data sources (`data_release_definition.go`, `data_release_definitions.go`)
**Then** the gap matrix includes a data-source section documenting:
- Which SDK read methods are surfaced as data sources
- Which are missing (e.g., `GetDefinitionRevision` for revision history, `GetReleaseDefinitionHistory` for audit)
- Recommendation: implement / defer / out-of-scope

### AC-3: Acceptance test gap assessment

**Given** the current `TestAccReleaseDefinition_*` tests in `azuredevops/internal/acceptancetests/`
**When** audited for coverage of the schema fields
**Then** the gap matrix includes a test-coverage section:
- Fields exercised by existing tests vs fields with no acceptance coverage
- Known stale/failing tests (e.g., missing `retention_policy` + `pre_deploy_approval` per `2026-05-31-forge-onboarding-findings`)
- Recommended new test cases

### AC-4: Implementation roadmap

**Given** the gap matrix
**When** prioritised by: (a) ADO 7.2 required-for-create fields, (b) operator's request for config-surface parity, (c) complexity (standalone fields vs nested blocks)
**Then** produce `docs/release-definition-roadmap.md` containing:
- Ordered list of implementation work items (one per logical gap cluster)
- Estimated iteration budget per item (calibrated against prior WI-completion-by-domain data)
- Explicit `depends_on` ordering where schema additions gate test additions
- Clear "out of scope" section: read-only/computed values, imperative runtime operations (CreateRelease, UpdateApproval, etc.)

### Not in scope

- Implementing any schema changes (that's a follow-on initiative)
- Modifying existing code
- Running acceptance tests live — this is a pure documentation/analysis initiative
- Imperative/runtime operations (CreateRelease, Approvals, ManualInterventions, Deployments) — documented as out-of-scope per operator's brief

## Decision log

**In the context of** needing to understand the full release_definition gap before implementation, **facing** the risk of piecemeal discovery during dev-loops, **we chose** a dedicated audit initiative **to achieve** a single source of truth for remaining work, **accepting** the upfront cost of ~8 iterations for analysis before code.
```

### INIT-2026-06-08-release-definition-environment-config-surface — drawer

```markdown
## Summary

Implement the high-priority missing configuration fields on `ReleaseDefinitionEnvironment` identified by the audit. These are the writable configuration surfaces that ADO 7.2 exposes but the current schema does not map.

## Acceptance criteria

### AC-1: Environment triggers block

**Given** the ADO model field `ReleaseDefinitionEnvironment.EnvironmentTriggers *[]EnvironmentTrigger`
**When** the user specifies an `environment_trigger` block inside an `environment`
**Then**:
- The schema accepts `environment_trigger` with `definition_environment_id`, `trigger_type`, `trigger_content`
- `expandEnvironment` correctly maps to the SDK struct
- `flattenEnvironment` correctly reads it back
- Unit test `TestReleaseDefinition_EnvironmentTriggers_RoundTrip` passes

### AC-2: Schedules block

**Given** the ADO model field `ReleaseDefinitionEnvironment.Schedules *[]ReleaseSchedule`
**When** the user specifies a `schedule` block inside an `environment`
**Then**:
- The schema accepts `schedule` with `days_to_release`, `start_hours`, `start_minutes`, `time_zone_id`, `job_id`
- Expand/flatten round-trip preserves values
- Unit test `TestReleaseDefinition_EnvironmentSchedules_RoundTrip` passes

### AC-3: Process parameters block

**Given** the ADO model field `ReleaseDefinitionEnvironment.ProcessParameters *distributedtaskcommon.ProcessParameters`
**When** the user specifies `process_parameters` inside an `environment`
**Then**:
- The schema accepts `process_parameters` with `inputs` list (each: `name`, `default_value`, `parameter_type`)
- Expand/flatten round-trip preserves values
- Unit test `TestReleaseDefinition_ProcessParameters_RoundTrip` passes

### AC-4: Environment properties map

**Given** the ADO model field `ReleaseDefinitionEnvironment.Properties interface{}`
**When** the user specifies `properties` as a `map[string]string` inside an `environment`
**Then**:
- The schema accepts `properties` as `TypeMap` with `TypeString` elements
- Expand/flatten handles the `interface{}` → map conversion
- Unit test `TestReleaseDefinition_EnvironmentProperties_RoundTrip` passes

### AC-5: Live acceptance test — environment config surface

**Given** a new `TestAccReleaseDefinition_environmentConfig` test case
**When** `TF_ACC=1` is set and the test runs against live ADO
**Then**:
- The test creates a release definition with `environment_trigger`, `schedule`, and `properties` configured
- `PlanOnly: true` step with `ExpectNonEmptyPlan: false` confirms idempotency
- Test cleans up (auto-destroy)

### Not in scope

- Read-only/computed environment fields (`badgeUrl`, `currentRelease`, `deployStep`)
- Demands (already mapped at deploy_phase level)
- RunOptions (deprecated per ADO docs)
- Gate steps (covered by existing `pre_deployment_gates`/`post_deployment_gates`)

## Decision log

**In the context of** the operator's request for configuration-surface parity, **facing** multiple unmapped environment fields, **we chose** to bundle environment-level config fields into one initiative **to achieve** a coherent release of environment configuration, **accepting** a larger iteration budget (~20) for the combined scope.
```

### INIT-2026-06-08-release-definition-artifact-trigger-enhancements — drawer

```markdown
## Summary

Enhance the `artifact` and `triggers` blocks to support the full ADO 7.2 artifact trigger configuration surface: tag filters, source branch defaults, and artifact filter options.

## Acceptance criteria

### AC-1: Artifact tag filter support

**Given** the ADO model `ArtifactFilter.TagFilter *TagFilter` and `ArtifactFilter.Tags *[]string`
**When** the user specifies `tag_filter` inside a `cd_artifact_trigger`
**Then**:
- The schema accepts `tag_filter` block with `pattern` and `tags` list
- Expand/flatten round-trip preserves values
- Unit test `TestReleaseDefinition_ArtifactTagFilter_RoundTrip` passes

### AC-2: Source branch default flag

**Given** the ADO model `ArtifactFilter.UseBuildDefinitionBranch *bool`
**When** the user specifies `use_build_definition_branch = true` inside a trigger
**Then**:
- The schema accepts the boolean
- The trigger correctly sets the flag
- Unit test verifies round-trip

### AC-3: Create release on build tagging flag

**Given** the ADO model `ArtifactFilter.CreateReleaseOnBuildTagging *bool`
**When** the user specifies `create_release_on_build_tagging = true`
**Then**:
- The schema accepts the boolean
- Expand/flatten preserves it
- Unit test verifies

### AC-4: SourceRepoTrigger support

**Given** the ADO model `SourceRepoTrigger` with `Alias` and `BranchFilters`
**When** the user specifies a `source_repo_trigger` block inside `triggers`
**Then**:
- The schema accepts `source_repo_trigger` with `alias` and `branch_filters` list
- Expand emits the correct trigger type
- Unit test `TestReleaseDefinition_SourceRepoTrigger_RoundTrip` passes

### AC-5: Live acceptance test — trigger enhancements

**Given** a new `TestAccReleaseDefinition_triggerEnhancements` test case
**When** `TF_ACC=1` and the test runs
**Then**:
- Creates a release definition with tag filters and source repo trigger
- Idempotency step passes
- Cleanup succeeds

### Not in scope

- PullRequestTrigger (complex PR metadata, low priority per typical usage)
- ArtifactInstanceData (runtime, not definition-time)

## Decision log

**In the context of** trigger configuration being a key release definition surface, **facing** partial implementation of artifact triggers, **we chose** to complete the trigger schema in one focused initiative **to achieve** end-to-end trigger configuration, **accepting** ~12 iterations for the combined expand/flatten/test work.
```

### INIT-2026-06-08-release-definition-approval-options-gates-comple — drawer

```markdown
## Summary

Complete the approval and gates configuration surface: implement missing `ApprovalOptions` fields and enhance the `deployment_gates` block with the full `ReleaseDefinitionGatesOptions` schema.

## Acceptance criteria

### AC-1: ApprovalOptions completeness

**Given** the ADO model `ApprovalOptions` fields:
- `AutoTriggeredAndPreviousEnvironmentApprovedCanBeSkipped`
- `EnforceIdentityRevalidation`
- `ExecutionOrder` (beforeGates / afterSuccessfulGates / afterGatesAlways)
- `ReleaseCreatorCanBeApprover`
- `RequiredApproverCount`
- `TimeoutInMinutes`

**When** the user specifies an `approval_options` block inside `pre_deploy_approval` or `post_deploy_approval`
**Then**:
- All fields are mapped in the schema
- Expand/flatten preserves them
- Unit tests verify each field round-trips

### AC-2: ReleaseDefinitionGatesOptions fields

**Given** the ADO model `ReleaseDefinitionGatesOptions`:
- `IsEnabled`
- `MinimumSuccessDuration`
- `SamplingInterval`
- `StabilizationTime`
- `Timeout`

**When** the user specifies these inside `pre_deployment_gates` or `post_deployment_gates`
**Then**:
- The `gates_options` sub-block exposes all five fields
- Values round-trip correctly
- Unit test `TestReleaseDefinition_GatesOptions_RoundTrip` passes

### AC-3: Gate task definitions

**Given** the ADO model `ReleaseDefinitionGate.Tasks *[]WorkflowTask`
**When** the user specifies `gate` blocks inside deployment gates
**Then**:
- Each gate accepts `name`, `inputs`, `enabled`, `timeout_in_minutes`
- Expand correctly emits WorkflowTask structs
- Unit test verifies

### AC-4: Live acceptance test — approvals and gates

**Given** a new `TestAccReleaseDefinition_approvalsAndGates` test
**When** `TF_ACC=1` and the test runs
**Then**:
- Creates a release definition with non-default approval options and a gate task
- Idempotency step passes
- Cleanup succeeds

### Not in scope

- Runtime approval operations (UpdateReleaseApproval) — imperative
- Runtime gate updates (UpdateGates) — imperative

## Decision log

**In the context of** approvals and gates being critical for production release pipelines, **facing** partial implementation of these blocks, **we chose** to complete them in one initiative **to achieve** a fully-configurable approval/gate surface, **accepting** ~15 iterations for the combined schema + test work.
```

### INIT-2026-06-08-release-data-sources-completion — drawer

```markdown
## Summary

Implement the remaining read-only data sources for release definitions identified by the audit: definition revision lookup and definition history (audit trail).

## Acceptance criteria

### AC-1: data.betterado_release_definition_revision

**Given** the SDK method `GetDefinitionRevision(project, definitionId, revision)` returning `io.ReadCloser` (JSON payload)
**When** the user specifies `data.betterado_release_definition_revision` with `project_id`, `release_definition_id`, `revision`
**Then**:
- The data source calls `GetDefinitionRevision`
- Returns the raw JSON as a `json_content` attribute (string)
- Unit test with gomock verifies the SDK call path
- Acceptance test confirms live lookup returns valid JSON

### AC-2: data.betterado_release_definition_history

**Given** the SDK method `GetReleaseDefinitionHistory(project, definitionId)` returning `*[]ReleaseDefinitionRevision`
**When** the user specifies `data.betterado_release_definition_history` with `project_id`, `release_definition_id`
**Then**:
- The data source returns a list of `revision` objects (each: `revision`, `changed_by`, `changed_date`, `change_type`, `comment`)
- Unit test verifies flatten logic
- Acceptance test confirms live listing

### AC-3: Provider registration and docs

**Given** the new data sources
**When** the provider initialises
**Then**:
- Both data sources are registered in `provider.go` DataSourcesMap
- `provider_test.go` count assertion updated
- Docs pages added under `docs/data-sources/`

### Not in scope

- Implementing write operations on revision history (immutable by design)
- ReleaseDefinitionRevision diffing (out of scope — consumer concern)

## Decision log

**In the context of** the operator's request to include data sources in scope, **facing** two SDK read methods not yet surfaced, **we chose** to implement them in one focused initiative **to achieve** complete read surface for release definitions, **accepting** ~10 iterations for the two data sources + tests.
```

### INIT-2026-06-08-release-acceptance-test-fixes — drawer

```markdown
## Summary

Fix the known stale acceptance tests (missing `retention_policy` + `pre_deploy_approval` per ADO REST 7.1 requirements) and add comprehensive test coverage for all schema fields implemented in the prior initiatives.

## Acceptance criteria

### AC-1: Fix TestAccReleaseDefinition_basic

**Given** the known failure: ADO REST 7.1+ requires stage-level `retention_policy` and `pre_deploy_approval` with a valid approver
**When** the HCL fixture is updated with:
- `retention_policy { days_to_keep = 30, releases_to_keep = 3 }`
- `pre_deploy_approval { approver { id = var.approver_id } }`
**Then**:
- `TF_ACC=1` test passes
- Idempotency step (`ExpectNonEmptyPlan: false`) passes

### AC-2: Fix TestAccReleaseDefinition_complete

**Given** the existing `_complete` test may be missing new fields
**When** the HCL fixture is extended to exercise environment triggers, schedules, approval options, gates options
**Then**:
- Test passes live
- Covers the fields added in prior initiatives

### AC-3: TestAccReleaseDefinition_update

**Given** the need to verify update path
**When** a new `_update` test is added that:
- Creates a minimal definition
- Applies a second config with changed fields (name, description, new environment)
- Verifies update-in-place (not ForceNew)
**Then**:
- Test passes live
- Revision increments by 1

### AC-4: TestAccReleaseDefinition_import

**Given** the importer is wired (`tfhelper.ImportProjectQualifiedResource`)
**When** a new `_import` test is added
**Then**:
- Creates a definition
- Imports it by `project_id/definition_id`
- State matches

### AC-5: Provider-wide acceptance test green

**Given** all release acceptance tests fixed
**When** `TF_ACC=1 go test -run TestAcc ./azuredevops/internal/acceptancetests/...` runs
**Then**:
- All release-related tests pass
- No regressions in other resource tests

### Not in scope

- Adding acceptance tests for resources outside the release service package
- Performance benchmarking

## Decision log

**In the context of** known stale tests blocking confidence in the release resource, **facing** the need to validate all new schema fields live, **we chose** to fix tests after all schema initiatives merge **to achieve** a single comprehensive test pass, **accepting** the dependency on prior implementation initiatives.
```

## Aggregate footprint (informational)

_This block surfaces the **informational** footprint of the proposed initiatives — how many cycles + dollars they would consume if every one were queued today. It is informational only; forge does not enforce a budget or block at any number._

- Initiatives proposed: **6**
- Total iteration budget: **77**

---

_Generated by the architect runner on 2026-06-08T10:58:03.512Z. Reviewed + approved on the `/architect` screen in the forge UI._
