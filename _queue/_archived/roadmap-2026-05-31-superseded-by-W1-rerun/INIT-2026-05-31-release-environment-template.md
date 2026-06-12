---
initiative_id: INIT-2026-05-31-release-environment-template
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-31T12:15:16.014Z'
iteration_budget: 5
cost_budget_usd: 15
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: >-
      F1: Schema + expand/flatten + provider registration for
      environment_template
    depends_on: []
  - feature_id: FEAT-2
    title: 'F2: CRD implementation (no Update - immutable) + 5-test unit substrate'
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: 'F3: Acceptance tests + docs/example'
    depends_on:
      - FEAT-2
---

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
