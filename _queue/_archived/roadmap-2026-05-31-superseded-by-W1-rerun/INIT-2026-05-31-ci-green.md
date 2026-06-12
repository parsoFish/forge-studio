---
initiative_id: INIT-2026-05-31-ci-green
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-31T12:15:16.014Z'
iteration_budget: 4
cost_budget_usd: 10
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: 'F1: Fix gofmt and terrafmt formatting violations'
    depends_on: []
  - feature_id: FEAT-2
    title: 'F2: Fix golangci-lint errcheck and unused-function errors'
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: >-
      F3: Migrate SA1019 deprecated EnvironmentOptions fields to DeploymentInput
      with state migration
    depends_on:
      - FEAT-2
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-31-ci-green
---

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
