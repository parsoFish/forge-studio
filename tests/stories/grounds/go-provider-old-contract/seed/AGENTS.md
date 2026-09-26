# terraform-provider-betterado

A GitHub fork of `microsoft/terraform-provider-azuredevops` that ships the
resources Microsoft never released: **classic release pipelines**
(`betterado_release_definition`, `betterado_release_folder`) via the Release
Management REST API at `vsrm.dev.azure.com`, and **task groups**
(`betterado_task_group`), on top of the full upstream ADO provider. Go +
Terraform Plugin SDK v2 (muxed with terraform-plugin-framework for newer
resources). Module: `github.com/parsoFish/terraform-provider-betterado`.
Resource prefix: `betterado_`.

---

## Build, test, lint — exact commands

```bash
# Test ONLY the package you are changing — never the whole tree (fills the drive).
go test -tags all -count=1 ./azuredevops/internal/service/release/...
go test -tags all -count=1 ./azuredevops/internal/service/taskagent/...

# Compile the provider entry point to verify it builds (fast):
go build -mod=vendor .

# Auto-formatters — run before the CI gate:
make fmt          # gofmt -s -w
make terrafmt     # terrafmt fmt on HCL in tests + examples

# CI-equivalent gate (offline, no TF_ACC; mirrors GitHub's golint + unit-test workflows):
make test && golangci-lint run ./azuredevops/... && make terrafmt-check

# Live acceptance (requires creds — see below):
TF_ACC=1 go test -tags all -run TestAcc<Name> \
    ./azuredevops/internal/acceptancetests/...

# Reclaim build cache when disk is tight:
make clean-cache
```

Live credentials come from `secrets.env` (gitignored):
`AZDO_ORG_SERVICE_URL`, `AZDO_PERSONAL_ACCESS_TOKEN`, `TF_ACC=1`.

---

## Quality gate

Every change must hold **two gates**:

1. **CI-equivalent (offline):** `make test && golangci-lint run ./azuredevops/... && make terrafmt-check`  
   No `TF_ACC`, no creds, fast. Mirrors GitHub `golint.yml` + `unit-test.yml`.
   `golangci-lint` is run with `--new-from-rev=main` so it targets only changed code.

2. **Live acceptance (TF_ACC=1):** scope to the specific `TestAcc*` name.  
   Shape: apply → provider read-back → idempotency re-plan (`ExpectNonEmptyPlan: false`) → clean destroy.  
   Requires `TF_ACC`, `AZDO_ORG_SERVICE_URL`, `AZDO_PERSONAL_ACCESS_TOKEN`.

**Never** run bare `go test ./...` with live creds unset — acceptance tests skip
cleanly and return ok, producing a false-pass with no live verification.

---

## Conventions

### Implementation pattern
- `resource_<name>.go` → `*schema.Resource` (SDK v2); CRUD methods with `Context` suffix.
- `resource_<name>_framework.go` → `resource.Resource` (terraform-plugin-framework, v1.0.5+).
- `expand*` functions map Terraform state → API struct; `flatten*` map API struct → state.
  Each nested layer (stages, deploy_phases, approvals, conditions, …) gets its own expand/flatten pair.
- Register resources in `azuredevops/provider.go`; add examples under `examples/`.
- Acceptance tests live in `azuredevops/internal/acceptancetests/`.

### Schema shapes
| Use case | Schema type |
|---|---|
| Single nested object | `TypeList` + `MaxItems:1` |
| Ordered list of objects | `TypeList` (or `ConfigMode: SchemaConfigModeAttr`) |
| Unordered collection | `TypeSet` |
| Simple map | `TypeMap` |

### Fixture discipline
Write fixtures with **non-default** values for every field. Verify Create and
Update via read-back (idempotency re-plan). Use `SharedReleaseFixture` or
`data "betterado_project"` to reuse `betterado-standing-demo` — **never
create a project in a live TF_ACC test** (the ADO org is at its 1000-project
cap). `t.Cleanup` handles cleanup on the normal path; `make sweep` is the
backstop for killed runs.

### Commit and history
- Conventional commits: `feat(scope): …`, `fix(scope): …`, `refactor(scope): …`.
- Commit your work; leave git history intact — **no resets**.
- Each cycle's demo is committed under `forge/history/<initiative-id>/demo/` (forge writes the
  in-PR demo there). The plan + verdict are forge-owned and central (ADR 035) — not in this repo.

### Release process
In-cycle: `make docs` (regenerate `docs/`; then `git checkout -- docs/guides/`
to restore hand-written guides), draft a `## Unreleased` entry in
`CHANGELOG.md`. Pre-merge: bump `PROVIDER_VERSION.txt` (semver). CI does the
tag + GoReleaser publish — agents never run those steps.

---

## Key technical notes

- **Two API hosts:** core operations use `dev.azure.com`; release operations use
  `vsrm.dev.azure.com`. The Go SDK routes by client type (`release.Client` vs
  `TaskAgentClient`).
- **404 in Read → treat as deleted:** call `d.SetId("")` (SDK v2) or
  `resp.State.RemoveResource(ctx)` (framework) and return nil. Never error on a
  404 — it means the resource was deleted outside Terraform.
- **Stale-revision update:** a release definition update with an outdated
  revision returns HTTP 400 (`InvalidRequestException`, "old copy of the release
  pipeline") — not 409. Detect this, re-read for the current revision, and retry
  once.
- **Artifact `definition_reference`:** the API returns extra computed keys not in
  user config. `flattenArtifacts` filters to user-set keys to prevent a
  perpetual diff.
- **Disk discipline:** `go build ./...` and `go vet ./...` on the whole tree
  generate multi-GB build caches. Always scope builds and tests to the package
  under change.

---

## Layout

```
azuredevops/                 Provider source
  internal/service/release/  Release definition + folder resources
  internal/service/taskagent/ Task group resources
  internal/acceptancetests/  Acceptance tests (TF_ACC)
  provider.go                Resource/data-source registry + provider schema
docs/                        API references + per-resource gap matrices
examples/                    HCL examples embedded in generated docs
forge/
  history/<initiative-id>/demo/  In-PR demo evidence per cycle (forge-written)
  skills/                    Project-action recipes (resource-scaffolder, ado-api-explorer, …)
PROVIDER_VERSION.txt         Semver — bump pre-merge for any user-visible change
CHANGELOG.md                 Draft under ## Unreleased in-cycle; promoted by post-approval finaliser
```

---

## Where domain knowledge lives

- The project **brain** (profile + decision themes) is forge-owned and central (ADR 035), at
  `brain/projects/terraform-provider-betterado/` in the forge repo. Planners encode its knowledge
  into work items — dev-loop/reviewer agents work from the WIs, not from the brain directly.
- `docs/` — per-resource gap matrices vs the ADO REST schema.
- `forge/skills/` — reusable project-action recipes (scaffolder, API explorer, demo runner, …).
- `.forge/project.json` — forge contract: CI gate command, acceptance gate env requirements,
  release process steps, sweeper safety allowlist.
- `roadmap.md` — the planning frontier.
