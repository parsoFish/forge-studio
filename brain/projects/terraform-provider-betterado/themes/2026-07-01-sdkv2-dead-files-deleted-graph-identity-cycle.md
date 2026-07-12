---
title: SDKv2 dead files deleted correctly in graph+identity migration (first time in 8 cycles)
description: Unlike 7 prior migration cycles, the graph+identity initiative deleted all superseded SDKv2 source files in the same WIs — clause 3b held without operator intervention.
category: pattern
keywords: [sdkv2-dead-files, deregister-and-delete, wi-spec, file-deletion, graph-identity-migration, deletion-discipline]
related_themes: [provider-registration-dedup-index]
created_at: 2026-07-01T10:11:22.291Z
updated_at: 2026-07-01T10:11:22.291Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity`

All superseded SDKv2 graph and identity files were deleted in the same WIs that introduced the framework replacements:

| Deleted file | Lines removed | WI |
|---|---|---|
| `azuredevops/internal/service/graph/resource_group.go` | −390 | WI-2 |
| `azuredevops/internal/service/graph/resource_group_test.go` | −346 | WI-2 |
| `azuredevops/internal/service/graph/resource_group_membership.go` | −318 | WI-3 |
| `azuredevops/internal/service/graph/resource_group_membership_test.go` | −100 | WI-3 |
| `azuredevops/internal/service/graph/data_descriptor.go` | −57 | WI-4 |
| `azuredevops/internal/service/graph/data_group.go` | −202 | WI-4 |
| `azuredevops/internal/service/graph/data_group_membership.go` | −63 | WI-4 |
| `azuredevops/internal/service/graph/data_group_test.go` | −249 | WI-4 |
| `azuredevops/internal/service/graph/data_groups.go` | −186 | WI-5 |
| `azuredevops/internal/service/graph/data_groups_test.go` | −164 | WI-5 |
| `azuredevops/internal/service/graph/data_service_principal.go` | −139 | WI-5 |
| `azuredevops/internal/service/graph/data_service_principal_test.go` | −110 | WI-5 |
| `azuredevops/internal/service/graph/data_storagekey.go` | −53 | WI-4 |
| `azuredevops/internal/service/graph/data_user.go` | −95 | WI-5 |
| `azuredevops/internal/service/graph/data_users.go` | −287 | WI-5 |
| `azuredevops/internal/service/graph/data_users_test.go` | −472 | WI-5 |
| `azuredevops/internal/service/identity/data_identity_group.go` | −84 | WI-6 |
| `azuredevops/internal/service/identity/data_identity_group_test.go` | −68 | WI-6 |
| `azuredevops/internal/service/identity/data_identity_groups.go` | −132 | WI-6 |
| `azuredevops/internal/service/identity/data_identity_groups_test.go` | −67 | WI-6 |
| `azuredevops/internal/service/identity/data_identity_user.go` | −116 | WI-6 |
| `azuredevops/internal/service/identity/data_identity_user_test.go` | −82 | WI-6 |

Total removed: ~4423 lines (full diff stat: +11377 −4423).

## Why this succeeded

The PM's WI specs for this initiative explicitly listed the SDKv2 source files under "Files in scope" with a deletion intent implied by the framework replacement. The AC for each WI also specified deregistration from `provider.go`. Combined, these cues made it clear to ralph that the old files must go.

Prior cycles where deletion was skipped had WI specs that listed only the NEW framework files; no mention of what to remove.

## Contrast with prior cycles

Theme `2026-07-03-sdkv2-dead-file-deletion-unenforced.md` documents 7 prior cycles where clause 3b failed. This is the first exception.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity/events.jsonl` — dev-loop.delivered diff-stat shows −4423 deletions
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity.md`
