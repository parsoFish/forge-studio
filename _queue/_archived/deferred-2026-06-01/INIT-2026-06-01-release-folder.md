---
initiative_id: INIT-2026-06-01-release-folder
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-06-01T13:06:24.332Z'
iteration_budget: 3
cost_budget_usd: 2.5
phase: pending
origin: architect
worktree_path: /home/parso/forge/_worktrees/INIT-2026-06-01-release-folder
previous_failure_modes:
  - requeued-from-failed-2026-06-01
  - requeued-from-failed-2026-06-01
  - requeued-from-failed-2026-06-01
features:
  - feature_id: FEAT-1
    title: 'Implement release_folder schema, CRUD, and 5 canonical unit tests'
    depends_on: []
---

## Summary

Add `betterado_release_folder` resource to organize release definitions into folders, mirroring the `betterado_build_folder` pattern exactly. Path is Required input, name is Computed (clone build_folder schema).

## Background

The Release API (`vsrm.dev.azure.com`) supports folders for organizing release definitions:
- `POST /release/folders` — CreateFolder
- `GET /release/folders` — GetFolders
- `PATCH /release/folders` — UpdateFolder (rename)
- `DELETE /release/folders` — DeleteFolder

The mock client already exists in `azdosdkmocks/release_sdk_mock.go` with `CreateFolder`, `GetFolders`, `UpdateFolder`, `DeleteFolder` methods.

## Scope

**In scope:**
- Schema (exact build_folder clone): `path` (Required, ForceNew — full path like `\\Parent\\Child`), `project_id` (Required, ForceNew), `name` (Computed — last segment of path returned by API)
- CRUD operations using `clients.ReleaseClient.{Create,Get,Update,Delete}Folder`
- Import support via `tfhelper.ImportProjectQualifiedResource()` — import ID format `{projectId}/{path}`
- Register in `azuredevops/provider.go` as `betterado_release_folder`
- 5 canonical unit tests in `resource_release_folder_test.go`
- Documentation in `docs/resources/release_folder.md`
- Runnable example in `examples/release_folder/main.tf`

**Out of scope:**
- Acceptance tests (require live ADO)
- Nested folder creation in one resource
- Moving release definitions between folders

## Acceptance Criteria

### AC1: Resource is registered and builds
- **Given** the new resource file and provider registration
- **When** running `go build -mod=vendor ./...`
- **Then** the build succeeds with the resource registered as `betterado_release_folder`

### AC2: Schema matches build_folder pattern
- **Given** the resource schema
- **When** examining `ResourceReleaseFolder().Schema`
- **Then** it contains: `path` (Required, string, ForceNew), `project_id` (Required, UUID, ForceNew), `name` (Computed, string)
- **And** import ID format is `{projectId}/{path}` parsed by `tfhelper.ImportProjectQualifiedResource()`

### AC3: Unit tests pass (5 canonical tests)
- **Given** the unit test file with build tag `//go:build (all || resource_release_folder) && !exclude_resource_release_folder`
- **When** running `go test -mod=vendor -tags all -count=1 -v -run ^TestReleaseFolder ./azuredevops/internal/service/release/`
- **Then** all 5 canonical tests pass:
  - `TestReleaseFolder_ExpandFlatten_Roundtrip`
  - `TestReleaseFolder_Create_DoesNotSwallowError`
  - `TestReleaseFolder_Read_ClearsIdOn404`
  - `TestReleaseFolder_Update_CallsSDKWithArgs`
  - `TestReleaseFolder_Delete_SurfacesAPIError`

### AC4: Documentation exists
- **Given** the docs directory
- **When** checking `docs/resources/release_folder.md`
- **Then** it exists with Basic example, Argument Reference, Attribute Reference, and Import section

## Quality Gate

```bash
go build -mod=vendor ./... && go test -mod=vendor -tags all -count=1 -v -run ^TestReleaseFolder ./azuredevops/internal/service/release/
```

## Hard Constraints

- Tests must be creds-free (gomock only, no TF_ACC)
- Must not modify `azdosdkmocks/release_sdk_mock.go` (generated file)
- Inline fixtures preferred; `testdata/` only if >20 lines
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
