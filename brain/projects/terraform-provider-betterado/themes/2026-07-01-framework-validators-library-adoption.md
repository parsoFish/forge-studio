---
title: terraform-plugin-framework-validators v0.19.0 adopted — hand-rolled validators.go deleted
description: The graph+identity migration replaced the hand-rolled validators.go with the official terraform-plugin-framework-validators library; go.mod + vendor updated in-WI; 7 offline unit tests confirm conflict-triangle and mode-enum validators.
category: pattern
keywords: [terraform-plugin-framework-validators, stringvalidator, resourcevalidator, validators.go, vendor, sdkv2-to-framework-mapping]
related_themes: [framework-migration-index]
created_at: 2026-07-01T10:11:22.291Z
updated_at: 2026-07-01T10:11:22.291Z
---

## Pattern

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity`

The hand-rolled `validators.go` in the graph package was deleted and replaced with `github.com/hashicorp/terraform-plugin-framework-validators` v0.19.0. The library ships `stringvalidator`, `resourcevalidator`, `schemavalidator` and `configvalidator` sub-packages.

**Vendor additions (from diff-stat):**
- `vendor/github.com/hashicorp/terraform-plugin-framework-validators/` — full library tree (LICENSE + all sub-packages)
- `vendor/modules.txt` — 8 lines added

**Unit tests added:**
- `azuredevops/internal/service/graph/validators_test.go` — 198 lines, 7 subtests covering `ConflictsWith`, mode-enum `OneOf`, etc. All green offline (no TF_ACC).

## How to vendor a new framework-validators version

1. `go get github.com/hashicorp/terraform-plugin-framework-validators@v0.19.0`
2. `go mod tidy`
3. `go mod vendor`
4. Confirm `vendor/modules.txt` updated.
5. Run `make test` (offline) to verify no import cycle or build break.

## Validators map from SDKv2

| SDKv2 | framework-validators equivalent |
|---|---|
| `validation.IsUUID` | `stringvalidator.RegexMatches(uuidRegexp, ...)` |
| `validation.StringIsNotWhiteSpace` | `stringvalidator.LengthAtLeast(1)` |
| `validation.StringInSlice(vals, false)` | `stringvalidator.OneOf(vals...)` |
| `ConflictsWith: [...]` | `stringvalidator.ConflictsWith(path.MatchRoot(...))` |
| `RequiredWith: [...]` | `stringvalidator.AlsoRequires(path.MatchRoot(...))` |
| `ExactlyOneOf: [...]` | `configvalidator.ExactlyOneOf(...)` |
| `ForceNew: true` | `PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}` |

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity/events.jsonl` — dev-loop.delivered diff includes `vendor/github.com/hashicorp/terraform-plugin-framework-validators/` additions
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity.md`
- `azuredevops/internal/service/graph/validators_test.go` (198 lines in merged tree)
