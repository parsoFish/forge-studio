---
title: Registration-file merge conflicts when concurrent migrations fan in
description: When multiple framework-migration PRs touch provider.go / framework_provider.go / provider_test.go concurrently, the second PR to merge goes CONFLICTING; naive union-patch produces duplicate map keys that the operator must catch manually.
category: antipattern
keywords: [provider.go, framework_provider.go, merge-conflict, resourcesmap, union-patch, duplicate-map-keys, worktree-cwd, fan-in]
related_themes: [provider-registration-dedup-index]
created_at: 2026-07-10T00:00:00.000Z
updated_at: 2026-07-10T00:00:00.000Z
---

## Pattern observed

After PR #49 (build-package migration) merged to main, PR #53 (member-entitlement migration) went CONFLICTING on:

- `azuredevops/provider.go` (ResourcesMap)
- `azuredevops/internal/provider/framework_provider.go` (Resources())
- `azuredevops/internal/provider/provider_test.go`
- `CHANGELOG.md`

Resolution procedure: take main's version of the file, then union-patch the initiative's edits back in. This is error-prone: the initial attempt produced **duplicate map keys** in `provider.go`'s ResourcesMap because both the incoming HEAD and the union-patch already contained the deregistration edits. Operator had to catch the duplicates and re-edit.

A secondary failure: the shell `cwd` snapped back to a different initiative's git worktree between merge calls, causing the conflict resolution to initially land in the wrong worktree. Recovered via `git reset --keep`; remote was never polluted.

## Why this recurs

Every framework-migration WI must:
1. Deregister the old SDKv2 type from `provider.go` ResourcesMap.
2. Register the new framework type in `framework_provider.go` Resources().
3. Update `provider_test.go` provider count.

These three files are touched by every migration initiative. When two initiatives are in flight simultaneously, the second to merge will always have conflicts on these files. The hidden-coupling validator guards WITHIN an initiative (WI pairs that both list the same file), but NOT ACROSS initiatives.

## Mitigation options

1. **Serialize migration initiatives on the queue** — only one framework-migration initiative in-flight at a time. Simplest. No forge change needed.
2. **PM generates file-level conflict warnings** — when enqueuing a migration initiative, PM checks whether any other in-flight initiative also edits the shared registration files and warns the operator.
3. **Union-patch script** — a deterministic merge tool for `provider.go`/`framework_provider.go` that extracts registration blocks and merges them structurally, preventing duplicates.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement/user-feedback.md` (Q4 operator note)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement.md`
