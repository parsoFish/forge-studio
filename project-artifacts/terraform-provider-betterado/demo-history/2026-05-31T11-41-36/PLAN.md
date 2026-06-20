<!-- verdict: approve | revise | reject -->

# Architect plan — 2026-05-31T11-41-36

- Project: `terraform-provider-betterado`
- Repo: `/home/parso/forge/projects/terraform-provider-betterado`
- Initiative type: `implementation`

> **Operator review.** This plan is presented on the `/architect/2026-05-31T11-41-36` screen in the forge UI. Read each section there, resolve the council's design decisions, and click **approve**, **revise**, or **reject** — the runner finalizes your verdict, promoting the manifests to the queue only on approve.

## Operator brief + interview

Fix CI to green, then complete the Release API surface for terraform-provider-betterado — enabling full declarative management of Azure DevOps release pipelines (folders, environment templates, and schema parity with ADO 7.2) while maintaining a solid test foundation.

### Interview

| # | Question | Operator answer |
|---|---|---|
| 1 | How should we handle the CI failures — fix them as a prerequisite initiative before new Release features, or bundle fixes into the first Release initiative? | CI first (Recommended) |
| 2 | Which Release API components should we include as initiatives? | Full Release API |
| 3 | The lint warnings include ~10 SA1019 deprecation warnings for deprecated SDK fields (EmailRecipients, etc). How should we handle these? | Fix now |
| 4 | The ~10 SA1019 deprecation warnings are in upstream (inherited) code, not the fork's net-new release/taskagent code. Fixing them would touch upstream files and break merge-cleanliness. How should we proceed? | Fix anyway |

## Brain context

_No brain entries consulted (brain-gap event emitted)._

## Council transcript

Total cost: `$0.0000`

## Proposed initiatives

| ID | Title | Features | Iteration budget | Depends on |
|---|---|---|---|---|
| `INIT-2026-05-31-ci-green` | F1: Fix gofmt and terrafmt formatting violations | 3 | 4 | — |
| `INIT-2026-05-31-release-folder` | F1: Schema + expand/flatten + provider registration for release_folder | 3 | 6 | — |
| `INIT-2026-05-31-release-environment-template` | F1: Schema + expand/flatten + provider registration for environment_template | 3 | 5 | — |
| `INIT-2026-05-31-release-definition-schema-parity` | F1: Single golden-path characterization test for environment/deployPhase/workflowTask expand/flatten | 5 | 8 | — |

### INIT-2026-05-31-ci-green — drawer

```markdown
## Overview

Bring CI to green by fixing all lint, format, and deprecation warnings. This initiative deliberately diverges from upstream `microsoft/terraform-provider-azuredevops` on `resource_release_definition.go` to eliminate SA1019 warnings for deprecated SDK fields.

## Background

The Azure DevOps Go SDK deprecated 5 fields on `EnvironmentOptions`:
- `EmailNotificationType` → Use Notifications instead
- `EmailRecipients` → Use Notifications instead
- `EnableAccessToken` → Use `DeploymentInput.EnableAccessToken`
- `SkipArtifactsDownload` → Use `DeploymentInput.SkipArtifactsDownload`
- `TimeoutInMinutes` → Use `DeploymentInput.TimeoutInMinutes`

## Features

### F1: Fix gofmt and terrafmt formatting violations

**Scope:** Run `gofmt -w` and `terrafmt fmt` on all files flagged by CI.

**Acceptance Criteria:**
- **Given** the codebase after F1
- **When** `gofmt -l ./azuredevops/...` is run
- **Then** no files are listed (all properly formatted)
- **And** `terrafmt diff ./azuredevops/...` returns no differences

**Files:** ~3 files (per CI output)

### F2: Fix golangci-lint errcheck and unused-function errors

**Scope:** Address errcheck violations (unchecked error returns) and remove or use any dead code.

**Acceptance Criteria:**
- **Given** the codebase after F2
- **When** `golangci-lint run ./azuredevops/...` is run
- **Then** no errcheck or unused violations are reported

**Files:** Estimated 2-4 files

### F3: Migrate SA1019 deprecated EnvironmentOptions fields with state migration

**Scope:** Replace deprecated `EnvironmentOptions` fields with their modern `DeploymentInput` equivalents. This is a **breaking schema change** that mirrors the new SDK structure. Implement a `StateUpgrader` to migrate existing state.

**Migration mapping:**
| Deprecated field | New location |
|---|---|
| `environment_options.enable_access_token` | `deploy_phase.deployment_input.enable_access_token` |
| `environment_options.skip_artifacts_download` | `deploy_phase.deployment_input.skip_artifacts_download` |
| `environment_options.timeout_in_minutes` | `deploy_phase.deployment_input.timeout_in_minutes` |
| `environment_options.email_notification_type` | Remove (use ADO Notifications service) |
| `environment_options.email_recipients` | Remove (use ADO Notifications service) |

**Acceptance Criteria:**
- **Given** the codebase after F3
- **When** `golangci-lint run ./azuredevops/...` is run
- **Then** no SA1019 deprecation warnings are reported
- **And Given** existing Terraform state with `environment_options.enable_access_token = true`
- **When** `terraform plan` is run after provider upgrade
- **Then** the state is automatically migrated to `deploy_phase.deployment_input.enable_access_token = true` with no diff

**Files:**
- `azuredevops/internal/service/release/resource_release_definition.go` (schema, expand, flatten, state upgrader)
- `azuredevops/internal/service/release/resource_release_definition_test.go` (update fixtures)

**Non-goals:**
- Preserving the deprecated email notification fields (they're being removed, not migrated)

## Quality Gate

```bash
go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/...
```

## Definition of Done

- All CI checks pass (gofmt, terrafmt, golangci-lint, unit tests)
- State migration tested with a roundtrip test
- No SA1019 warnings in `golangci-lint` output
```

### INIT-2026-05-31-release-folder — drawer

```markdown
## Overview

Add a new `betterado_release_folder` resource for managing release definition folders in Azure DevOps. Folders organize release definitions hierarchically (like `\Production\Web`, `\Staging`).

## Background

The Azure DevOps Release API supports folder operations:
- `POST /release/folders/{path}` — Create folder
- `GET /release/folders/{path}` — Get folder
- `PUT /release/folders/{path}` — Update folder
- `DELETE /release/folders/{path}` — Delete folder

Folders are simple resources with `path`, `description`, and `createdBy`/`createdOn` metadata.

## Features

### F1: Schema + expand/flatten + provider registration

**Scope:** Define the Terraform schema for `betterado_release_folder`, implement expand/flatten functions, and register the resource in `provider.go`.

**Schema:**
```hcl
resource "betterado_release_folder" "example" {
  project_id  = azuredevops_project.example.id
  path        = "\\Production\\Web"
  description = "Production web app releases"
}
```

**Acceptance Criteria:**
- **Given** the schema definition
- **When** a user declares a `betterado_release_folder` resource
- **Then** Terraform validates the configuration without errors
- **And** the resource appears in `terraform providers schema`

**Files:**
- `azuredevops/internal/service/release/resource_release_folder.go` (new)
- `azuredevops/provider.go` (register)

### F2: CRUD implementation + 5-test gomock unit substrate

**Scope:** Implement Create, Read, Update, Delete operations. Add the canonical 5 gomock unit tests.

**Unit tests:**
1. `TestReleaseFolder_ExpandFlatten_Roundtrip` — expand → flatten preserves fields
2. `TestReleaseFolder_Create_Success` — mock CreateFolder returns folder
3. `TestReleaseFolder_Create_Error` — mock CreateFolder returns error
4. `TestReleaseFolder_Read_NotFound` — mock GetFolder returns 404, resource removed from state
5. `TestReleaseFolder_Delete_Error` — mock DeleteFolder returns error

**Delete behavior (per resolved decision):** When deleting a folder that contains definitions, **fail with a helpful error** explaining the folder must be empty. Do not cascade delete.

**Acceptance Criteria:**
- **Given** a valid folder configuration
- **When** `terraform apply` is run (mocked)
- **Then** CreateReleaseDefinitionFolder is called with correct path and description
- **And Given** a folder containing release definitions
- **When** `terraform destroy` is run
- **Then** the provider returns an error: "Cannot delete folder '\\Production' because it contains release definitions. Move or delete the definitions first."

**Files:**
- `azuredevops/internal/service/release/resource_release_folder.go`
- `azuredevops/internal/service/release/resource_release_folder_test.go` (new)
- `azdosdkmocks/release_client_mock.go` (add folder methods if missing)

### F3: Acceptance tests + docs/example

**Scope:** Add TF_ACC acceptance test that creates a real folder in ADO, verifies via API, and destroys. Add resource documentation.

**Acceptance Criteria:**
- **Given** valid ADO credentials (TF_ACC=1, AZDO_* env vars)
- **When** `go test -tags all -run TestAccReleaseFolder ./azuredevops/internal/acceptancetests/` is run
- **Then** the test creates a folder, reads it back, updates description, and destroys cleanly

**Files:**
- `azuredevops/internal/acceptancetests/resource_release_folder_test.go` (new)
- `website/docs/r/release_folder.html.markdown` (minimal docs per resolved decision)

## Quality Gate

```bash
go test -tags all -count=1 -run TestReleaseFolder ./azuredevops/internal/service/release/...
```

## Hard Constraints

- Delete must fail with helpful error if folder contains definitions (no cascade)
- Path must use backslash separators (ADO convention)
- Root folder `\` cannot be created/deleted

## Definition of Done

- Resource registered and functional
- 5 unit tests passing
- Acceptance test passing (with creds)
- Minimal docs in resource reference
```

### INIT-2026-05-31-release-environment-template — drawer

```markdown
## Overview

Add a new `betterado_release_definition_environment_template` resource for managing reusable environment templates. Templates define a standard environment configuration (approvals, deployment phases, policies) that can be applied when creating new environments.

## Background

Environment templates are **immutable** in the ADO API — you can create and delete them, but not update. Any change requires replacing the template. This makes them `ForceNew` on all significant fields.

API:
- `POST /release/definitions/environmenttemplates` — Create template
- `GET /release/definitions/environmenttemplates` — List templates (by id)
- `DELETE /release/definitions/environmenttemplates/{templateId}` — Delete template

## Features

### F1: Schema + expand/flatten + provider registration

**Scope:** Define the Terraform schema. Templates contain environment configuration (approvals, phases, conditions) similar to the `environment` block in `release_definition`.

**Schema:**
```hcl
resource "betterado_release_definition_environment_template" "production" {
  project_id  = azuredevops_project.example.id
  name        = "Production Standard"
  description = "Standard production environment with approvals"
  
  rank = 1
  
  pre_deploy_approval {
    approver {
      id = data.azuredevops_user.lead.id
    }
  }
  
  deploy_phase {
    name       = "Deploy"
    rank       = 1
    phase_type = "agentBasedDeployment"
    deployment_input {
      queue_id = azuredevops_agent_queue.default.id
    }
  }
  
  retention_policy {
    days_to_keep     = 30
    releases_to_keep = 3
  }
}
```

**Acceptance Criteria:**
- **Given** the schema definition
- **When** a user declares a `betterado_release_definition_environment_template` resource
- **Then** Terraform validates the configuration
- **And** ForceNew is set on `name`, `rank`, and all nested blocks

**Files:**
- `azuredevops/internal/service/release/resource_release_definition_environment_template.go` (new)
- `azuredevops/provider.go` (register)

### F2: CRD implementation (no Update) + 5-test unit substrate

**Scope:** Implement Create, Read, Delete. Update is not supported (ForceNew triggers replacement). Add 5 gomock unit tests.

**Unit tests:**
1. `TestEnvironmentTemplate_ExpandFlatten_Roundtrip`
2. `TestEnvironmentTemplate_Create_Success`
3. `TestEnvironmentTemplate_Create_Error`
4. `TestEnvironmentTemplate_Read_NotFound`
5. `TestEnvironmentTemplate_Delete_Error`

**Acceptance Criteria:**
- **Given** a valid template configuration
- **When** `terraform apply` is run
- **Then** CreateDefinitionEnvironmentTemplate is called
- **And Given** the template name is changed
- **When** `terraform plan` is run
- **Then** plan shows destroy + create (ForceNew)

**Files:**
- `azuredevops/internal/service/release/resource_release_definition_environment_template.go`
- `azuredevops/internal/service/release/resource_release_definition_environment_template_test.go` (new)
- `azdosdkmocks/release_client_mock.go` (add template methods if missing)

### F3: Acceptance tests + docs/example

**Scope:** Add TF_ACC acceptance test. Minimal documentation.

**Acceptance Criteria:**
- **Given** valid ADO credentials
- **When** acceptance test runs
- **Then** template is created, read back successfully, and destroyed

**Files:**
- `azuredevops/internal/acceptancetests/resource_release_definition_environment_template_test.go` (new)
- `website/docs/r/release_definition_environment_template.html.markdown` (minimal)

## Quality Gate

```bash
go test -tags all -count=1 -run TestEnvironmentTemplate ./azuredevops/internal/service/release/...
```

## Hard Constraints

- No Update — templates are immutable (ForceNew on all fields)
- Must reuse approval/phase/retention schemas from release_definition where possible

## Definition of Done

- Resource registered and functional (CRD only)
- 5 unit tests passing
- Acceptance test passing
- Minimal docs
```

### INIT-2026-05-31-release-definition-schema-parity — drawer

```markdown
## Overview

Complete the `betterado_release_definition` resource to achieve full schema parity with the Azure DevOps Release Definitions 7.2 API. This includes missing fields, better error messages, and refreshed acceptance tests.

## Background

The existing `release_definition` resource (~1,490 LOC) covers the core CRUD operations but:
- Acceptance tests are **stale** — fail on current ADO (VS402982: stage retention_policy now required; VS402877: approvals now required)
- Missing some 7.2 API fields (gates, advanced approval options, properties)
- Error messages from ADO API are cryptic (VS402982, VS402877 codes need translation)

## Features

### F1: Single golden-path characterization test for deep-nested expand/flatten

**Scope:** Add one comprehensive characterization test that exercises the full expand→flatten roundtrip for a realistic release definition with environments, deploy phases, workflow tasks, approvals, and retention policies.

**Acceptance Criteria:**
- **Given** a complex `testReleaseDefinition` fixture with 2 environments, nested deploy phases, workflow tasks, approvals
- **When** `flattenReleaseDefinition` then `expandReleaseDefinition` is called
- **Then** all fields roundtrip correctly (environments, phases, tasks, approvals, policies)
- **And** the test serves as regression protection for expand/flatten refactoring

**Files:**
- `azuredevops/internal/service/release/resource_release_definition_test.go`

### F2.1: Update acceptance test fixtures (minimal)

**Scope:** Add `retention_policy` and `pre_deploy_approval` blocks to existing acceptance test fixtures so they pass against current ADO API.

**Acceptance Criteria:**
- **Given** existing acceptance tests
- **When** `TF_ACC=1 go test -run TestAccReleaseDefinition ./azuredevops/internal/acceptancetests/` runs
- **Then** tests pass without VS402982 or VS402877 errors

**Files:**
- `azuredevops/internal/acceptancetests/resource_release_definition_test.go`

### F2.2: Comprehensive acceptance test coverage for new required fields

**Scope:** Add acceptance tests that specifically exercise retention_policy and pre_deploy_approval variations.

**Acceptance Criteria:**
- **Given** a release definition with custom retention_policy (60 days, 5 releases)
- **When** terraform apply runs
- **Then** the retention policy is set correctly in ADO
- **And Given** a release definition with pre_deploy_approval with 2 approvers, serial execution order
- **When** terraform apply runs
- **Then** approvals are configured correctly

**Files:**
- `azuredevops/internal/acceptancetests/resource_release_definition_test.go`

### F3: Schema audit vs ADO 7.2 — add missing fields

**Scope:** Audit the current schema against the ADO 7.2 Release Definitions API. Add missing fields:
- `environment.gate` (pre-deployment and post-deployment gates)
- `environment.pre_deploy_approval.approval_options.auto_triggered_and_previous_environment_approved_can_be_skipped`
- `properties` (arbitrary key-value metadata)

**Acceptance Criteria:**
- **Given** a release definition with pre-deployment gates configured
- **When** terraform apply runs
- **Then** the gates appear in the ADO portal
- **And** schema matches 7.2 API spec for all audited fields

**Files:**
- `azuredevops/internal/service/release/resource_release_definition.go` (schema additions)
- `azuredevops/internal/service/release/resource_release_definition_test.go` (unit tests for new expand/flatten)

### F4: Error code translation layer

**Scope:** Add user-friendly error interpretation for common ADO API error codes.

**Error mappings:**
| Code | Raw message | Friendly message |
|------|-------------|------------------|
| VS402982 | "The value of 'retentionPolicy'..." | "Stage '{name}' requires a retention_policy block. Add `retention_policy { days_to_keep = 30 }` to the environment." |
| VS402877 | "Approvals are required..." | "Stage '{name}' requires pre_deploy_approval. Add a `pre_deploy_approval` block with at least one approver." |
| VS403000 | "Invalid path..." | "Release folder path must start with '\\' and use backslash separators." |

**Acceptance Criteria:**
- **Given** a release definition missing retention_policy
- **When** terraform apply fails with VS402982
- **Then** the error message includes the friendly explanation and fix suggestion

**Files:**
- `azuredevops/internal/service/release/errors.go` (new — error translation)
- `azuredevops/internal/service/release/resource_release_definition.go` (wrap API errors)

## Quality Gate

```bash
go test -tags all -count=1 ./azuredevops/internal/service/release/...
```

## Hard Constraints

- Acceptance tests (F2.x) require TF_ACC=1 + AZDO_* credentials — not default gate
- New schema fields must be Optional/Computed to preserve backward compatibility
- Error translation must preserve original error for debugging

## Definition of Done

- Characterization test covering expand/flatten roundtrip
- Acceptance tests passing on current ADO
- Missing 7.2 fields added with unit tests
- Error translation layer with friendly messages
```

## Aggregate footprint (informational)

_This block surfaces the **informational** footprint of the proposed initiatives — how many cycles + dollars they would consume if every one were queued today. It is informational only; forge does not enforce a budget or block at any number._

- Initiatives proposed: **4**
- Total iteration budget: **23**

---

_Generated by the architect runner on 2026-05-31T12:15:16.018Z. Reviewed + approved on the `/architect` screen in the forge UI._
