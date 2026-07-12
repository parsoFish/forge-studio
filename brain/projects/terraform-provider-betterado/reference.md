# terraform-provider-betterado — Reference

> Category index. Lists theme pages describing **system overviews, API shapes, external-surface profiles**.

`brain-lint` ensures every theme page with `category: reference` appears here exactly once.

## Theme pages

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```

### Auto-linked (re-file under a curated heading when convenient)

- [`2026-06-06-environment-templates-spike-findings`](./themes/2026-06-06-environment-templates-spike-findings.md) — GET /environmenttemplates via raw-HTTP on vsrm.dev.azure.com returns 200; create requires a full ReleaseDefinitionEnvironment blueprint (heaviest provider type); initiative parked.
- [`2026-06-06-release-definition-permissions-token-format`](./themes/2026-06-06-release-definition-permissions-token-format.md) — The ReleaseManagement2 token format is `{projectId}/{releaseDefinitionId}` — no namespace prefix; identical to the Build namespace. The manifest's hypothesised format was wrong.
- [`2026-06-11-process-parameters-no-live-roundtrip`](./themes/2026-06-11-process-parameters-no-live-roundtrip.md) — ADO does not reliably return ProcessParameters on basic pipeline definitions; it is consumed by task-group template inheritance, not stored as a per-definition field. Correct coverage is expand/flatten unit test only; a live round-trip test would assert against an ADO limitation.
- [`2026-06-11-vendor-unmarshal-patch-for-ado-enum-int`](./themes/2026-06-11-vendor-unmarshal-patch-for-ado-enum-int.md) — ADO returns daysToRelease as a JSON integer bitmask but the Go SDK declares ScheduleDays as a string enum. Raw vendor edit was the initial fix; now formalized as a tracked third_party/ fork with go.mod replace — survives go mod vendor regeneration.
- [`2026-06-18-provider-state-post-capstone`](./themes/2026-06-18-provider-state-post-capstone.md) — Snapshot of terraform-provider-betterado after the release/task-group capstone: net-new surface (release_definition/folder/permissions, task_group + data sources), writable-parity coverage posture, the block-vs-array limitation deferred to the framework migration, and the two-gate quality posture.
- [`2026-06-18-release-folder-gap-matrix-pattern`](./themes/2026-06-18-release-folder-gap-matrix-pattern.md) — The release_folder resource gap matrix (docs/release-folder-gap-matrix.md) + TestReleaseFolderGapMatrixAudit sentinel establishes the same API-coverage discipline as release_definition. WI-1 produced the matrix in 1 iteration; WI-2 added the live acc test TestAccReleaseFolder in 1 iteration. Both used the expected-fail gate pattern correctly.
- [`2026-06-20-framework-vendor-defaults-inline`](./themes/2026-06-20-framework-vendor-defaults-inline.md) — stringdefault, booldefault, int64default sub-packages are absent from the vendored terraform-plugin-framework; defaults must be inline structs. Default field also requires Computed true.
- [`2026-07-03-notification-subscription-framework-resource-pattern`](./themes/2026-07-03-notification-subscription-framework-resource-pattern.md) — Notification subscription resource is framework-native only; NotificationClient wired to AggregatedClient; flat schema (no TypeList filter block needed); validator stringvalidator.OneOf for channel_type.
- [`2026-07-03-wiki-wiki-page-api-shapes`](./themes/2026-07-03-wiki-wiki-page-api-shapes.md) — betterado_wiki_page Create requires versionType:"branch" + non-null version in the version descriptor; etag changes between Create and subsequent Read and must be suppressed from plan.
- [`2026-07-05-mux-free-cutover-complete`](./themes/2026-07-05-mux-free-cutover-complete.md) — The mux scaffold (tf6muxserver + tf5to6server) was removed; main.go now serves only the framework provider. All 16 remaining serviceendpoint types migrated in 5 WIs; provider.go ResourcesMap/DataSourcesMap empty.
- [`2026-07-10-framework-configure-pat-only-aad-gap`](./themes/2026-07-10-framework-configure-pat-only-aad-gap.md) — After the mux-free cutover the framework Configure() only wires PAT auth; AAD/OIDC/MSI/CLI schema attributes are accepted but non-functional — a pre-existing gap deferred as a follow-up initiative before any public 2.0.0 release.
- [`2026-07-11-framework-configure-auth-parity-complete`](./themes/2026-07-11-framework-configure-auth-parity-complete.md) — The pure-framework Configure() now resolves PAT/CLI/MSI/OIDC/client-secret/cert credentials with full ARM_*/AZDO_* env-var fallbacks, matching the SDKv2 GetAuthProvider() surface; auth.go helper is the shared unit-testable entry point.
