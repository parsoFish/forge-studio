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

Operator-driven (Claude as operator; forge phases do the work) migration of the
two richest betterado resources to terraform-plugin-framework so nested
collections become `ListNestedAttribute` arrays with optional/typed-default
members (partial arrays, no null-filling — SDKv2 can't). Mux
(`tf5to6server.UpgradeServer` + `tf6muxserver`, protocol 6). **5 cycles, ~$207,
all merged** (#28 mux, #29 task_group, #30 release_definition, #31
state-upgraders + v1.0.0, #32 docs/examples/roadmap).

## The four forge fixes (branch `feat/per-run-cost-ceiling`)

1. **Per-run cost-ceiling override** (488f9d0). `flow.yaml costCeilingUsd:25` was
   the SOLE authority; a real cycle hard-stopped at $25 at the first node
   boundary. Added manifest `cost_ceiling_usd` + `FORGE_COST_CEILING_USD` env
   (env ?? manifest ?? flow).
2. **Env CI gate/fix timeouts** (1b3603f) — `FORGE_CI_GATE_TIMEOUT_MS` /
   `_FIX_`; a go1.25 + golangci-v2 gate needs minutes.
3+4. **ArtifactRoot-resolved demo paths** (d23df95, 4a743ef). The unifier
   `pr_self_contained` gate and PR-open prereq hardcoded `demo/<id>`; a project
   with `artifactRoot:"forge"` writes `forge/history/<id>/demo`, so both reported
   the demo "missing." Fix: `projectDemoRelDir(id, readArtifactRoot(root))`.

## TF_ACC-inheritance off-rails (root-caused, code-fix deferred)

The docs cycle's manifest scoped its gate `make test` "(no TF_ACC)", yet the
per-WI gate is forge-spawned via `runGateCapturing` with env
`{...secrets, ...process.env}` — inheriting the serve env's `TF_ACC=1`. `make
test` then ran the full live acc suite, exhausting the ADO quota and sending the
dev off-rails editing acc fixtures in a docs cycle. The final ci-gate strips
`TF_ACC` (`ci_gate_unset_env`); the per-WI gate does not. Fix candidate: a per-WI
gate whose command doesn't target the acc suite should strip `ci_gate_unset_env`
too. Workaround used: run offline cycles with `TF_ACC` unset.

## Load-bearing lesson — a passing live acc test does NOT prove the merged surface

`release_definition` shipped **mis-named on main**. Its framework Metadata
derives `req.ProviderTypeName + "_release_definition"`, and the provider's
`Metadata().TypeName` was `"azuredevops"` → the muxed provider registered
**`azuredevops_release_definition`**, not `betterado_release_definition`
(`terraform providers schema -json` proved it). The flagship resource was
unusable, yet every gate passed:

- the unit test *injected* `ProviderTypeName:"betterado"` — it can never catch a
  wrong provider-level value;
- #30's live acc test genuinely created a release def (demo REST GET, id 2) but in
  a transient dev state; squash/"drop forge scratch" cleanup left
  `TypeName="azuredevops"` after the gate ran;
- `task_group` hardcodes its name, so it was fine — the inconsistency hid the bug.

Caught only by the docs cycle's `make docs` (tfplugindocs introspects the real
schema). Rules: (a) registration/naming WIs must gate on the end-to-end registered
surface (`terraform providers schema` resource-type keys), not an injected unit
test; (b) re-run the decisive gate on the FINAL post-cleanup tip, or forbid
behaviour-changing cleanup after the gate; (c) keep one naming convention across
resources (all hardcode or all derive) so one can't mask another.

## Operational + recovery

- **Bridge merge-verdict returns empty but SUCCEEDS** — verify by PR/queue state,
  don't blind-retry (the retry got "already resolved").
- **Classifier guards destructive infra + cycle-discard** — `make sweep` and
  `forge requeue` (deletes branch) require explicit operator authorization;
  escalate, don't work around.
- **Chronic ADO 1000-project quota** blocks live acceptance org-wide; `make sweep`
  only reaps `test-acc-*/AccTest*` (deleted 0 once exhausted). A live cycle
  running the full acc suite accelerates it.
- `forge requeue --resume-from=unifier` preserves worktree+commits; plain requeue
  DELETES the branch (only OK with zero commits + authorization).

## Sources

- `_logs/2026-06-*framework-*`; betterado PRs #28–#32
- `feat/per-run-cost-ceiling`: 488f9d0, 1b3603f, d23df95, 4a743ef
- betterado Brain 3: `forge/brain/themes/2026-06-20-framework-provider-typename-resource-naming.md`
