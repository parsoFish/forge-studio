---
title: SDKv2 dead-file omission — 5th consecutive migration cycle (dashboard + extension)
description: Ralph created framework .go files and deregistered from provider.go for betterado_dashboard and betterado_extension but did not delete the superseded SDKv2 source files; unifier UWI-4+ cleaned them up. Fifth consecutive migration cycle with this pattern.
category: antipattern
keywords: [sdkv2-dead-files, deregister-and-delete, dashboard, extension, unifier-cleanup, dedup]
related_themes: [provider-registration-dedup-index, 2026-07-01-sdkv2-deregister-omission-duplicate-resource-type, 2026-07-03-sdkv2-dead-files-omission-4th-cycle, 2026-07-03-sdkv2-dead-files-wiki-migration-6th-cycle, 2026-07-03-sdkv2-dead-files-serviceendpoint-7th-cycle-second-devloop-run, 2026-07-03-sdkv2-dead-file-deletion-unenforced, 2026-07-03-build-package-sdkv2-dead-files-not-deleted]
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-dashboard-extension`.

WIs for `betterado_dashboard` and `betterado_extension`:
- Created `resource_*_framework.go` + tests ✓
- Deregistered from `provider.go` ResourcesMap ✓
- Updated `framework_provider.go` Resources() ✓
- **Did NOT delete** the superseded SDKv2 source files

Unifier sessions UWI-4 through UWI-7 deleted the dead files and passed the CI gate.

## Prior occurrences (5 total)

| Cycle | PR | Dead files left |
|---|---|---|
| release-definitions | #46 | 13 files |
| security-permissions | #48 | 35 files |
| build package | #49 | ~10 files |
| member-entitlement | #53 | ~6 files |
| **dashboard + extension** | **#45** | see UWI-4+ cleanup |

## Root cause

Profile.md clause 3b ("dedup = deregister AND delete") is clear but abstract. PM does not embed a concrete file-deletion list per migration WI spec. Ralph treats deregistration as sufficient and does not search for files to delete.

## Fix (confirmed effective direction, not yet implemented)

PM must embed a concrete deletion list per migration WI spec at decomposition time:

```
AC-0 (cleanup): Delete these SDKv2 files in the same commit:
  - azuredevops/internal/service/dashboard/resource_dashboard.go
  - azuredevops/internal/service/dashboard/resource_dashboard_test.go
  - azuredevops/internal/service/extension/resource_extension.go
  - azuredevops/internal/service/extension/resource_extension_test.go
  ... (enumerated from provider.go ResourcesMap entries being deregistered)
```

The list is derivable at PM time: iterate `provider.go` ResourcesMap for each WI's scope and record the `.go` + `_test.go` paths.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-dashboard-extension/events.jsonl` (UWI-4 through UWI-7 gate.pass events at 2026-07-03T07:55–08:19; unifier.end at 2026-07-03T08:00 and 08:21)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-dashboard-extension.md`
- Prior evidence: `brain/projects/terraform-provider-betterado/themes/2026-07-03-sdkv2-dead-files-omission-4th-cycle.md`

## See also

Same saga — sdkv2 dead-file "deregister AND delete" saga:

- [[2026-07-01-sdkv2-deregister-omission-duplicate-resource-type]]
- [[2026-07-03-sdkv2-dead-files-omission-4th-cycle]]
- [[2026-07-03-sdkv2-dead-files-wiki-migration-6th-cycle]]
- [[2026-07-03-sdkv2-dead-files-serviceendpoint-7th-cycle-second-devloop-run]]
- [[2026-07-03-sdkv2-dead-file-deletion-unenforced]]
- [[2026-07-03-build-package-sdkv2-dead-files-not-deleted]]
