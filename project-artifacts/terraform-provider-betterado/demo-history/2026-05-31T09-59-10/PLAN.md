<!-- verdict: approve | revise | reject -->

# Architect plan — 2026-05-31T09-59-10

- Project: `terraform-provider-betterado`
- Repo: `/home/parso/forge/projects/terraform-provider-betterado`
- Initiative type: `implementation`

> **Operator review.** This plan is presented on the `/architect/2026-05-31T09-59-10` screen in the forge UI. Read each section there, resolve the council's design decisions, and click **approve**, **revise**, or **reject** — the runner finalizes your verdict, promoting the manifests to the queue only on approve.

## Operator brief + interview

Add a comprehensive offline gomock unit-test substrate for betterado_release_definition, mirroring the task_group pattern while covering release_definition's unique complexity (revision retry, secret variables, deep nesting, JSON marshaling). 11 tests total: 5 baseline CRUD pattern tests + 6 release_definition-specific characterization tests. Strictly offline — no live ADO / TF_ACC. Quality gate: go test -tags all -run TestReleaseDefinition ./azuredevops/internal/service/release/...

### Interview

_No interview rounds — operator drafted directly._

## Brain context

_No brain entries consulted (brain-gap event emitted)._

## Council transcript

Total cost: `$0.0000`

## Proposed initiatives

| ID | Title | Features | Iteration budget | Depends on |
|---|---|---|---|---|
| `INIT-2026-05-31-release-definition-unit-tests` | WI-1: Scaffold test file + fixtures + baseline CRUD pattern (5 tests) | 2 | 18 | — |

### INIT-2026-05-31-release-definition-unit-tests — drawer

```markdown
## Overview

Create an offline gomock unit-test substrate for `betterado_release_definition` (`azuredevops/internal/service/release/resource_release_definition.go`), mirroring the pattern established by `betterado_task_group` (`resource_task_group_test.go`). Characterization tests ONLY — no behaviour change to the resource implementation.

## Constraints

- **Strictly offline**: No live ADO calls, no `TF_ACC`, no credentials required.
- **Imports**: `go.uber.org/mock/gomock`, `azdosdkmocks.MockReleaseClient`, `testify/require`.
- **Package**: `release` (same package as the resource).
- **Build tags**: `//go:build (all || resource_release_definition) && !exclude_resource_release_definition`
- **File**: `azuredevops/internal/service/release/resource_release_definition_test.go`

## Quality gate (per-WI, creds-free)

```bash
go test -tags all -run TestReleaseDefinition ./azuredevops/internal/service/release/...
```

Must fail on a clean tree before the tests exist; must pass after implementation.

---

## WI-1: Scaffold test file + fixtures + baseline CRUD pattern (5 tests)

### Scope

Create the test file with package-level fixtures (project UUID, definition ID, a representative `releaseapi.ReleaseDefinition` with one environment, one deploy phase, one workflow task) and the 5 baseline CRUD tests:

1. **TestReleaseDefinition_ExpandFlatten_Roundtrip** — `flattenReleaseDefinition` followed by `expandReleaseDefinition` preserves key fields.
2. **TestReleaseDefinition_Create_DoesNotSwallowError** — error from `CreateReleaseDefinition` surfaces as non-empty Diagnostics.
3. **TestReleaseDefinition_Read_ClearsIdOn404** — 404 `WrappedError` from `GetReleaseDefinition` clears resource ID, returns no diagnostics.
4. **TestReleaseDefinition_Update_CallsSDKWithArgs** — `UpdateReleaseDefinition` called once, then `GetReleaseDefinition` for re-read.
5. **TestReleaseDefinition_Delete_SurfacesAPIError** — error from `DeleteReleaseDefinition` surfaces as non-empty Diagnostics.

### Acceptance criteria

- **Given** a clean tree (no existing `resource_release_definition_test.go`)
- **When** the scaffold file is added with fixtures and 5 baseline tests
- **Then** `go test -tags all -run TestReleaseDefinition ./azuredevops/internal/service/release/...` passes (5 tests).

---

## WI-2: release_definition-specific characterization tests (6 tests)

### Scope

Add 6 tests that exercise release_definition's unique complexity beyond the task_group pattern:

6. **TestReleaseDefinition_Update_RevisionRetryOnConflict** — simulate the API returning "old copy of the release pipeline" error; verify the retry path re-reads and retries `UpdateReleaseDefinition`.
7. **TestReleaseDefinition_SecretVariables_PreserveOnFlatten** — secret variables return `null` from API; verify `flattenVariables` preserves the value from Terraform state.
8. **TestReleaseDefinition_DeepNestedEnvironment_ExpandFlatten** — fixture with environment → deploy_phase → deployment_input → demands + workflow_task → inputs; verify round-trip fidelity.
9. **TestReleaseDefinition_Artifacts_DefinitionReferenceFiltering** — API adds computed keys (e.g. `artifactSourceDefinitionUrl`); verify `flattenArtifacts` filters them out (only user-configured keys remain).
10. **TestReleaseDefinition_ApprovalOptions_RoundTrip** — environment with `pre_deploy_approval` + `post_deploy_approval` + `approval_options`; verify expand/flatten round-trip.
11. **TestReleaseDefinition_DeployPhases_JSONMarshalUnmarshal** — exercise `flattenDeployPhases` which unmarshals from `interface{}` via JSON; verify workflow tasks survive the round-trip.

### Acceptance criteria

- **Given** WI-1 is merged (5 tests exist)
- **When** WI-2 adds the 6 additional tests
- **Then** `go test -tags all -run TestReleaseDefinition ./azuredevops/internal/service/release/...` passes (11 tests).

---

## Non-goals

- No live acceptance tests (`TestAccReleaseDefinition_*`).
- No changes to `resource_release_definition.go` (characterization only).
- No coverage of the `betterado_release_folder` resource.

## Hard constraints

- Tests must be deterministic (no external dependencies, no flaky timing).
- Tests must use the existing `azdosdkmocks.MockReleaseClient` — no new mock generation required.
- Build tags must allow selective inclusion/exclusion.
```

## Aggregate footprint (informational)

_This block surfaces the **informational** footprint of the proposed initiatives — how many cycles + dollars they would consume if every one were queued today. It is informational only; forge does not enforce a budget or block at any number._

- Initiatives proposed: **1**
- Total iteration budget: **18**

---

_Generated by the architect runner on 2026-05-31T10:14:19.177Z. Reviewed + approved on the `/architect` screen in the forge UI._
