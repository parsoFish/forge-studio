---
initiative_id: INIT-2026-06-01-release-data-sources
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-06-01T13:06:24.332Z'
iteration_budget: 3
cost_budget_usd: 2.5
phase: pending
origin: architect
depends_on_initiatives:
  - INIT-2026-06-01-ci-green
features:
  - feature_id: FEAT-1
    title: Implement data.betterado_release_definition (single by ID or name)
    depends_on: []
  - feature_id: FEAT-2
    title: Implement data.betterado_release_definitions (list with filters)
    depends_on:
      - FEAT-1
---

## Summary

Add data sources to read existing release definitions: `data.betterado_release_definition` (single by ID or name) and `data.betterado_release_definitions` (list with optional filters). These allow Terraform configurations to reference existing release definitions without managing them.

## Background

The Release API supports reading release definitions:
- `GET /release/definitions/{definitionId}` — Get single by ID
- `GET /release/definitions` — List with query parameters (name, path, isExactNameMatch, etc.)

## Scope

**In scope:**

**data.betterado_release_definition (singular):**
- Schema: `project_id` (Required), `definition_id` (Optional, ConflictsWith name), `name` (Optional, ConflictsWith definition_id)
- Computed: key fields from the resource schema (id, name, path, revision, description, release_name_format)
- Read via `GetReleaseDefinition` (by ID) or `GetReleaseDefinitions` + filter (by name)
- If name filter returns multiple matches, return error: "Multiple release definitions found with name X. Use definition_id for unambiguous lookup."

**data.betterado_release_definitions (plural):**
- Schema: `project_id` (Required), `name` (Optional filter), `path` (Optional filter)
- Computed: `definitions` list with lightweight items (id, name, path, revision)
- Read via `GetReleaseDefinitions`

- Unit tests for both data sources following `TestDataReleaseDefinition_*` / `TestDataReleaseDefinitions_*` naming
- Documentation and examples

**Out of scope:**
- Acceptance tests
- Full nested environment/artifact flattening in list (keep list items lightweight for performance)

## Acceptance Criteria

### AC1: Single data source works by ID
- **Given** a data source config with `definition_id`
- **When** Terraform reads the data source
- **Then** it calls `GetReleaseDefinition` and populates all computed fields

### AC2: Single data source works by name with ambiguity handling
- **Given** a data source config with `name`
- **When** Terraform reads the data source
- **Then** it calls `GetReleaseDefinitions` with isExactNameMatch, finds the match, and populates fields
- **And** if multiple matches found, returns error: "Multiple release definitions found with name X. Use definition_id for unambiguous lookup."

### AC3: List data source returns filtered results
- **Given** a data source config with optional `name` and `path` filters
- **When** Terraform reads the data source
- **Then** it calls `GetReleaseDefinitions` with appropriate filters and returns matching definitions in `definitions` list

### AC4: Unit tests pass
- **Given** the data source test files `data_release_definition_test.go` and `data_release_definitions_test.go`
- **When** running `go test -mod=vendor -tags all -count=1 -v -run ^TestDataReleaseDefinition ./azuredevops/internal/service/release/`
- **Then** all tests pass for both data sources

### AC5: Either definition_id or name required for singular
- **Given** a data source config with neither `definition_id` nor `name`
- **When** Terraform validates the config
- **Then** validation fails with clear error message

## Quality Gate

```bash
go build -mod=vendor ./... && go test -mod=vendor -tags all -count=1 -v -run ^TestDataReleaseDefinition ./azuredevops/internal/service/release/
```

## Hard Constraints

- Either `definition_id` or `name` required for single data source (not both)
- Reuse flatten functions from resource where applicable
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
