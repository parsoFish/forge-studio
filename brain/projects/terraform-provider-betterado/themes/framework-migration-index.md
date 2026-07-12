---
title: 'Framework migration (SDKv2 → plugin-framework)'
description: 'Topical index — Per-resource SDKv2→plugin-framework migration mechanics: schema shapes, Validators: parity, Configure() under mux, state upgraders, null-vs-empty optional attrs, plan modifiers, ConfigMode, vendor defaults, mux scaffolding.'
category: reference
keywords: [framework, migration, index, topical-hub]
related_themes: [provider-registration-dedup-index, configure-auth-index, resource-datasource-patterns-index]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

> **Topical index node.** Per-resource SDKv2→plugin-framework migration mechanics: schema shapes, Validators: parity, Configure() under mux, state upgraders, null-vs-empty optional attrs, plan modifiers, ConfigMode, vendor defaults, mux scaffolding.

## Member themes (23)

- [[2026-06-17-configmode-attr-propagation-cascade]] — Adding ConfigMode:SchemaConfigModeAttr to a top-level block is not sufficient — every TypeList child in the hierarchy must also carry it, or HCL validation rejects any fixture that omits Optional sub-block attributes.
- [[2026-06-17-null-attr-fixture-template-configmode-attr]] — Under SchemaConfigModeAttr (array syntax), every Optional attribute in every TypeList element must be set to null in the HCL fixture — omitting them produces HCL validation errors, unlike block syntax where Optional sub-blocks can be absent.
- [[2026-06-18-provider-state-post-capstone]] — Snapshot of terraform-provider-betterado after the release/task-group capstone: net-new surface (release_definition/folder/permissions, task_group + data sources), writable-parity coverage posture, the block-vs-array limitation deferred to the framework migration, and the two-gate quality posture.
- [[2026-06-19-mux-scaffold-architecture]] — The mux scaffold wraps the SDKv2 provider via tf5to6server.UpgradeServer, muxes it with the framework provider via tf6muxserver.NewMuxServer, and serves via tf6server.Serve. Extension points are in azuredevops/internal/provider/framework_provider.go.
- [[2026-06-20-framework-acceptance-test-hcl-array-syntax]] — When betterado_task_group migrates from SDKv2 TypeList blocks to framework ListNestedAttribute, all acceptance test HCL must change from block syntax (task { … }) to array-attribute syntax (task = [{ … }]).
- [[2026-06-20-framework-configure-stub-mux-timebomb]] — BetteradoFrameworkProvider.Configure() was a no-op stub after the mux-entrypoint cycle; WI-3 discovered this when GetProvider().Meta() returned nil under ProtoV6ProviderFactories.
- [[2026-06-20-framework-provider-typename-resource-naming]] — A framework resource whose Metadata sets resp.TypeName = req.ProviderTypeName + "_x" registers under the WRONG type unless the framework provider's Metadata().TypeName is "betterado". With it set to "azuredevops", release_definition registered as azuredevops_release_definition on main — unusable — and every unit/acc gate passed anyway.
- [[2026-06-20-framework-resource-registration-real-provider-tests]] — When registering a framework resource in framework_provider.go and removing the SDKv2 registration from provider.go, the WI must update TestProvider_HasChildResources (not a guessed name) so the expected resource count still matches.
- [[2026-06-20-framework-state-upgrader-v0-pattern]] — Pattern for wiring StateVersion=1 and a V0→V1 upgrader into plugin-framework resources in this provider; includes file layout, upgrade function signature, and unit test shape.
- [[2026-06-20-framework-vendor-defaults-inline]] — stringdefault, booldefault, int64default sub-packages are absent from the vendored terraform-plugin-framework; defaults must be inline structs. Default field also requires Computed true.
- [[2026-06-20-release-definition-revision-idempotency]] — TestAccReleaseDefinition_basic fails live on revision — no-op re-plan shows `revision = N -> (known after apply)` (Step 4, non-empty plan). UseStateForUnknown fixes the no-op but breaks the update step (Step 6 "inconsistent result after apply") because ADO bumps revision on every update. Needs a proper Read/flatten + plan design, not a one-line modifier. NOT yet fixed.
- [[2026-07-01-framework-optional-attr-unknown-after-apply]] — Framework resources migrated from SDKv2 return "Provider returned invalid result object after apply — unknown value" for optional attrs that were Computed+Optional in SDKv2; fix is UseStateForUnknown plan modifier or equivalent.
- [[2026-07-01-framework-permission-values-must-be-lowercase]] — betterado_release_definition_permissions framework resource stores plan values verbatim (no post-Create Read); HCL test config must use lowercase "allow"/"deny"/"notset" matching PermissionTypeValues constants or TestCheckResourceAttr assertions fail.
- [[2026-07-01-framework-validators-library-adoption]] — The graph+identity migration replaced the hand-rolled validators.go with the official terraform-plugin-framework-validators library; go.mod + vendor updated in-WI; 7 offline unit tests confirm conflict-triangle and mode-enum validators.
- [[2026-07-01-mux-testutils-nil-meta-pattern]] — testutils helpers that call GetProvider().Meta().(*client.AggregatedClient) panic under GetMuxedProviderFactories() because the SDKv2 provider singleton's Meta() is nil in the mux path; replace with getADOClientsFromEnv() pattern.
- [[2026-07-03-framework-config-validator-pattern-re-derived]] — The terraform-plugin-framework config-validator API (ConflictsWith/RequiredWith/ExactlyOneOf equivalents) is re-explored from vendor/ each time, adding ~8 bash calls per run; the pattern should be recorded in profile.md or WI spec ACs.
- [[2026-07-03-framework-null-vs-empty-string-optional-attrs]] — Absent optional string attributes are StringNull() in framework, not StringValue(""); SDKv2 normalised both to "" causing drift on plan diff when switching.
- [[2026-07-03-inline-plan-modifier-pattern-re-derived-per-wi]] — The vendored terraform-plugin-framework does not include stringplanmodifier/int64planmodifier sub-packages; ralph re-explores vendor/ for this fact every WI because AGENT.md knowledge doesn't survive between isolated ralph sessions.
- [[2026-07-04-framework-migration-drops-sdkv2-validators-silently]] — Two independent initiatives (git PR #46, security-permissions PR #48) delivered framework resources with 0 of the SDKv2 IsUUID/StringIsNotWhiteSpace/OneOf validators; the per-WI live-acc gate does not enforce validator parity; the gap surfaces at review.
- [[2026-07-04-security-permissions-framework-migration-complete]] — Full SDKv2→framework migration of betterado_security_permissions, betterado_security_namespace*, betterado_securityrole_assignment, betterado_securityrole_definitions, and all 13 betterado_*_permissions types merged as PR #48; gap matrices produced for all three API areas.
- [[2026-07-05-framework-migration-checklist-not-in-wi-specs]] — >-
- [[2026-07-05-mux-free-cutover-complete]] — The mux scaffold (tf6muxserver + tf5to6server) was removed; main.go now serves only the framework provider. All 16 remaining serviceendpoint types migrated in 5 WIs; provider.go ResourcesMap/DataSourcesMap empty.
- [[2026-07-10-build-definition-facade-migration-schema-only]] — build_definition framework migration passed all automated gates but expand/flatten was unwired; apply had zero API effect; caught only by operator review.

## See also

- [[provider-registration-dedup-index]] — Provider registration & dedup discipline.
- [[configure-auth-index]] — Provider Configure() & auth parity.
- [[resource-datasource-patterns-index]] — Framework resource / data-source patterns.
