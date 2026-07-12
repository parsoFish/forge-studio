---
title: 'Provider registration & dedup discipline'
description: 'Topical index — Resource/data-source registration and the recurring "deregister AND delete" discipline: sdkv2 dead files left across cycles, duplicate-resource-type at apply, registration-file merge conflicts.'
category: reference
keywords: [provider, registration, dedup, index, topical-hub]
related_themes: [framework-migration-index, build-tooling-index]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

> **Topical index node.** Resource/data-source registration and the recurring "deregister AND delete" discipline: sdkv2 dead files left across cycles, duplicate-resource-type at apply, registration-file merge conflicts.

## Member themes (18)

- [[2026-06-07-provider-count-test-mandatory-pair]] — Every new data source added to betterado must also update TestProvider_HasChildDataSources — this count assertion has fired on 3 consecutive data-source additions.
- [[2026-06-20-framework-provider-typename-resource-naming]] — A framework resource whose Metadata sets resp.TypeName = req.ProviderTypeName + "_x" registers under the WRONG type unless the framework provider's Metadata().TypeName is "betterado". With it set to "azuredevops", release_definition registered as azuredevops_release_definition on main — unusable — and every unit/acc gate passed anyway.
- [[2026-06-20-framework-resource-registration-real-provider-tests]] — When registering a framework resource in framework_provider.go and removing the SDKv2 registration from provider.go, the WI must update TestProvider_HasChildResources (not a guessed name) so the expected resource count still matches.
- [[2026-07-01-dead-sdkv2-publisher-funcs-block-ci-gate-twice]] — >-
- [[2026-07-01-framework-datasource-registration-pattern]] — First-mover pattern for registering framework datasource.DataSource implementations in DataSources() — the release family (5 data-sources) establishes the template that all future data-source migrations copy.
- [[2026-07-01-pr50-committed-scratch-and-broken-squash-merge]] — Feed migration PR #50 (1) committed framework_validators.go, a 56MB test binary, and phantom demo citations (4th gitignored-scratch instance), and (2) the squash-merge shipped a broken main — CHANGELOG had raw conflict markers, two orphaned SDKv2 test files referenced deleted sources, feed package non-compiling for a day.
- [[2026-07-01-sdkv2-dead-files-deleted-graph-identity-cycle]] — Unlike 7 prior migration cycles, the graph+identity initiative deleted all superseded SDKv2 source files in the same WIs — clause 3b held without operator intervention.
- [[2026-07-01-sdkv2-deregister-omission-duplicate-resource-type]] — Registering a resource in framework_provider.go without removing it from provider.go ResourcesMap causes "Invalid Provider Server Combination: Duplicate resource type" at terraform apply — invisible to offline CI gates, only caught by live acceptance tests.
- [[2026-07-03-build-package-sdkv2-dead-files-not-deleted]] — All 5 build-package WIs migrated to framework without deleting the superseded SDKv2 .go files; profile.md clause 3b ("dedup = deregister AND delete") skipped for the third consecutive migration cycle.
- [[2026-07-03-multi-resource-provider-registration-coupling]] — When migrating 2+ resources in one initiative, any decomposition that puts each resource's migration in a separate WI will always fail the hidden-coupling check because all WIs must edit provider.go and framework_provider.go for deregistration/registration. Batch registration edits into one shared WI.
- [[2026-07-03-sdkv2-dead-file-deletion-unenforced]] — Checklist clause 3b (delete superseded SDKv2 files in the same WI) never enforced; dead resource_*.go + test files remain on every migration branch across 7+ cycles.
- [[2026-07-03-sdkv2-dead-files-5th-cycle-dashboard-extension]] — Ralph created framework .go files and deregistered from provider.go for betterado_dashboard and betterado_extension but did not delete the superseded SDKv2 source files; unifier UWI-4+ cleaned them up. Fifth consecutive migration cycle with this pattern.
- [[2026-07-03-sdkv2-dead-files-omission-4th-cycle]] — WI-2/3/4 each created a framework .go file and deregistered the SDKv2 type but did not delete the old implementation files; unifier UWI-2 was required to delete them, adding ~$3.1 cost. This is the 4th consecutive migration cycle with this pattern.
- [[2026-07-03-sdkv2-dead-files-serviceendpoint-7th-cycle-second-devloop-run]] — Serviceendpoint migration left 5 dead SDKv2 helper functions; unifier go-build failure forced a complete second dev-loop run of all 10 WIs (~$15-20 extra). This is the 7th framework-migration cycle with this omission; severity escalated from dead-code lint warnings to a build break.
- [[2026-07-03-sdkv2-dead-files-wiki-migration-6th-cycle]] — The wiki migration PR did not delete the superseded SDKv2 resource/data-source files despite profile.md checklist 3b; this is the 6th cycle where this omission has recurred.
- [[2026-07-05-serviceendpoint-jfrog-test-symbol-orphans]] — When the JFrog v2 serviceendpoint SDKv2 source was deleted, its unit test files still referenced helper variables and flatten functions by the old name; the package failed to build until Ralph added aliases.
- [[2026-07-10-operator-dead-code-sweep-post-roadmap]] — After the 24-initiative roadmap merged to 2.0.0, 113 orphaned SDKv2 files and a bloated commons.go required a manual operator sweep the dev-loop fleet couldn't execute due to weekly usage limits; no dev-loop iteration ever cleaned the entire package in one pass.
- [[2026-07-10-registration-file-merge-conflict-fan-in]] — When multiple framework-migration PRs touch provider.go / framework_provider.go / provider_test.go concurrently, the second PR to merge goes CONFLICTING; naive union-patch produces duplicate map keys that the operator must catch manually.

## See also

- [[framework-migration-index]] — Framework migration (SDKv2 → plugin-framework).
- [[build-tooling-index]] — Go / Terraform build & tooling discipline.
