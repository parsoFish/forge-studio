---
initiative_id: INIT-2026-06-01-release-environment-template
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-06-01T13:06:24.332Z'
iteration_budget: 4
cost_budget_usd: 3
phase: pending
origin: architect
depends_on_initiatives:
  - INIT-2026-06-01-ci-green
features:
  - feature_id: FEAT-1
    title: >-
      Implement environment_template schema, CRD (no Update), and 4 canonical
      unit tests
    depends_on: []
---

## Summary

Add `betterado_release_environment_template` resource to create reusable environment templates that can be referenced when creating release definitions. Templates are **immutable** after creation — no Update operation.

## Background

The Release API supports environment templates:
- `POST /release/definitions/environmenttemplates` — Create
- `GET /release/definitions/environmenttemplates` — List/Get
- `DELETE /release/definitions/environmenttemplates/{templateId}` — Delete

**Note:** Templates are immutable after creation — there is no Update operation. Any schema change requires destroy/recreate (ForceNew on all mutable fields).

## Scope

**In scope:**
- Schema: `name` (Required, ForceNew), `project_id` (Required, ForceNew), `description` (Optional, ForceNew), `environment` block (Required, ForceNew — reuses release_definition environment schema subset)
- CRD operations (Create, Read, Delete — no UpdateContext)
- All non-Computed fields marked `ForceNew: true`
- Import support via `tfhelper.ImportProjectQualifiedResourceUUID()` — import ID format `{projectId}/{templateId}`
- Register in `azuredevops/provider.go` as `betterado_release_environment_template`
- 4 unit tests (no update test — immutable): roundtrip, create-error, read-404-clears-id, delete-error
- Documentation with **prominent immutability callout** and `lifecycle { prevent_destroy = true }` example
- Runnable example in `examples/release_environment_template/main.tf`

**Out of scope:**
- Update operation (templates are immutable by ADO API design)
- Acceptance tests
- Full environment block complexity (keep schema minimal for templates)

## Acceptance Criteria

### AC1: Resource is registered and builds
- **Given** the new resource file and provider registration
- **When** running `go build -mod=vendor ./...`
- **Then** the build succeeds with the resource registered as `betterado_release_environment_template`

### AC2: Schema marks mutable fields as ForceNew
- **Given** the resource schema
- **When** examining all non-Computed fields
- **Then** they are marked `ForceNew: true` (no in-place updates)

### AC3: No Update function is registered
- **Given** the resource definition
- **When** examining `&schema.Resource{}`
- **Then** `UpdateContext` is nil or absent

### AC4: Unit tests pass (4 tests — no update)
- **Given** the unit test file with build tag `//go:build (all || resource_release_environment_template) && !exclude_resource_release_environment_template`
- **When** running `go test -mod=vendor -tags all -count=1 -v -run ^TestReleaseEnvironmentTemplate ./azuredevops/internal/service/release/`
- **Then** all 4 tests pass:
  - `TestReleaseEnvironmentTemplate_ExpandFlatten_Roundtrip`
  - `TestReleaseEnvironmentTemplate_Create_DoesNotSwallowError`
  - `TestReleaseEnvironmentTemplate_Read_ClearsIdOn404`
  - `TestReleaseEnvironmentTemplate_Delete_SurfacesAPIError`

### AC5: Documentation includes immutability callout
- **Given** the docs file `docs/resources/release_environment_template.md`
- **When** examining the content
- **Then** it includes a prominent callout explaining that environment templates are immutable — any change to name, description, or environment triggers destroy/recreate (ADO API limitation)
- **And** includes example with `lifecycle { prevent_destroy = true }` for safer updates

## Quality Gate

```bash
go build -mod=vendor ./... && go test -mod=vendor -tags all -count=1 -v -run ^TestReleaseEnvironmentTemplate ./azuredevops/internal/service/release/
```

## Hard Constraints

- No UpdateContext — immutable resource
- Environment block reuses expand/flatten from release_definition where possible
- Tests must be creds-free (gomock only)
- Use `ctrl := gomock.NewController(t)` + `defer ctrl.Finish()` cleanup pattern


## Resolved design decisions (operator)

- Should the CI fix initiative ship first, or can resource development proceed in parallel?: **CI must be fixed first (sequential blocker)**
- How should we handle Initiative 3 (release_environment_template) given the missing SDK support?: **Defer until SDK support confirmed (Recommended)**
- Should the release_definition data sources (Initiative 4) ship in this batch, or defer until resource API coverage is complete?: **Ship data sources now (as drafted)**
- Are these 4 initiatives the right coherent batch, or should we repackage?: **Ship as drafted (4 initiatives)**
- The release_folder and release_environment_template initiatives state 'Must not modify azdosdkmocks/release_sdk_mock.go (generated file)'. However, if the API requires additional mock methods (e.g., GetEnvironmentTemplates, CreateEnvironmentTemplate), how should we handle this?: **Regenerate mocks as needed (Recommended)**
- The release_environment_template resource needs an environment block. Should we reuse the full release_definition environment schema (20+ fields including deploy_phases, retention_policy, approvals), or create a minimal template-specific subset?: **Reuse full release_definition environment schema (Recommended)**
- The plural data source data.betterado_release_definitions returns a list of definitions. Should we flatten full nested structures (environments, artifacts, variables) or keep items lightweight?: **Lightweight items (id, name, path, revision only) (Recommended)**
- The CI fix initiative modifies 100+ files with auto-formatters. Should we require explicit rollback verification before considering the initiative complete?: **Skip rollback verification (Recommended)**
- How should the singular release_definition data source handle ambiguous name searches (multiple definitions with same name in different folders)?: **Allow name + path combination (Recommended)**
- How much of the release_definition environment schema should environment templates support?: **Full schema parity (Recommended)**
- Should we treat SA1019 deprecation warnings now or defer them?: **Fix SA1019 now with suppression**
- How should we structure the new release resource directories?: **Flat structure in service/release (Recommended)**
- Should we add a pre-commit hook to prevent future CI failures?: **No additional tooling**

## Resolved design decisions

- Should the CI fix initiative ship first, or can resource development proceed in parallel?: **CI must be fixed first (sequential blocker)**
- How should we handle Initiative 3 (release_environment_template) given the missing SDK support?: **Defer until SDK support confirmed (Recommended)**
- Should the release_definition data sources (Initiative 4) ship in this batch, or defer until resource API coverage is complete?: **Ship data sources now (as drafted)**
- Are these 4 initiatives the right coherent batch, or should we repackage?: **Ship as drafted (4 initiatives)**
- The release_folder and release_environment_template initiatives state 'Must not modify azdosdkmocks/release_sdk_mock.go (generated file)'. However, if the API requires additional mock methods (e.g., GetEnvironmentTemplates, CreateEnvironmentTemplate), how should we handle this?: **Regenerate mocks as needed (Recommended)**
- The release_environment_template resource needs an environment block. Should we reuse the full release_definition environment schema (20+ fields including deploy_phases, retention_policy, approvals), or create a minimal template-specific subset?: **Reuse full release_definition environment schema (Recommended)**
- The plural data source data.betterado_release_definitions returns a list of definitions. Should we flatten full nested structures (environments, artifacts, variables) or keep items lightweight?: **Lightweight items (id, name, path, revision only) (Recommended)**
- The CI fix initiative modifies 100+ files with auto-formatters. Should we require explicit rollback verification before considering the initiative complete?: **Skip rollback verification (Recommended)**
- How should the singular release_definition data source handle ambiguous name searches (multiple definitions with same name in different folders)?: **Allow name + path combination (Recommended)**
- How much of the release_definition environment schema should environment templates support?: **Full schema parity (Recommended)**
- Should we treat SA1019 deprecation warnings now or defer them?: **Fix SA1019 now with suppression**
- How should we structure the new release resource directories?: **Flat structure in service/release (Recommended)**
- Should we add a pre-commit hook to prevent future CI failures?: **No additional tooling**
