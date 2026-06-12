---
initiative_id: INIT-2026-05-31-release-definition-substrate
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-31T11:50:12.349Z'
iteration_budget: 6
cost_budget_usd: 18
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: Add 5-test gomock unit substrate for release_definition
    depends_on: []
  - feature_id: FEAT-2
    title: Refresh acceptance tests for current ADO API requirements
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Schema parity audit vs ADO Release Definitions 7.2 API
    depends_on:
      - FEAT-1
      - FEAT-2
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-31-release-definition-substrate
---

## Overview

Complete the `release_definition` resource substrate — the canonical 5 unit tests (gomock, creds-free), refreshed acceptance tests that pass against current ADO, and a schema parity audit against the 7.2 API spec.

## Problem Statement

The `release_definition` resource implementation exists (~1,490 LOC) but:
- **Zero unit tests** — the 2026-05-31 onboarding cycle delivered unit tests but they're on a branch with red CI
- **Stale acceptance tests** — live `apply` fails (`VS402982`: stage-level `retention_policy` now required; `VS402877`: pre/post approvals now required)
- **Schema gaps unknown** — no audit against the 7.2 spec for gates, approvalOptions, properties, tags

This initiative completes the substrate so `release_definition` is production-grade.

## Features

### F1: Add 5-test gomock unit substrate for release_definition

**Scope:** Create `azuredevops/internal/service/release/resource_release_definition_test.go` with the canonical 5-test pattern (mirrors `resource_task_group_test.go`):

1. **Expand ↔ flatten roundtrip** — verify state survives a full cycle
2. **Create API-error** — mock SDK returns error, verify Terraform sees it
3. **Read-404-clears-state** — mock 404, verify `d.SetId("")` called
4. **Update-calls-SDK-with-args** — verify expand produces correct API payload
5. **Delete API-error** — mock SDK error on delete, verify propagation

Plus characterization tests for the deeply-nested expand/flatten (as proven valuable in the 2026-05-31 cycle: `TestReleaseDefinition_DeepNestedEnvironment_ExpandFlatten` exposed the `inputs` type-switch bug).

**Acceptance Criteria:**
```gherkin
Given the release package
When I run `go test -tags all -count=1 -run ^TestReleaseDefinition ./azuredevops/internal/service/release/`
Then all 5+ unit tests pass
And at least one deep-nested characterization test exercises the environment/deployPhase/workflowTask path

Given the unit tests
When run without network access or ADO credentials
Then they complete successfully (gomock, creds-free)
```

### F2: Refresh acceptance tests for current ADO API requirements

**Scope:** Update `azuredevops/internal/acceptancetests/resource_release_definition_test.go` fixtures to satisfy current ADO validation:

- Add `retention_policy` block to each environment (required since ~7.1)
- Add `pre_deploy_approval` with a valid approver identity (required for environments)
- Use the `test-acc-*` naming pattern for auto-cleanup
- Ensure tests create/confirm/destroy cleanly

**Acceptance Criteria:**
```gherkin
Given valid ADO credentials in AZDO_PERSONAL_ACCESS_TOKEN + AZDO_ORG_SERVICE_URL
When I run `TF_ACC=1 go test -tags all -run TestAccReleaseDefinition ./azuredevops/internal/acceptancetests/`
Then all acceptance tests pass
And no orphan resources remain in the ADO org after the run

Given a release_definition with environments
When the resource is applied
Then each environment has a retention_policy
And each environment has pre_deploy_approval configured
```

### F3: Schema parity audit vs ADO Release Definitions 7.2 API

**Scope:** Audit the current Terraform schema against the [ADO REST API 7.2 Release Definitions](https://learn.microsoft.com/en-us/rest/api/azure/devops/release/definitions) spec:

- Gates (pre/post deployment)
- ApprovalOptions (extended fields)
- Properties map
- Tags
- Any new 7.2 fields not present in 7.1

Document gaps in `docs/api-reference/release-definitions.md`. Implement missing fields where additive (Optional/Computed). Flag breaking changes for future consideration.

**Acceptance Criteria:**
```gherkin
Given the 7.2 ReleaseDefinition schema
When compared to the Terraform resource schema
Then all gaps are documented in docs/api-reference/release-definitions.md
And additive fields are implemented as Optional or Computed
And the docs/example is updated if new fields are exposed
```

## Quality Gate

```bash
go test -tags all -count=1 -run ^TestReleaseDefinition ./azuredevops/internal/service/release/
```

Live gate (per-WI, not default):
```bash
TF_ACC=1 go test -tags all -run TestAccReleaseDefinition ./azuredevops/internal/acceptancetests/
```

## Project Metrics

From `.forge/project.json`:
- `quality_gate_cmd`: `go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/...`

## Non-Goals

- Building new resources (release_folder, environment_template) — separate initiatives
- Imperative runtime APIs (releases, deployments, approvals)
- Data sources — separate feature

## Hard Constraints

- All tests tagged `//go:build all` for gomock isolation
- Exact package dir in gate, no `/...` suffix (avoids false-pass)
- Schema changes must be backward-compatible (Optional/Computed only)
- No vendor/ modifications
