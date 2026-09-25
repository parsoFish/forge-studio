# Roadmap — terraform-provider-betterado

North star: a feature-complete Azure DevOps provider with data + resources for
every ADO API surface. The fork's active frontier is the **net-new resource
types** (classic release pipelines + task groups); upstream resources are
inherited and out of scope.

Detailed API mappings live in `docs/api-reference/`, the release_definition gap
matrix in `docs/release-definition-gap-matrix.md`, and prior development history
(plans + demos) in `forge/history/`.

## Current frontier — release & task-group refinement

Bring **every** net-new resource type to the same level of API-coverage review
the release_definition surface already has (a field-by-field gap matrix vs the
ADO REST schema), implement the writable gaps, and make the generated Terraform
read naturally. Sequenced so the breaking `stages` refactor lands before the
coverage work touches the same schema.

### INIT-1 — `stages` readability refactor (release_definition) · breaking
Rename the release_definition `environment` block (which actually models
pipeline **stages**) to `stages`, and convert the nested block collections to
assignable **list-of-object attributes** (`ConfigMode: SchemaConfigModeAttr`) so
they can be written as arrays (`stages = [ { … }, { … } ]`) and manipulated with
HCL `for`/`concat` expressions. Apply the same array treatment to the other
nested block collections where it improves readability (deploy_phase, artifact,
variable, …). Breaking change, no back-compat alias. Bundle: schema + expand/
flatten + unit tests + examples + docs + a live `TF_ACC` acceptance test + a
live-evidence demo.

### INIT-2 — release_definition coverage completion
Implement the 8 known writable gaps from the gap matrix: `environmentTriggers`,
artifact-trigger `tags` / `createReleaseOnBuildTagging`, `workflowTask`
`timeoutInMinutes` / `retryCountOnTaskFailure`, `deploymentInput`
`overrideInputs`, and `containerImageTrigger`. Refresh the gap matrix to ≥
parity. Bundle includes fixtures + live acceptance + demo.

### INIT-3 — task_group coverage review + completion
Produce a `docs/task-group-gap-matrix.md` (every API field vs the schema), then
implement every writable gap found. Bundle includes fixtures + live acceptance +
demo.

### INIT-4 — release_folder coverage review + completion
Produce `docs/release-folder-gap-matrix.md`, implement every writable gap.
Bundle includes fixtures + live acceptance + demo.

### INIT-5 — release_definition_permissions coverage review + completion
Produce `docs/release-definition-permissions-gap-matrix.md`, implement every
writable gap. Bundle includes fixtures + live acceptance + demo.

## Future: holistic terraform-plugin-framework migration

`stages` (and other nested collections) stay as **blocks** for now. True
array-structured nested attributes with omittable/defaulted fields (`stages = [{
name = "Prod" }]`, rest left blank) are impossible in SDKv2 — `ConfigMode:Attr`
forces consumers to null-fill every nested attribute at every level. The clean
path is `terraform-plugin-framework` (`ListNestedAttribute` + typed defaults).
Scoped as a **separate, holistic, roadmap-scale initiative**: migrate the whole
provider SDKv2 → Framework (incrementally via `terraform-plugin-mux` during the
transition, ending mux-free), not a permanent releases-only partial. Tracked here;
not part of the current refinement frontier.

### Phase 1 — completed this release cycle

`betterado_release_definition` and `betterado_task_group` have been migrated to
`terraform-plugin-framework`. The `terraform-plugin-mux` scaffold introduced in
the framework-migration initiative (`INIT-2026-06-19-framework-state-upgraders`)
is the **extension point** for wiring additional resources: each new resource
registers its `resource.Resource` / `datasource.DataSource` implementation in the
framework provider, and the mux router transparently routes traffic between SDKv2
and framework resources during the incremental migration.

### Phase 2 — remaining candidates

The following SDKv2 resources are queued as phase-2 migration candidates once the
phase-1 pattern is validated:

- `betterado_release_folder`
- `betterado_release_definition_permissions`
- Upstream-inherited resources (build definitions, repositories, service
  endpoints, policies, and other ADO surfaces carried from the upstream fork)

## Standing definition of done (per initiative)

Two-gate model (see `.forge/project.json` standing ACs + `forge/brain/profile.md`):
a `TF_ACC` live-acceptance test against real ADO **and** the CI-equivalent gate
(`make test` + `golangci-lint` + `terrafmt-check`) green, with a live-evidence
demo (API GET of the created resource, not a test-name table) and the initiative's
plan + demo recorded under `forge/history/<initiative-id>/`.
