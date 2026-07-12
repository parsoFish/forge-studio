---
title: SDKv2 dead-file omission — 4th consecutive migration cycle (member-entitlement)
description: WI-2/3/4 each created a framework .go file and deregistered the SDKv2 type but did not delete the old implementation files; unifier UWI-2 was required to delete them, adding ~$3.1 cost. This is the 4th consecutive migration cycle with this pattern.
category: antipattern
keywords: [sdkv2-dead-files, deregister-and-delete, deletion-ac, unifier-cost, framework-migration, cleanup]
related_themes: [provider-registration-dedup-index, 2026-07-01-sdkv2-deregister-omission-duplicate-resource-type, 2026-07-03-sdkv2-dead-files-5th-cycle-dashboard-extension, 2026-07-03-sdkv2-dead-files-wiki-migration-6th-cycle, 2026-07-03-sdkv2-dead-files-serviceendpoint-7th-cycle-second-devloop-run, 2026-07-03-sdkv2-dead-file-deletion-unenforced, 2026-07-03-build-package-sdkv2-dead-files-not-deleted]
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement`.

WI-2 (`user_entitlement`), WI-3 (`group_entitlement`), WI-4 (`service_principal_entitlement`) each:
- Created `resource_*_framework.go` + `resource_*_framework_test.go` ✓
- Deregistered from `provider.go` ResourcesMap ✓
- Updated `framework_provider.go` Resources() ✓
- **Did NOT delete** the superseded SDKv2 files (e.g. `resource_user_entitlement.go`, `resource_user_entitlement_test.go`)

Unifier run UWI-2 + UWI-3 were required to delete them. Added ~$3.1 cost to a second unifier run.

## Prior occurrences (4 total)

| Cycle | PR | Dead files left |
|---|---|---|
| release-definitions | #46 | 13 files |
| security-permissions | #48 | 35 files |
| build package | #49 | ~10 files |
| **member-entitlement** | **#53** | **~6 files** |

## Root cause

`profile.md` clause 3b: *"dedup = deregister AND delete"* is clear. PM reads the profile. But PM WI specs do not include an explicit deletion AC listing the files by name — so ralph treats deregistration as sufficient and does not search for files to delete.

The profile.md checklist is abstract ("superseded SDKv2 files are DELETED"); ralph needs a concrete file list to act.

## Fix (confirmed effective direction, not yet implemented)

PM must embed a concrete deletion list per migration WI spec:
```
AC-0 (cleanup): Delete these SDKv2 files in the same commit:
  - azuredevops/internal/service/memberentitlementmanagement/resource_user_entitlement.go
  - azuredevops/internal/service/memberentitlementmanagement/resource_user_entitlement_test.go
  ... (enumerated at PM time from provider.go ResourcesMap)
```

The list is derivable at PM time: iterate `provider.go` ResourcesMap entries that will be deregistered in each WI and record the corresponding `.go` + `_test.go` paths.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement/events.jsonl` (WI-2, WI-3, WI-4 `ralph.end` events — file.add only, no file.delete; UWI-2 gate.pass at `2026-07-03T04:07:08`)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement.md`
- Prior evidence: `brain/projects/terraform-provider-betterado/themes/2026-07-03-build-package-sdkv2-dead-files-not-deleted.md`

## See also

Same saga — sdkv2 dead-file "deregister AND delete" saga:

- [[2026-07-01-sdkv2-deregister-omission-duplicate-resource-type]]
- [[2026-07-03-sdkv2-dead-files-5th-cycle-dashboard-extension]]
- [[2026-07-03-sdkv2-dead-files-wiki-migration-6th-cycle]]
- [[2026-07-03-sdkv2-dead-files-serviceendpoint-7th-cycle-second-devloop-run]]
- [[2026-07-03-sdkv2-dead-file-deletion-unenforced]]
- [[2026-07-03-build-package-sdkv2-dead-files-not-deleted]]
