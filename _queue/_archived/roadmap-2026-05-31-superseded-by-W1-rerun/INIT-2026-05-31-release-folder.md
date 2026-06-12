---
initiative_id: INIT-2026-05-31-release-folder
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-31T12:15:16.014Z'
iteration_budget: 6
cost_budget_usd: 18
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: 'F1: Schema + expand/flatten + provider registration for release_folder'
    depends_on: []
  - feature_id: FEAT-2
    title: 'F2: CRUD implementation + 5-test gomock unit substrate'
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: 'F3: Acceptance tests + docs/example'
    depends_on:
      - FEAT-2
---

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
