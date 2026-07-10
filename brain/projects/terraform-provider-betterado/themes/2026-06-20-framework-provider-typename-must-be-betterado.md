---
title: framework provider TypeName must be "betterado" not "azuredevops"
description: BetteradoFrameworkProvider.Metadata() must set TypeName = "betterado"; "azuredevops" causes tfplugindocs to emit wrong-prefixed resource docs.
category: antipattern
created_at: 2026-06-20
updated_at: 2026-06-20
---

## Summary

`azuredevops/internal/provider/framework_provider.go` — the `BetteradoFrameworkProvider.Metadata()` method sets `resp.TypeName`. If this is `"azuredevops"` instead of `"betterado"`, tfplugindocs generates docs for `azuredevops_release_definition` rather than `betterado_release_definition` (because resources that use `req.ProviderTypeName + "_release_definition"` derive their type name from it).

**Fix applied in this cycle:** `resp.TypeName = "betterado"` in `framework_provider.go`.

**Related:** Resources that hardcode `"betterado_task_group"` are unaffected; resources using `req.ProviderTypeName` need the provider TypeName to be correct.

**Watch out for:** `git stash` during test comparison will revert this file; re-apply after stash pop.

## Sources

- `_logs/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples/events.jsonl` — events 235-248 (discovery + fix), 541-546 (stash revert + re-fix)
- `/home/parso/forge/brain/cycles/_raw/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples.md`
