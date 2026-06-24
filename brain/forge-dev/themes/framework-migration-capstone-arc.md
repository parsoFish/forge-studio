---
title: Framework-migration capstone (betterado SDKv2→plugin-framework) — forge fixes + the gate-gap that shipped a mis-named headline resource
description: >-
  Operator-driven 5-cycle migration of betterado_release_definition +
  betterado_task_group to terraform-plugin-framework (via mux). The four forge
  fixes it forced, the TF_ACC-inheritance off-rails, and the load-bearing
  lesson: a passing live acceptance test does NOT prove the merged provider
  surface — the flagship resource shipped registered under the wrong type name
  and every gate missed it.
category: reference
keywords:
  - terraform-plugin-framework
  - terraform-plugin-mux
  - provider-type-name
  - resource-registration
  - gate-gap
  - live-acceptance
  - cost-ceiling
  - artifactRoot
  - TF_ACC-inheritance
  - ado-project-quota
created_at: 2026-06-20T00:00:00.000Z
updated_at: 2026-06-20T00:00:00.000Z
---

## The arc

Operator-driven migration of betterado's two richest resources to terraform-plugin-framework for `ListNestedAttribute` arrays (SDKv2 limitation: no partial arrays). Mux via `tf5to6server.UpgradeServer` + `tf6muxserver` (protocol 6). **5 cycles, ~$207, all merged** (#28–#32).

## The four forge fixes (branch `feat/per-run-cost-ceiling`)

1. **Per-run cost-ceiling override** (488f9d0). Added manifest `cost_ceiling_usd` + env var (env ?? manifest ?? flow), overriding `flow.yaml` sole authority.
2. **Env CI gate/fix timeouts** (1b3603f). Added `FORGE_CI_GATE_TIMEOUT_MS` / `_FIX_` for extended gate windows (go1.25 + golangci-v2).
3. **ArtifactRoot-resolved demo paths** (d23df95, 4a743ef). Gates hardcoded `demo/<id>` but projects with `artifactRoot:"forge"` write `forge/history/<id>/demo`. Fix: use `projectDemoRelDir(id, readArtifactRoot(root))`.

## TF_ACC-inheritance off-rails

Docs cycle intended `make test` (no TF_ACC), but per-WI gates spawned via `runGateCapturing` inherit `process.env.TF_ACC=1`, running live acc suite and exhausting ADO quota. Root cause: per-WI gate doesn't strip `ci_gate_unset_env`. Workaround: run offline with `TF_ACC` unset.

## Load-bearing lesson — a passing live acc test does NOT prove the merged surface

`release_definition` shipped **mis-named**: provider's `Metadata().TypeName` was `"azuredevops"` not `"betterado"`, so it registered as `azuredevops_release_definition` (confirmed by `terraform providers schema -json`), rendering it unusable. Every gate passed because: unit tests inject `ProviderTypeName`, live acc ran in transient state (post-cleanup had wrong name), and `task_group` hardcodes its name (masking inconsistency). Caught only by `make docs` introspecting real schema. **Lesson**: (a) gate on end-to-end registered surface, not injected tests; (b) re-run decisive gate post-cleanup; (c) use one naming convention across resources.

## Operational + recovery

- **Bridge merge-verdict empty but SUCCEEDS**: verify by PR/queue state, don't blind-retry.
- **Classifier guards destructive infra**: `make sweep`, `forge requeue` require explicit authorization; escalate.
- **ADO 1000-project quota is soft-delete bin**: org showed 4 active but creates failed ("1000 projects"). `stateFilter=deleted` found 996 soft-deleted projects (28-day retention, hidden from portal). Durable fix: tests REUSE projects, never create. `make sweep` is counterproductive.
- **`forge requeue --resume-from=unifier`** preserves worktree+commits; plain requeue DELETES branch.

## Sources

- `_logs/2026-06-*framework-*`; betterado PRs #28–#32
- `feat/per-run-cost-ceiling`: 488f9d0, 1b3603f, d23df95, 4a743ef
- betterado Brain 3: `forge/brain/themes/2026-06-20-framework-provider-typename-resource-naming.md`
