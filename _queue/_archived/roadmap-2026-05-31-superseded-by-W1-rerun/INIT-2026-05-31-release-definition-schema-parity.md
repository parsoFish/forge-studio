---
initiative_id: INIT-2026-05-31-release-definition-schema-parity
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-31T12:15:16.014Z'
iteration_budget: 8
cost_budget_usd: 24
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: >-
      F1: Single golden-path characterization test for
      environment/deployPhase/workflowTask expand/flatten
    depends_on: []
  - feature_id: FEAT-2
    title: >-
      F2.1: Update acceptance test fixtures with required retention_policy and
      pre_deploy_approval blocks
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: >-
      F2.2: Comprehensive acceptance test coverage for retention_policy and
      pre_deploy_approval fields
    depends_on:
      - FEAT-2
  - feature_id: FEAT-4
    title: >-
      F3: Schema audit vs ADO 7.2 — add missing gates,
      approvalOptions.autoTriggeredAndPreviousEnvironmentApprovedCanBeSkipped,
      properties
    depends_on:
      - FEAT-3
  - feature_id: FEAT-5
    title: 'F4: Error code translation layer for common ADO API errors'
    depends_on:
      - FEAT-4
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-31-release-definition-schema-parity
---

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
