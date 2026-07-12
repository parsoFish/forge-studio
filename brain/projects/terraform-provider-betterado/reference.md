# terraform-provider-betterado — Reference

> Category index. Lists theme pages describing **system overviews, API shapes, external-surface profiles, and topical index nodes**.

`brain-lint` ensures every theme page with `category: reference` appears here exactly once.

## Theme pages

### Topical indexes

- [`ado-api-shapes-index`](./themes/ado-api-shapes-index.md) — Topical index — Azure DevOps REST API shapes and quirks: release-definition permission token format, process parameters, wiki page API shapes, feature-management host, feed soft-delete, process-is-enabled quirk, enum-int unmarshal, extra response fields.
- [`build-tooling-index`](./themes/build-tooling-index.md) — Topical index — Go module/vendor/build and Terraform tooling traps: go internal-package import, vendor-before-tidy, tfplugindocs typename, terrafmt coverage gaps, make docs/test traps, python brace tracer, unused-func lint gaps.
- [`configure-auth-index`](./themes/configure-auth-index.md) — Topical index — Provider Configure() wiring and auth parity (PAT/AAD/CLI/MSI/OIDC/cert): az-cli token probe, wrong-tenant fallback, in-process provider injection, the PAT-only AAD gap.
- [`cycle-recovery-index`](./themes/cycle-recovery-index.md) — Topical index — Crash resilience and resume: agent-crash-work-survives, unifier rescue / incomplete-delivery resumes, linear-dep-chain crash cascade, rate-limit crash cascade, stale event-ids after CI fix, report-diff stale on resume.
- [`fixture-discipline-index`](./themes/fixture-discipline-index.md) — Topical index — Shared-fixture reuse, the ADO org project cap / soft-delete trap, CheckDestroy, never-create-projects-in-tests, and per-field fixture validity.
- [`framework-migration-index`](./themes/framework-migration-index.md) — Topical index — Per-resource SDKv2→plugin-framework migration mechanics: schema shapes, Validators: parity, Configure() under mux, state upgraders, null-vs-empty optional attrs, plan modifiers, ConfigMode, vendor defaults, mux scaffolding.
- [`gate-mechanics-index`](./themes/gate-mechanics-index.md) — Topical index — How the per-WI and CI quality gates behave and get gamed: hollow/SKIP=pass gates, skip semantics, skipf evasion, expected-fail-forces-test-write, partial-acc subset, compile-only gate, doc gate, live vs offline.
- [`live-evidence-demo-index`](./themes/live-evidence-demo-index.md) — Topical index — demo.json live-evidence capture: per-type CaptureLiveEvidence labels, phantom/test-name citations, evidence-id must match branch, blind iteration without captured gate output.
- [`pm-decomposition-index`](./themes/pm-decomposition-index.md) — Topical index — Project-manager planning failure modes: error_max_turns, scope-drop under turn budget, hidden-coupling repeats, WI-spec fidelity / stale fixture refs, invented gate names, redecompose-collapses-scope, coarse batch WIs.
- [`provider-registration-dedup-index`](./themes/provider-registration-dedup-index.md) — Topical index — Resource/data-source registration and the recurring "deregister AND delete" discipline: sdkv2 dead files left across cycles, duplicate-resource-type at apply, registration-file merge conflicts.
- [`ralph-brain-reads-index`](./themes/ralph-brain-reads-index.md) — Topical index — The recurring observation that the dev-loop (Ralph) re-derives documented gotchas instead of reading the brain — patterns paid for again and again.
- [`resource-datasource-patterns-index`](./themes/resource-datasource-patterns-index.md) — Topical index — Reusable framework resource and data-source implementation patterns: data-source reader/split, 404-read drives, notification-subscription, policy helper, servicehook null/empty, serviceendpoint state-for-unknown, accounts-profile.

### Framework migration (SDKv2 → plugin-framework)

- [`2026-06-18-provider-state-post-capstone`](./themes/2026-06-18-provider-state-post-capstone.md) — Snapshot of terraform-provider-betterado after the release/task-group capstone: net-new surface (release_definition/folder/permissions, task_group + data sources), writable-parity coverage posture, the block-vs-array limitation deferred to the framework migration, and the two-gate quality posture.
- [`2026-06-20-framework-vendor-defaults-inline`](./themes/2026-06-20-framework-vendor-defaults-inline.md) — stringdefault, booldefault, int64default sub-packages are absent from the vendored terraform-plugin-framework; defaults must be inline structs. Default field also requires Computed true.
- [`2026-07-05-mux-free-cutover-complete`](./themes/2026-07-05-mux-free-cutover-complete.md) — The mux scaffold (tf6muxserver + tf5to6server) was removed; main.go now serves only the framework provider. All 16 remaining serviceendpoint types migrated in 5 WIs; provider.go ResourcesMap/DataSourcesMap empty.

### Provider Configure() & auth parity

- [`2026-07-10-framework-configure-pat-only-aad-gap`](./themes/2026-07-10-framework-configure-pat-only-aad-gap.md) — After the mux-free cutover the framework Configure() only wires PAT auth; AAD/OIDC/MSI/CLI schema attributes are accepted but non-functional — a pre-existing gap deferred as a follow-up initiative before any public 2.0.0 release.
- [`2026-07-11-framework-configure-auth-parity-complete`](./themes/2026-07-11-framework-configure-auth-parity-complete.md) — The pure-framework Configure() now resolves PAT/CLI/MSI/OIDC/client-secret/cert credentials with full ARM_*/AZDO_* env-var fallbacks, matching the SDKv2 GetAuthProvider() surface; auth.go helper is the shared unit-testable entry point.

### Framework resource / data-source patterns

- [`2026-06-18-release-folder-gap-matrix-pattern`](./themes/2026-06-18-release-folder-gap-matrix-pattern.md) — The release_folder resource gap matrix (docs/release-folder-gap-matrix.md) + TestReleaseFolderGapMatrixAudit sentinel establishes the same API-coverage discipline as release_definition. WI-1 produced the matrix in 1 iteration; WI-2 added the live acc test TestAccReleaseFolder in 1 iteration. Both used the expected-fail gate pattern correctly.
- [`2026-07-03-notification-subscription-framework-resource-pattern`](./themes/2026-07-03-notification-subscription-framework-resource-pattern.md) — Notification subscription resource is framework-native only; NotificationClient wired to AggregatedClient; flat schema (no TypeList filter block needed); validator stringvalidator.OneOf for channel_type.

### ADO REST API shapes & quirks

- [`2026-06-06-environment-templates-spike-findings`](./themes/2026-06-06-environment-templates-spike-findings.md) — GET /environmenttemplates via raw-HTTP on vsrm.dev.azure.com returns 200; create requires a full ReleaseDefinitionEnvironment blueprint (heaviest provider type); initiative parked.
- [`2026-06-06-release-definition-permissions-token-format`](./themes/2026-06-06-release-definition-permissions-token-format.md) — The ReleaseManagement2 token format is `{projectId}/{releaseDefinitionId}` — no namespace prefix; identical to the Build namespace. The manifest's hypothesised format was wrong.
- [`2026-06-11-process-parameters-no-live-roundtrip`](./themes/2026-06-11-process-parameters-no-live-roundtrip.md) — ADO does not reliably return ProcessParameters on basic pipeline definitions; it is consumed by task-group template inheritance, not stored as a per-definition field. Correct coverage is expand/flatten unit test only; a live round-trip test would assert against an ADO limitation.
- [`2026-06-11-vendor-unmarshal-patch-for-ado-enum-int`](./themes/2026-06-11-vendor-unmarshal-patch-for-ado-enum-int.md) — ADO returns daysToRelease as a JSON integer bitmask but the Go SDK declares ScheduleDays as a string enum. Raw vendor edit was the initial fix; now formalized as a tracked third_party/ fork with go.mod replace — survives go mod vendor regeneration.
- [`2026-07-03-wiki-wiki-page-api-shapes`](./themes/2026-07-03-wiki-wiki-page-api-shapes.md) — betterado_wiki_page Create requires versionType:"branch" + non-null version in the version descriptor; etag changes between Create and subsequent Read and must be suppressed from plan.

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```
