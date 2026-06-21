---
title: Framework provider Metadata.TypeName must equal the registry provider name ("betterado"), or derived resources mis-register
description: A framework resource whose Metadata sets resp.TypeName = req.ProviderTypeName + "_x" registers under the WRONG type unless the framework provider's Metadata().TypeName is "betterado". With it set to "azuredevops", release_definition registered as azuredevops_release_definition on main — unusable — and every unit/acc gate passed anyway.
category: antipattern
created_at: 2026-06-20T00:00:00.000Z
updated_at: 2026-06-20T00:00:00.000Z
---

## The bug (shipped to main, caught by the docs cycle)

`BetteradoFrameworkProvider.Metadata()` set `resp.TypeName = "azuredevops"`.
The framework `release_definition` resource derives its own type:

```go
func (r *releaseDefinitionFrameworkResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_release_definition"   // ← ProviderTypeName comes from the provider's Metadata().TypeName
}
```

So the muxed provider registered **`azuredevops_release_definition`**, not
`betterado_release_definition`. `terraform providers schema -json` on origin/main
confirmed it. A consumer writing `resource "betterado_release_definition"` would
get **"resource type not found"** — the headline framework migration was unusable
on main. Fix: `BetteradoFrameworkProvider.Metadata()` → `resp.TypeName = "betterado"`.

`task_group` was unaffected because it **hardcodes** `resp.TypeName =
"betterado_task_group"`. That inconsistency (one resource hardcodes, the other
derives) is exactly what let the bug hide.

## Why every gate missed it

- **Unit test** `framework_provider_test.go` *injected* `MetadataRequest{ProviderTypeName:"betterado"}`
  — it asserted a value the running provider never supplies. An injected-dependency
  unit test can NEVER catch a wrong provider-level `TypeName`.
- **Live acceptance** (#30) genuinely created a release definition live (demo.json
  has the REST GET of definition id 2) — but during a transient dev state; the
  final squashed/cleanup commits regressed `TypeName` to "azuredevops" after the
  gate ran.

## Rules

1. The framework provider's `Metadata().TypeName` MUST equal the registry provider
   name (`betterado`) — `main.go` serves
   `registry.terraform.io/parsoFish/betterado`.
2. Prefer ONE naming convention across all framework resources (all hardcode
   `betterado_*`, or all derive from `req.ProviderTypeName`) so an inconsistency
   can't mask a regression.
3. **Verification that actually binds:** a registration WI's gate must run
   `terraform providers schema -json` (dev_overrides to the freshly built binary)
   and assert the resource-type keys include the expected `betterado_*` names —
   NOT a unit test that injects `ProviderTypeName`. This is the only check that
   sees what terraform actually sees.

## Sources

- `terraform providers schema -json` on origin/main pre-fix (azuredevops_release_definition)
  and post-fix (betterado_release_definition) — the decisive proof
- PR #32 (docs/examples cycle) — `make docs` introspection surfaced the wrong filename
- `azuredevops/internal/service/release/resource_release_definition_framework.go:378`
  (derived) vs `azuredevops/internal/service/taskagent/resource_task_group_framework.go:143` (hardcoded)
