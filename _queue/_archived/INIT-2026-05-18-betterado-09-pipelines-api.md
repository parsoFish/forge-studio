---
initiative_id: INIT-2026-05-18-betterado-09-pipelines-api
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-18T22:35:00.000Z'
iteration_budget: 40
cost_budget_usd: 26
phase: pending
origin: architect
quality_gate_cmd:
  - go
  - test
  - ./azuredevops/internal/service/pipelines/...
depends_on_initiatives:
  - INIT-2026-05-18-betterado-01-release-def-test-substrate
  - INIT-2026-05-18-betterado-03-task-group-test-substrate
features:
  - feature_id: FEAT-1
    title: >-
      New pipelines package + betterado_pipeline resource (Pipelines API) + mock
      tests + registration
    depends_on: []
  - feature_id: FEAT-2
    title: Pipeline folder/configuration parity + mock tests
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: betterado_pipeline data source + docs
    depends_on:
      - FEAT-1
---

# betterado_pipeline (Pipelines API)

## Why

The modern Pipelines API (`POST /pipelines`) is distinct from
`build_definition` and is not represented, though `pipelines_sdk_mock` and
the vendored `pipelines` client exist. Useful where users want the
pipelines-API shape rather than the legacy build-definition shape.

## Scope

- New package `azuredevops/internal/service/pipelines/`.
- `betterado_pipeline`: name, folder, configuration (yaml repository +
  path), project.
- `betterado_pipeline` data source.

## Verification mandate

`go test ./azuredevops/internal/service/pipelines/...` with
`pipelines_sdk_mock`. No acceptance-only verification.

## Acceptance criteria

- FEAT-1 — **Given** a gomock pipelines client returning a fixture
  `Pipeline`, **when** Create/Read/Delete run, **then** SDK args match and
  state round-trips; package compiles; name registered; `go build ./...`
  exits 0.
- FEAT-2 — folder + yaml configuration expand/flatten round-trip with no
  drift under mock.
- FEAT-3 — data source returns a pipeline by name/id; docs + `examples/`
  plan clean.

## Constraints

Mirror upstream package idioms; additive; vendored offline build green.
Rollback: new package only.

## Council constraints (binding — LLM-Council 2026-05-18)

- Gate: `go test ./azuredevops/internal/service/pipelines/...` passes + `go build -mod=vendor ./...` exits 0 + each new `betterado_*` registered in `azuredevops/provider.go`. A test pkg that compiles but asserts nothing is a FAIL.
- Per resource: 5 mock unit tests — expand↔flatten roundtrip, create API-error, read-404-clears-state, update-calls-SDK-with-args, delete API-error — mirroring upstream `resource_environment_test.go`.
- Docs (comprehensive): `docs/resources/<name>.md` (description, basic + complex example, argument & attribute reference, import) + runnable `examples/<name>/`. Edit `docs/resources/` + `examples/` only, never `website/`.
- Fixtures: inline if <20 lines else `testdata/*.json`. Never hand-edit `azdosdkmocks/` (regenerate + commit if an SDK signature changes).
- Additive & atomic: absent config reproduces prior behaviour; a quality-gate failure marks the initiative BLOCKED (no cascade to independents).

## Scope — PM: stay inside this, do NOT explore the rest of the repo

terraform-provider-betterado is a large vendored Go monorepo (286+ `*_test.go`, a huge `vendor/`). Plan work-items ONLY against:
- `azuredevops/internal/service/pipelines/` — the resource + test code for this initiative (create the dir if it is new).
- `azuredevops/provider.go` — register each new `betterado_*` name here.
- The matching mock `azdosdkmocks/<area>_sdk_mock.go` (read, never edit).
- ONE existing upstream `*_test.go` in a sibling `azuredevops/internal/service/*` package as the gomock pattern to mirror.

Do NOT `Glob`/scan `vendor/`, the repo root, `website/`, or `docs/` trees — every WI's `files_in_scope` lives under the paths above. Brain-query is mandatory but bounded: 1–2 targeted queries, not broad exploration.
