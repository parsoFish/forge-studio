---
title: Build package framework migration — SDKv2 dead files not deleted (3rd cycle)
description: All 5 build-package WIs migrated to framework without deleting the superseded SDKv2 .go files; profile.md clause 3b ("dedup = deregister AND delete") skipped for the third consecutive migration cycle.
category: antipattern
keywords: [sdkv2-dead-files, dedup, profile-md, deregister-and-delete, build-package, dead-code]
related_themes: [provider-registration-dedup-index, 2026-07-01-sdkv2-deregister-omission-duplicate-resource-type, 2026-07-03-sdkv2-dead-files-omission-4th-cycle, 2026-07-03-sdkv2-dead-files-5th-cycle-dashboard-extension, 2026-07-03-sdkv2-dead-files-wiki-migration-6th-cycle, 2026-07-03-sdkv2-dead-files-serviceendpoint-7th-cycle-second-devloop-run, 2026-07-03-sdkv2-dead-file-deletion-unenforced]
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build` (build package migration).

WIs 2–5 each created a new `*_framework.go` file and deregistered the type from `provider.go` ResourcesMap, but did NOT delete the old SDKv2 implementation files:

- `azuredevops/internal/service/build/resource_build_folder.go` (+ `_test.go`)
- `azuredevops/internal/service/build/resource_build_definition.go` (+ `_test.go`)
- `azuredevops/internal/service/build/resource_pipeline_authorization.go` (+ `_test.go`)
- `azuredevops/internal/service/build/resource_resource_authorization.go` (+ `_test.go`)
- `azuredevops/internal/service/build/data_build_definition.go` (+ `_test.go`)

These files remain on the branch (PR #49). They compile cleanly (no import of the now-deregistered types), so CI passes — but they are dead code.

## Prior occurrences

This is the **third consecutive** framework-migration cycle with the same omission:
- PR #46 (release definitions): 13 dead files left
- PR #48 (security permissions): 35 dead files left
- PR #49 (build package): ~10 dead files left (this cycle)

## Root cause

`profile.md` clause 3b explicitly requires deletion: *"migrating a type means the superseded SDKv2 files ... are DELETED in the same WI, not left orphaned"*. But no WI spec includes *"delete these specific files"* as a named AC. Ralph sees the deregister in `provider.go` as sufficient and does not look further.

## Fix

PM must embed a concrete deletion list in each migration WI spec AC. Example:
```
AC-0 (cleanup): Delete these files as part of the migration:
  - azuredevops/internal/service/build/resource_build_folder.go
  - azuredevops/internal/service/build/resource_build_folder_test.go
  - ... (list per-WI)
```

The list is derivable from the SDKv2 registration in `provider.go` at PM time.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build/events.jsonl` (WI-2…5 `ralph.end` events — no file deletes in `output_refs`)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build.md`

## See also

Same saga — sdkv2 dead-file "deregister AND delete" saga:

- [[2026-07-01-sdkv2-deregister-omission-duplicate-resource-type]]
- [[2026-07-03-sdkv2-dead-files-omission-4th-cycle]]
- [[2026-07-03-sdkv2-dead-files-5th-cycle-dashboard-extension]]
- [[2026-07-03-sdkv2-dead-files-wiki-migration-6th-cycle]]
- [[2026-07-03-sdkv2-dead-files-serviceendpoint-7th-cycle-second-devloop-run]]
- [[2026-07-03-sdkv2-dead-file-deletion-unenforced]]
