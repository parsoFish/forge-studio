---
title: Go internal/ package rule — root main.go cannot import azuredevops/internal/
description: The root main.go (module root) cannot import azuredevops/internal/provider because Go's internal/ rule restricts importers to the subtree rooted at the parent of internal/. Fix is a thin public re-export in azuredevops/framework.go.
category: pattern
keywords: [go-internal-package, main-go, import-restriction, framework-go, public-re-export]
related_themes: [build-tooling-index]
created_at: 2026-06-19T00:00:00.000Z
updated_at: 2026-06-19T00:00:00.000Z
---

## Pattern

The `terraform-provider-betterado` repo has:
- Module root: `github.com/parsoFish/terraform-provider-betterado`
- Framework provider: `azuredevops/internal/provider/framework_provider.go` (package `provider`)

Go's `internal` package rule: a package at `A/internal/B` is importable **only** by code whose import path has `A` as a prefix. `main.go` at the module root has import path `github.com/parsoFish/terraform-provider-betterado` — it does **not** have `...betterado/azuredevops` as a prefix, so it cannot import `azuredevops/internal/provider`.

**Solution adopted:** create `azuredevops/framework.go` in package `azuredevops` (same package as `provider.go`), which exports `NewFrameworkProvider()` delegating to the internal package. `main.go` imports `azuredevops` (already imported for `azuredevops.Provider()`), and calls `azuredevops.NewFrameworkProvider()`.

This is the correct long-term pattern for any new framework provider stub in this codebase: the entry point lives in `azuredevops/framework.go`, implementation in `azuredevops/internal/provider/`.

## Sources

- `_logs/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint/events.jsonl` (EV_mqkk0n6l, EV_mqkk11ts reasoning at seq 34-35 + seq 118; file.add `azuredevops/framework.go` at EV_mqkk1725)
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint.md`
- `projects/terraform-provider-betterado/azuredevops/framework.go`
