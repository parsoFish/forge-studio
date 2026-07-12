---
title: Unused function lint error passes per-WI gate, caught by CI gate
description: expandExtensionInstall left unused in resource_extension_install_framework.go; go test passed per-WI gate but golangci-lint caught it at CI gate, blocking PR — same gate-gap pattern as 2026-06-06.
category: antipattern
keywords: [unused-func, golangci-lint, ci-gate, lint-blind, extension-install, auto-fixer]
related_themes: [build-tooling-index]
created_at: 2026-07-05
updated_at: 2026-07-05
---

## Pattern

`resource_extension_install_framework.go:345` — `func expandExtensionInstall(model *extensionInstallModel) *extensionmanagement.InstalledExtension` was defined but never called after implementation was refactored to use direct struct assignment instead.

The per-WI gate (`go test -tags all -run TestExtensionInstallResource ./azuredevops/internal/service/extensionmanagement/...`) passes because Go's test runner does not run the linter. `golangci-lint run ./azuredevops/...` (in the CI gate `make test && golangci-lint run ./azuredevops/... && make terrafmt-check`) caught it and blocked the PR.

## Lint error

```
azuredevops/internal/service/extensionmanagement/resource_extension_install_framework.go:345:6:
func expandExtensionInstall is unused (unused)
1 issues:
* unused: 1
```

## Impact

CI gate blocked, `ran_fixer:true` in the orchestrator event, manifest moved to `done/` after fixer resolved it. No human intervention needed — the auto-fixer recovered.

## Pattern prevalence

3rd confirmed occurrence on this project (see `2026-06-06-live-acc-gate-misses-lint-ci-gate-net`, `2026-07-03-build-package-sdkv2-dead-files-not-deleted`). The per-WI gate consistently passes lint-red code because `go test` is lint-blind.

## Mitigation direction

Add `golangci-lint run --new-from-rev=main ./azuredevops/internal/service/extensionmanagement/...` as a composed per-WI gate suffix for new-service WIs, or configure the PM to append a lint step to the `quality_gate_cmd` for any WI that creates a new Go source file.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-gallery-extensionmanagement/events.jsonl` — EV_mr5nkux0_qbd212lr (CI gate FAIL)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-gallery-extensionmanagement.md`
