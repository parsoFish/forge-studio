---
title: Security/securityroles/permissions framework migration pattern — all 17 types landed
description: Full SDKv2→framework migration of betterado_security_permissions, betterado_security_namespace*, betterado_securityrole_assignment, betterado_securityrole_definitions, and all 13 betterado_*_permissions types merged as PR #48; gap matrices produced for all three API areas.
category: pattern
created_at: 2026-07-04T00:00:00.000Z
updated_at: 2026-07-04T00:00:00.000Z
---

## Pattern

Initiative `INIT-2026-07-01-migrate-framework-security-permissions` delivered:

- `betterado_security_permissions` (resource) + `betterado_security_namespace`, `betterado_security_namespace_token`, `betterado_security_namespaces` (data sources) — framework.
- `betterado_securityrole_assignment` (resource) + `betterado_securityrole_definitions` (data source) — framework.
- All 13 `internal/service/permissions/` resources (`betterado_area_permissions`, `betterado_build_definition_permissions`, `betterado_build_folder_permissions`, `betterado_git_permissions`, `betterado_iteration_permissions`, `betterado_library_permissions`, `betterado_project_permissions`, `betterado_serviceendpoint_permissions`, `betterado_servicehook_permissions`, `betterado_tagging_permissions`, `betterado_variable_group_permissions`, `betterado_workitemquery_permissions`, `betterado_workitemtrackingprocess_process_permissions`) — framework.
- Gap matrices: `docs/security-gap-matrix.md`, `docs/securityroles-gap-matrix.md`, `docs/permissions-gap-matrix.md`.

Merged: PR #48. Final diff: 193 files, 13168 insertions, 6041 deletions, 65 commits.

## Key implementation notes

- The `internal/service/permissions/` package is a **single-owner package** (per profile.md and the architect plan) — no feature-area initiative touches `*_permissions` types; this initiative owns the whole package.
- Permissions resources share a common token+namespace_id+subject_descriptor scaffold; a single representative live test (`betterado_project_permissions`) validated the shared plumbing.
- SDKv2 deregister + delete was required for all 17 types; dead-file deletion verified with `go vet -tags all ./azuredevops/...`.
- `CaptureLiveEvidence` required per resource type with a unique label (shared labels cause last-writer-wins overwrite).

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions/events.jsonl` (dev-loop.delivered final: files_changed=193, insertions=13168, deletions=6041, commits=65)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions.md`
- PR #48: https://github.com/parsoFish/terraform-provider-betterado/pull/48
