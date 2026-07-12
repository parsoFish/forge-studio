---
title: Dead SDKv2 publisher functions block CI gate × 2 — 3 extra unifier passes
description: >-
  After migrating servicehook resources to the framework, unused helper functions
  in the SDKv2 publisher files (pipelines_publisher.go, tfs_publisher.go) were not
  deleted. golangci-lint reported 15 unused-func errors; the CI gate blocked twice
  (same error both times), forcing 3 additional unifier passes before the lint was
  cleared. Per-WI gate never catches this (go test is lint-blind).
category: antipattern
keywords: [unused-func, golangci-lint, ci-gate, dead-code, publisher-helpers, servicehook, lint-blind]
related_themes: [build-tooling-index, provider-registration-dedup-index]
created_at: 2026-07-01T00:00:00.000Z
updated_at: 2026-07-01T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook`

Both `betterado_servicehook_storage_queue_pipelines` and `betterado_servicehook_webhook_tfs` were migrated to the framework. The SDKv2 resource files were deregistered and (eventually) deleted. However, the shared publisher helpers (`pipelines_publisher.go`, `tfs_publisher.go`) still contained SDKv2-style helper functions that were no longer called by the new framework resources:

```
azuredevops/internal/service/servicehook/pipelines_publisher.go:131:6: func isNilEventConfig is unused
azuredevops/internal/service/servicehook/tfs_publisher.go:10:5: var tfsResourceBlock2ApiType is unused
azuredevops/internal/service/servicehook/tfs_publisher.go:41:5: var tfsApiType2ResourceBlock is unused
azuredevops/internal/service/servicehook/tfs_publisher.go:73:6: func genTfsPublisherSchema is unused
azuredevops/internal/service/servicehook/tfs_publisher.go:564:6: func expandTfsEventConfig is unused
azuredevops/internal/service/servicehook/tfs_publisher.go:686:6: func flattenTfsEventConfig is unused
... (15 issues total: unused: 15)
```

The CI gate fired at `2026-07-03T05:13:39`, then again at `2026-07-03T10:03:18` with identical output. Three unifier passes (UWI-4 passes 1–3) were required to clear the lint. The dominant pass cost $6.47 — more than the average full dev-loop — and was driven by this cleanup plus validator parity work.

## Why the per-WI gate doesn't catch this

The per-WI `quality_gate_cmd` runs `go test -tags all -run TestAcc<name> ./azuredevops/internal/service/servicehook/...`. `go test` does not invoke `golangci-lint`. The `unused` linter only runs in the CI gate (`golangci-lint run ./azuredevops/...`). A resource that compiles and passes its acceptance test can still be lint-red.

## Distinction from the dead-files antipattern

The dead-files antipattern (SDKv2 `_test.go` files referencing deleted symbols fail `go vet -tags all`) covers **compilation failures**. This pattern covers **lint failures** from unused exported-ish helpers in shared publisher files that compile correctly but are now dead code. Both are invisible to the per-WI gate.

## Rule

When migrating a resource that shares helper functions in a publisher file (e.g. `*_publisher.go`):
1. After deregistering and reimplementing the framework resource, audit the publisher file for functions/variables no longer called by any remaining code.
2. Delete or unexport them in the same WI (before the WI gate runs).
3. Or add `golangci-lint run ./azuredevops/internal/service/<package>/... --new-from-rev=main` as a suffix to the per-WI gate to catch unused symbols before they reach the CI gate.

This is the 4th confirmed lint-CI-gate-block on this project (see `2026-06-06-live-acc-gate-misses-lint-ci-gate-net`, `2026-07-03-build-package-sdkv2-dead-files-not-deleted`, `2026-07-05-unused-func-lint-gate-gap-extension-install`).

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook/events.jsonl` — CI gate failure events at `2026-07-03T05:13:39` (EV_mr4ha1ka_mum987rp) and `2026-07-03T10:03:18` (EV_mr4rmj8y_7g6lf1ku)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook.md`
