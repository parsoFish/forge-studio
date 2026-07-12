---
title: SDKv2 dead helper functions in serviceendpoint — 7th cycle, triggered second dev-loop run
description: Serviceendpoint migration left 5 dead SDKv2 helper functions; unifier go-build failure forced a complete second dev-loop run of all 10 WIs (~$15-20 extra). This is the 7th framework-migration cycle with this omission; severity escalated from dead-code lint warnings to a build break.
category: antipattern
keywords: [serviceendpoint, dead-helper-functions, go-build-failure, second-devloop-run, sdkv2-dead-files, dedup]
related_themes: [provider-registration-dedup-index, 2026-07-01-sdkv2-deregister-omission-duplicate-resource-type, 2026-07-03-sdkv2-dead-files-omission-4th-cycle, 2026-07-03-sdkv2-dead-files-5th-cycle-dashboard-extension, 2026-07-03-sdkv2-dead-files-wiki-migration-6th-cycle, 2026-07-03-sdkv2-dead-file-deletion-unenforced, 2026-07-03-build-package-sdkv2-dead-files-not-deleted]
created_at: 2026-07-03T22:00:00.000Z
updated_at: 2026-07-03T22:00:00.000Z
---

## What happened

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint`.

Run 1 delivered 92 files, +13568/-1663, 31 commits across 10 WIs. The unifier ran `go build` and hit:

```
undefined: findServiceEndpointByName
undefined: validateScopeLevel
```

`golangci-lint` also caught 3 unused exported functions:

```
validateServiceEndpoint
dataSourceGenBaseSchema
dataSourceGetBaseServiceEndpoint
```

These are SDKv2 helpers that multiple resource types previously called. After each resource type was migrated to framework, the helpers lost all callers — but were not deleted. Because they are unexported (or used only by the deleted callers), `go build` failed; `golangci-lint` flagged the exported ones.

**Consequence:** Full second dev-loop run required. All 10 WIs re-ran (most were no-ops except WI-2 which patched the build references; WI-6/8/9 added missing validators). Extra cost ~$15-20, extra time ~1.5h.

## Why this is worse than prior occurrences

Prior 6 cycles: dead files compiled silently — CI lint caught them after the fact or PR reviewers caught them. This cycle: shared helpers with multiple callers accumulated until the last caller was removed, at which point `go build` itself broke. The severity increases with package surface area.

## Files that should have been deleted / cleaned

- Shared helper functions in `azuredevops/internal/service/serviceendpoint/`: `findServiceEndpointByName`, `validateScopeLevel`, `validateServiceEndpoint`, `dataSourceGenBaseSchema`, `dataSourceGetBaseServiceEndpoint`
- The SDKv2 resource/data-source `.go` files and their `_test.go` counterparts for all 30+ migrated types

## Recurring root cause

`profile.md` clause 3b: "dedup = deregister AND delete" — present in the brain but not embedded in WI ACs. brainReads=0 across all 20 ralph sessions. PM did not include file-deletion ACs in any of the 10 WIs.

## Fix (same as prior cycles, still not applied)

PM must embed an explicit `files_to_delete` list AND a build-verification sub-step in each migration WI spec:
```
AC-cleanup: Run `go build ./azuredevops/internal/service/serviceendpoint/...` successfully after deleting:
  - [list SDKv2 files for this WI's scope]
```

## Prior occurrences

1. PR #46 — release definitions: 13 dead files
2. PR #48 — security permissions: 35 dead files
3. PR #49 — build package: ~10 dead files
4. 2026-07-03 4th-cycle (dashboard extension)
5. 2026-07-03 5th-cycle
6. 2026-07-03 wiki migration
7. **This cycle** — serviceendpoint: build break, second dev-loop run

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint/events.jsonl` — unifier gate.fail event, second dev-loop baseline-green event
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint.md`

## See also

Same saga — sdkv2 dead-file "deregister AND delete" saga:

- [[2026-07-01-sdkv2-deregister-omission-duplicate-resource-type]]
- [[2026-07-03-sdkv2-dead-files-omission-4th-cycle]]
- [[2026-07-03-sdkv2-dead-files-5th-cycle-dashboard-extension]]
- [[2026-07-03-sdkv2-dead-files-wiki-migration-6th-cycle]]
- [[2026-07-03-sdkv2-dead-file-deletion-unenforced]]
- [[2026-07-03-build-package-sdkv2-dead-files-not-deleted]]
