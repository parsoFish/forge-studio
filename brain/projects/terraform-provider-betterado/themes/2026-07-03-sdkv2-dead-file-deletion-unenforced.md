---
title: SDKv2 dead files not deleted after framework migration (recurring)
description: Checklist clause 3b (delete superseded SDKv2 files in the same WI) never enforced; dead resource_*.go + test files remain on every migration branch across 7+ cycles.
category: antipattern
keywords: [sdkv2-dead-files, checklist-clause-3b, deregister-and-delete, dead-code, feed-migration, golangci-lint]
related_themes: [provider-registration-dedup-index, 2026-07-01-sdkv2-deregister-omission-duplicate-resource-type, 2026-07-03-sdkv2-dead-files-omission-4th-cycle, 2026-07-03-sdkv2-dead-files-5th-cycle-dashboard-extension, 2026-07-03-sdkv2-dead-files-wiki-migration-6th-cycle, 2026-07-03-sdkv2-dead-files-serviceendpoint-7th-cycle-second-devloop-run, 2026-07-03-build-package-sdkv2-dead-files-not-deleted]
created_at: 2026-07-03
updated_at: 2026-07-03
---

# SDKv2 dead files not deleted after framework migration (recurring)

## Problem

`profile.md` clause 3b: "Delete the SDKv2 source file and its `_test.go` in the same WI that introduces the framework replacement." As of INIT-2026-07-01-migrate-framework-feed (PR #50), the following files remain on main:

- `azuredevops/internal/service/feed/resource_feed.go`
- `azuredevops/internal/service/feed/resource_feed_permission.go`
- `azuredevops/internal/service/feed/resource_feed_retention_policy.go`
- `azuredevops/internal/service/feed/data_feed.go`
- Corresponding `_test.go` files

This is the 7th migration cycle in which the deletion was skipped. The SDKv2 registration was removed from `provider.go` (correct), but the source files were left, creating dead code that `go vet` and `golangci-lint` silently tolerate.

## Root cause

brainReads:0 across all ralph sessions — the clause is in profile.md but never read. The per-WI gate (`go test -tags all -run TestAcc...`) doesn't assert dead file absence.

## Fix path

1. Add a `Bash` gate step: `! ls azuredevops/internal/service/<domain>/resource_<old>.go 2>/dev/null` in WI spec ACs, OR
2. Quality gate checks that deregistered types have no source file on branch.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed/events.jsonl` — dev-loop.delivered diff shows no deletion of SDKv2 source files
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed.md`
- `brain/projects/terraform-provider-betterado/profile.md` clause 3b

## See also

Same saga — sdkv2 dead-file "deregister AND delete" saga:

- [[2026-07-01-sdkv2-deregister-omission-duplicate-resource-type]]
- [[2026-07-03-sdkv2-dead-files-omission-4th-cycle]]
- [[2026-07-03-sdkv2-dead-files-5th-cycle-dashboard-extension]]
- [[2026-07-03-sdkv2-dead-files-wiki-migration-6th-cycle]]
- [[2026-07-03-sdkv2-dead-files-serviceendpoint-7th-cycle-second-devloop-run]]
- [[2026-07-03-build-package-sdkv2-dead-files-not-deleted]]
