---
title: "tfplugindocs TypeName must match the desired provider prefix"
description: "framework_provider.go Metadata() must return TypeName matching the re-branded provider name; wrong value produces double-prefixed resource names and fails make docs."
category: pattern
created_at: 2026-06-20
updated_at: 2026-06-20
---

## Context

`BetteradoFrameworkProvider.Metadata()` sets `resp.TypeName`. `tfplugindocs generate` uses this value as the provider prefix when deriving resource type names. Each framework resource's own `Metadata()` appends `_<resource-suffix>` to `p.typeNamePrefix`.

## Problem

The provider was initialised with `TypeName = "azuredevops"` (the upstream fork value). When `make docs` ran, tfplugindocs registered `betterado_release_definition` under the type name `azuredevops_release_definition`. The docs generator then looked for a template named `betterado_azuredevops_release_definition.md.tmpl` — a double-prefixed name — which does not exist, failing the build.

## Fix

Single-line change in `azuredevops/internal/provider/framework_provider.go`:

```go
// Before
resp.TypeName = "azuredevops"

// After
resp.TypeName = "betterado"
```

Update `framework_provider_test.go` to assert `"betterado_task_group"` not `"azuredevops_task_group"`.

## Why this matters

Any future framework resource added to this provider will silently produce the wrong type name unless the TypeName is correct. `make docs` is the canary — if it exits non-zero, check TypeName first.

## Sources

- `_logs/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples/events.jsonl` — EV_mqm1bz3m iteration metadata, `last_assistant_text` in WI-1 summary
- `/home/parso/forge/brain/cycles/_raw/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples.md`
