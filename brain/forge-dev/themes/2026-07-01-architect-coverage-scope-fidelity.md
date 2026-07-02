---
title: Architect first-pass gaps on roadmap-scale migration plans — coverage closure, scope fidelity, invariant propagation
description: >-
  Judge review of the 2026-07-01 betterado architect session (23-initiative
  SDKv2→framework migration roadmap) found a repeatable class of first-pass
  defects a stronger architect FINALIZE step would catch pre-approval: no
  coverage-closure check (orphans strand the cutover), decomposition axis
  ignoring physical package layout (double-owned permissions resources), silent
  scope reduction vs an operator-approved enumerated set, load-bearing invariants
  left in the PLAN narrative instead of the drawers the dev-loop reads, and brain
  constraints not propagated into ACs. Root smell: 0 escalations on 23 initiatives.
category: reference
keywords:
  - architect-flow
  - coverage-closure
  - scope-fidelity
  - escalation-under-use
  - invariant-propagation
  - decomposition-vs-package-layout
  - finalize-completeness-critic
created_at: 2026-07-01T00:00:00.000Z
updated_at: 2026-07-01T00:00:00.000Z
related_themes:
  - framework-migration-capstone-arc
  - six-phases-of-forge
  - brain-read-policy
---

# Architect first-pass gaps on roadmap-scale migration plans

Operator built a roadmap-scale betterado plan via the architect (`_architect/2026-07-01T08-18-02`): 23 initiatives (16 SDKv2→framework migrations + 6 new-API + 1 mux-free cutover), then asked for an LLM-judge readiness pass before kickoff. The plan was **structurally excellent** (clean acyclic DAG, one pattern-setting first-mover, cutover as tail barrier; interview 4 rounds, brain-queried each round). But the review found a repeatable class of first-pass defects, each mapping to an architect-flow improvement. The unifying tell: **0 escalations on 23 initiatives** — ambiguity was resolved by silently choosing/dropping, not surfacing at the gate.

## Gap → architect-flow improvement

1. **No coverage-closure check → cutover-stranding orphans.** A "migrate everything, end mux-free" roadmap must be a *partition* of the registered surface, but the architect never diffed union-of-drawer-claims against `provider.go`. Residue owned by NO initiative: `servicehook_permissions`, `client_config` (ds), `serviceendpoint_permissions`, the whole `release_definition` **data-source** family + `task_group` ds (prior capstone migrated the *resources*, left the data sources SDKv2). → FINALIZE must diff `registered − ⋃ scopes` over **both** ResourcesMap and DataSourcesMap, emitting the remainder as deferrals/escalations.

2. **Decomposition axis ignored physical package layout → double-ownership.** Operator chose "per API area", but `*_permissions` resources live in one cross-cutting `internal/service/permissions/` package; the architect listed 5 under BOTH the feature-area drawer AND `security-permissions` → two *parallel* initiatives migrating the same file. → When the semantic axis diverges from package layout, assign each package one owner and assert **pairwise-disjoint scopes**.

3. **Silent scope reduction (highest-value fix).** Round-1 approved "all mocked APIs" (enumerated, incl. `test`); plan emitted 7 of 8, `test` dropped, mock present, no note. → Keep a **scope ledger** tracing every item of an approved enumerated answer to an initiative or explicit deferral; a gap is an escalation by construction.

4. **Invariants left in the narrative, not the drawers.** "Everything ends framework-native, mux-free" lived in the prose brief; the 6 new-API drawers named no registration seam. The dev-loop reads only the drawer, so a dev pattern-matches the still-live SDKv2 `provider.go` and cutover later drops the resource. → Propagate cross-cutting invariants DOWN into every affected drawer's ACs, and completeness-check dependency edges (the cutover barrier must depend on every initiative that adds/moves a registered resource — it didn't gate on new-API).

5. **Brain constraints not propagated into ACs.** The architect brain-queried each round yet `core`'s AC-2 demands a live test for `betterado_project` (whose CRUD creates a project) while the brain carries a hard "never create a project in TF_ACC" rule (org at the 1000-project cap). → Brain-read is a source of AC-shaping constraints, not just background.

**Cross-cutting — AC specificity + risk budgeting.** Only the first-mover had bespoke ACs; the other 15 migration drawers were template-cloned (unpinned "all TestAcc pass" glob, one-line evidence boilerplate, unnamed CI command), and the biggest/riskiest unit (serviceendpoint, 30+ types, live-tests only 4) was not flagged as a split candidate. → Specialise ACs per initiative, size budgets to real resource counts, surface the highest-risk unit.

## The one structural fix

Add a **completeness-critic pass to the architect FINALIZE step** — an adversarial self-review before the PLAN gate asking *what did I drop, double-count, leave ambiguous, or leave in the narrative instead of the drawers?* Concretely: coverage diff over both maps, pairwise-disjoint scope assertion, scope-ledger vs interview answers, invariant + dependency completeness. This is the external judge pass the operator ran manually; in finalize it converts gaps 1–4 into escalations resolved at the gate.

## Sources
- `projects/terraform-provider-betterado/_architect/2026-07-01T08-18-02/` (PLAN.md, answers.json); `_queue/pending/INIT-2026-07-01-*.md`; readiness workflow `wf_a6a86ccf-f4b`
- Live-acc constraint: `brain/projects/terraform-provider-betterado/themes/2026-06-20-ado-org-project-limit-blocks-test-creates.md`
