---
title: 'PM decomposition failures'
description: 'Topical index — Project-manager planning failure modes: error_max_turns, scope-drop under turn budget, hidden-coupling repeats, WI-spec fidelity / stale fixture refs, invented gate names, redecompose-collapses-scope, coarse batch WIs.'
category: reference
keywords: [pm, decomposition, index, topical-hub]
related_themes: [ralph-brain-reads-index, cycle-recovery-index]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

> **Topical index node.** Project-manager planning failure modes: error_max_turns, scope-drop under turn budget, hidden-coupling repeats, WI-spec fidelity / stale fixture refs, invented gate names, redecompose-collapses-scope, coarse batch WIs.

## Member themes (18)

- [[2026-06-06-data-source-split-read-only-pattern]] — Release data sources proved that per-data-source WI (single-lookup + list as separate WIs) is the right default; first WI pays scaffolding cost, siblings are cheap.
- [[2026-06-06-spike-wi-scope-bleed-into-successor]] — WI-1 (token spike) wrote the full permissions implementation AND tests, so WI-2 (impl) was already-complete at iter-0 ($0, zero tool use) — the WI boundary was ceremonial.
- [[2026-06-11-linear-dep-chain-crash-cascade]] — A 5-WI fully sequential dependency chain (WI-1 → WI-2 → ... → WI-5) caused 0/5 delivery when WI-1 crashed twice; all 4 downstream WIs skipped as prerequisite-failed. Re-decomposed to 2 WIs on resume — same scope, delivered in 1 iteration each.
- [[2026-06-11-resume-pm-redecompose-collapses-scope]] — When Run 1 produced a 5-WI over-granular linear chain that crashed, the resume PM run re-decomposed to 2 WIs covering identical scope. Both WIs passed at iteration 1. PM correctly identified AC consolidation without operator hand-holding.
- [[2026-06-18-pm-wi-spec-fixture-new-project-violation]] — PM decomposition for WI-2 (task-group-coverage) generated sample HCL using resource "betterado_project" — a new ADO project create — violating the org project-cap constraint. Ralph self-corrected silently by reading existing tests.
- [[2026-06-18-wi-spec-stale-fixture-field-ref]] — WI-5 spec explicitly named fixture.BuildDefinitionAlias as the field to use for container_image_trigger artifact_alias, but that field does not exist on SharedFixtureResult; agent detected the mismatch via grep and substituted "_build".
- [[2026-06-20-pm-invented-gate-test-name]] — PM invented TestProvider_HasCorrectResources in quality_gate_cmd; forge no-work guard fired 5 times causing WI-2 to exhaust its iteration budget and the pipeline to dead-end.
- [[2026-07-03-decomposition-completeness-annotation-worked]] — A "Decomposition completeness contract" prose annotation added to the initiative manifest by the operator (2026-07-02) successfully prevented PM from dropping in-scope types; all 30+ serviceendpoint types were covered in 10 WIs — contrasting with the prior run that dropped 15 types.
- [[2026-07-03-multi-resource-provider-registration-coupling]] — When migrating 2+ resources in one initiative, any decomposition that puts each resource's migration in a separate WI will always fail the hidden-coupling check because all WIs must edit provider.go and framework_provider.go for deregistration/registration. Batch registration edits into one shared WI.
- [[2026-07-03-pm-max-turns-graph-identity-13type-scope]] — PM hit error_max_turns twice before producing 7 WIs for the graph+identity migration (2 resources + 11 data sources); the large scope caused turn-budget exhaustion before decomposition was committed.
- [[2026-07-03-pm-max-turns-on-wiki-migration-initiative]] — First PM run for the wiki migration hit error_max_turns before writing any WI files; required operator re-queue; second run succeeded in 3.8 min by writing sooner.
- [[2026-07-03-pm-scope-drop-under-max-turns]] — PM exhausted its turn budget before verifying all in-scope resources had a covering WI; betterado_extension (the headline resource) was absent from the first two valid decompositions. Operator manifest annotation was the unblock.
- [[2026-07-03-pm-spec-wrong-sdk-param-causes-extra-wi-iterations]] — When a PM work-item specifies an ADO SDK parameter value without verifying the SDK source, the dev-loop agent must spend 1-2 extra iterations re-deriving the correct value from vendor source. Seen with UserScope in the FeatureManagement WI-3/WI-4 pair.
- [[2026-07-04-permissions-batch-wi-too-coarse]] — WI-4 migrated all 13 betterado_*_permissions types in one work item; 4 dev-loop iterations in run 1, re-ran entirely in run 2; gap-matrix coverage for individual types was implicit, not verified per-type.
- [[2026-07-05-new-package-7wi-decomposition-pattern]] — Gap-matrix → client-wiring → resource → data-source → provider-registration → acceptance-test → changelog decomposition for a brand-new API package; every WI passed first iteration.
- [[2026-07-05-pm-hidden-coupling-repeats-despite-operator-guidance]] — PM produced framework_provider.go shared-file violations in run 3 despite an operator annotation listing the exact rule; only the 4th run succeeded — operator guidance must name the shared file explicitly AND the coupling gate must exist.
- [[2026-07-05-pm-max-turns-large-package-migration]] — >-
- [[2026-07-05-pm-turn-budget-exhausted-multi-resource-migration]] — PM hit error_max_turns twice on the 11-WI taskagent migration; hidden-coupling validation over 8+ shared-file resource types consumed the full budget before WIs were written.

## See also

- [[ralph-brain-reads-index]] — Zero-brain-reads (dev-loop re-derivation).
- [[cycle-recovery-index]] — Cycle recovery & crash resilience.
