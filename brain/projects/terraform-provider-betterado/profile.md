# terraform-provider-betterado — project brain (Brain 3, profile)

> The PM/architect reads this first when planning an initiative. It is the
> queryable structure of the project: what it is, how it's built, the
> conventions that must hold, and the gotchas that have bitten before.

## What this is

A **GitHub fork** of `microsoft/terraform-provider-azuredevops` that adds the
resources Microsoft never shipped — chiefly **classic release pipelines** (the
`vsrm.dev.azure.com` Release API) — on top of the full upstream provider. The
fork's working branch is `main` (it carries all betterado work); upstream is
pulled via `git merge upstream/main`. North star: a feature-complete ADO
provider with data + resources for every ADO API surface.

- Language: **Go**, Terraform Plugin SDK **v2**. Module `github.com/parsoFish/terraform-provider-betterado`.
- Resource prefix `betterado_`. API version 7.1, PAT auth (`AZDO_PERSONAL_ACCESS_TOKEN`).
- Two API hosts: core `dev.azure.com`, release `vsrm.dev.azure.com` (the Go SDK routes by client).

## Net-new resources (the fork's own surface — where refinement work lands)

| Resource / data source | File (under `azuredevops/internal/service/`) | Host |
|---|---|---|
| `betterado_release_definition` (resource + data) | `release/resource_release_definition.go` (~1490 lines), `release/data_release_definition*.go` | vsrm |
| `betterado_release_folder` (resource + data) | `release/resource_release_folder.go`, `release/data_release_folder.go` | vsrm |
| `betterado_release_definition_permissions` | `release/` (permissions sub-package) | vsrm |
| `betterado_task_group` (resource + data) | `taskagent/resource_task_group.go`, `taskagent/data_task_group.go` | core |
| release definition history / revision / list data sources | `release/data_release_definition_{history,revision}.go`, `release/data_release_definitions.go` | vsrm |

Everything else (build, repos, service endpoints, policies, permissions, …) is
inherited from upstream and is **not** the fork's concern.

## Conventions that must hold (the dev-loop is judged against these)

- **CRUD pattern per resource:** `resource_<name>.go` returns `*schema.Resource`; Create/Read/Update/Delete with `Context` suffix; `expand*` (state→API) and `flatten*` (API→state) per nested layer; acceptance tests in `azuredevops/internal/acceptancetests/`.
- **Schema shapes** (see the `resource-scaffolder` skill): single nested object → `TypeList` + `MaxItems:1`; ordered list of objects → `TypeList`; unordered set → `TypeSet`; simple map → `TypeMap`. Readability refactors may convert block-style nested lists to assignable list-of-object attributes (`ConfigMode: SchemaConfigModeAttr`) — see the `schema-refactor` skill.
- **Fixtures (C9):** every field under test gets a non-default value, and Create/Update is verified by a separate read-back (`terraform apply` → provider read → idempotency re-plan `ExpectNonEmptyPlan:false` → clean `destroy`). A `SharedFixture` factory encodes validity constraints.
- **Two-gate testing model** (encoded as standing ACs in `.forge/project.json`): (1) live acceptance — a `TF_ACC` test against real ADO; (2) CI-equivalent — `make test` (gofmt + whole-module `go test`, no TF_ACC) + `golangci-lint run ./...` + `make terrafmt-check`.
- **Build discipline:** never `go build ./...` / `go vet ./...` (fills the drive); build/test only the package under change.

## Gotchas (paid for in prior cycles)

- **Stale-revision update returns HTTP 400, not 409**, with `typeKey: InvalidRequestException` and "old copy of the release pipeline". Update must detect this, re-read for the current revision, and retry once.
- **404 in Read** ⇒ `d.SetId("")` + return nil (external delete), never an error.
- **Artifact `definition_reference`** comes back with extra API keys (e.g. `artifactSourceDefinitionUrl`) not in user config; `flattenArtifacts` filters to user-set keys to avoid a perpetual diff.
- **Live-acc env guard:** a `TF_ACC` acceptance test that runs without `TF_ACC` + `AZDO_ORG_SERVICE_URL` + `AZDO_PERSONAL_ACCESS_TOKEN` either SKIPS (false-pass) or `t.Fatal`s in PreCheck — the gate errors fast on missing env rather than false-passing.

## Framework migration (SDKv2 -> plugin-framework) -- per-resource checklist

Provider runs SDKv2 + framework side-by-side under `terraform-plugin-mux`. For each
resource/data-source a WI migrates, ALL must hold (each is a live-only failure --
`make test` passes while the live `TestAcc` gate fails; the WI `quality_gate_cmd`
MUST be the live `TestAcc<Name>`):

1. **Deregister from SDKv2 in the same WI** -- remove it from `provider.go`
   ResourcesMap/DataSourcesMap when adding it to `framework_provider.go`, else
   `Duplicate resource type <name>` at apply; update `provider_test.go` counts.
2. **`Configure()` wires `*client.AggregatedClient`** (not a stub); framework
   resources + test helpers read it from framework provider data, never SDKv2
   `meta.(*client.AggregatedClient)` (nil under mux -> panic).
3. **Tests use `GetMuxedProviderFactories()`** (ProtoV6 SDKv2+framework).
4. **Validator parity** -- every SDKv2 `ValidateFunc`/`ValidateDiagFunc` (IsUUID,
   StringIsNotWhiteSpace, OneOf enums, URL checks) maps to a framework
   `Validators:` entry (`terraform-plugin-framework-validators`); ConflictsWith/
   RequiredWith/ExactlyOneOf map to config validators; ForceNew maps to
   `RequiresReplace`. Dropping these is a silent plan-time->apply-time regression
   (caught in review on TWO initiatives: git PR #46, security-permissions PR #48).
5. **Live evidence per-type labels** -- `CaptureLiveEvidence("acceptance-resource-<type>", ...)`;
   a shared label overwrites earlier captures (last-writer-wins) and multi-resource
   initiatives ship evidence for only their final resource.
6. **Never create ADO projects in tests** -- the org sits at its project cap; reuse
   `SharedFixtureProjectName` (standing fixture, restored 2026-07-03). The resolver
   fails loudly on a missing fixture by design; import-style tests must end with a
   `removed` block (`destroy = false`), never a destroy of the fixture.

## API-coverage discipline

The release_definition surface has a field-by-field gap matrix at
`docs/release-definition-gap-matrix.md` (93 mapped / 8 writable gaps open). The
standing goal is to bring **every** net-new resource type to that same level of
review (a gap matrix vs the ADO REST schema) and implement the writable gaps.
The `ado-api-explorer` + `ado-browser-inspector` skills drive that discovery.

## Reference docs

`docs/api-reference/` (release-definitions.md, task-groups.md, validation findings),
`docs/release-definition-gap-matrix.md`, `docs/official-provider-codemap.md`.
Development history (plans + demos per initiative): `forge/history/`.
