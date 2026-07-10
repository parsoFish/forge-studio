---
title: Policy framework helper pattern — shared helpers.go per package
description: The branch and repository policy framework migrations both adopted a shared framework_helpers.go within each package to hold common schema attribute builders and flatten/expand utilities, enabling ralph to converge without brain reads.
category: pattern
created_at: 2026-07-04
updated_at: 2026-07-04
---

# Policy framework helper pattern — shared helpers.go per package

## What happened

WI-2 (branch policies) and WI-3 (repository policies) each produced a `framework_helpers.go` in their respective packages:
- `azuredevops/internal/service/policy/branch/framework_helpers.go`
- `azuredevops/internal/service/policy/repository/framework_helpers.go`

These files hold shared schema attribute builders and flatten/expand helpers used by all resources in the package. The pattern matches what the graph and identity migrations established — one helpers file per package, resource-specific files only contain `Resource()`, `Metadata()`, `Schema()`, `Create/Read/Update/Delete`.

## Why it worked despite brainReads=0

The existing `graph+identity` migration (prior initiative) was already in the worktree. Ralph discovered the pattern by reading those files, not by consulting the brain. The framework_helpers.go pattern is therefore self-bootstrapping from prior work in the same repo.

## Standing rule

For any new policy/repository/checks package migration: create `framework_helpers.go` first, then create per-resource files that import it. Do NOT inline shared schema builders in each resource file.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-policy-branch/events.jsonl` — `ralph.end` WI-2 output_refs (branch/framework_helpers.go), WI-3 output_refs (repository/framework_helpers.go)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-policy-branch.md`
