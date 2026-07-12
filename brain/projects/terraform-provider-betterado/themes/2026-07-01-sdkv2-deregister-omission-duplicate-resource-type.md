---
title: SDKv2 deregister omission causes Duplicate resource type at mux time
description: 'Registering a resource in framework_provider.go without removing it from provider.go ResourcesMap causes "Invalid Provider Server Combination: Duplicate resource type" at terraform apply — invisible to offline CI gates, only caught by live acceptance tests.'
category: antipattern
created_at: 2026-07-01T00:00:00.000Z
updated_at: 2026-07-01T00:00:00.000Z
---

## What happened

WI-1 (migrate `betterado_release_folder` to framework) added `NewReleaseFolderResource` to `framework_provider.go`'s `Resources()` slice but did not remove `betterado_release_folder` from `provider.go`'s `ResourcesMap`. Result: the mux registered the resource twice.

Live acceptance test failure (5 iterations before budget exhausted):
```
Error: Invalid Provider Server Combination:
The combined provider has multiple implementations of the same resource type.
Duplicate resource type: betterado_release_folder.
```

`make test`, `golangci-lint`, and `terrafmt-check` all passed — the duplicate is only detectable by the mux at runtime (acceptance test time).

## Root cause

`profile.md` checklist clause 1 (mandatory per-resource framework-migration checklist) states:
> "Deregister from SDKv2 in the SAME WI. REMOVE the resource from `ResourcesMap`/`DataSourcesMap` when you add it to `Resources()`/`DataSources()`."

brainReads:0 on WI-1 — the checklist was never consulted. 5 iterations and ~$3.8 were spent on a fix that was one line deletion.

## Prevention

1. PM MUST embed the profile.md framework-migration checklist clause verbatim as an AC in every framework-migration WI spec.
2. The gate for a resource-migration WI should include `provider_test.go`'s `TestProvider_HasChildResources` (which asserts the SDKv2 map does NOT contain the migrated resource after the WI).
3. ralph should read `profile.md` before starting any WI whose title contains "migrate" or "framework".

## Also update provider_test.go

When moving a resource from SDKv2 to framework, `TestProvider_HasChildResources` must be updated to remove the resource name from the expected set — otherwise the test fails and the gate catches the omission at offline-CI time.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions/events.jsonl` (lines 480-482: gate.fail with "Duplicate resource type", ralph.end WI-1 run 1 status:failed)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions.md`
