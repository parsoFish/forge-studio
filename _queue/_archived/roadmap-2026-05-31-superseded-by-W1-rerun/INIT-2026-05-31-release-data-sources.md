---
initiative_id: INIT-2026-05-31-release-data-sources
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-31T11:50:12.349Z'
iteration_budget: 3
cost_budget_usd: 9
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: data.betterado_release_definition — single definition lookup by id/name
    depends_on: []
  - feature_id: FEAT-2
    title: data.betterado_release_definitions — list definitions with filters
    depends_on:
      - FEAT-1
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-31-release-data-sources
---

## Overview

Add read-only data sources for release definitions, enabling Terraform configurations to reference existing definitions without managing their lifecycle.

## Problem Statement

Users need to:
- Reference existing release definitions in other resources (e.g., service hooks, variable groups)
- Query definition IDs by name for import preparation
- List definitions matching criteria for inventory/auditing

## Features

### F1: data.betterado_release_definition — single definition lookup

**Scope:**
- Create `azuredevops/internal/service/release/data_release_definition.go`
- Lookup by `id` (exact) OR `name` + `path` (search)
- Return full definition attributes (environments, artifacts, variables, etc.)
- Register in `azuredevops/provider.go`

**Schema:**
```hcl
data "betterado_release_definition" "example" {
  project_id = azuredevops_project.example.id
  
  # One of:
  definition_id = 123
  # OR
  name = "My Release"
  path = "\\Production"  # Optional, defaults to root
}
```

**Acceptance Criteria:**
```gherkin
Given an existing release definition in ADO
When I reference it via data.betterado_release_definition with definition_id
Then all attributes are populated in the data source

Given multiple definitions with similar names in different folders
When I query by name + path
Then only the exact match is returned

Given a non-existent definition_id
When terraform plan runs
Then an error is returned (not an empty result)
```

### F2: data.betterado_release_definitions — list with filters

**Scope:**
- Create `azuredevops/internal/service/release/data_release_definitions.go`
- Filters: `path` (folder), `name_pattern` (contains/regex), `is_deleted` (include soft-deleted)
- Return list of definition summaries (id, name, path, created_on, modified_on)
- Register in `azuredevops/provider.go`

**Schema:**
```hcl
data "betterado_release_definitions" "production" {
  project_id = azuredevops_project.example.id
  path       = "\\Production"  # Optional
  # name_pattern = "Web"      # Optional: filter by name contains
}

output "definition_ids" {
  value = data.betterado_release_definitions.production.definitions[*].id
}
```

**Acceptance Criteria:**
```gherkin
Given multiple release definitions in a folder
When I query with path filter
Then only definitions in that folder are returned

Given definitions with various names
When I query with name_pattern
Then only matching definitions are returned

Given the data source
When used in terraform output
Then definition IDs can be used in for_each or other references
```

## Quality Gate

```bash
go test -tags all -count=1 -run ^TestDataReleaseDefinition ./azuredevops/internal/service/release/
```

## Dependencies

- Depends on: `ci-green` (CI must be green)
- Soft dependency on `release-definition-substrate` (reuses flatten functions)

## Non-Goals

- Data sources for other release objects (folders, templates) — can be added later
- Write operations via data sources
- Caching/pagination for very large definition lists

## Hard Constraints

- Data sources are read-only — no Create/Update/Delete
- Reuse flatten functions from release_definition resource
- Fail loudly on not-found (don't return empty)
