---
initiative_id: INIT-2026-05-18-betterado-15-build-retention-and-settings
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-18T22:35:00.000Z'
iteration_budget: 44
cost_budget_usd: 30
phase: pending
origin: architect
quality_gate_cmd:
  - go
  - test
  - ./azuredevops/internal/service/build/...
depends_on_initiatives:
  - INIT-2026-05-18-betterado-01-release-def-test-substrate
  - INIT-2026-05-18-betterado-03-task-group-test-substrate
features:
  - feature_id: FEAT-1
    title: betterado_build_retention_lease + mock tests
    depends_on: []
  - feature_id: FEAT-2
    title: betterado_build_general_settings + mock tests
    depends_on: []
  - feature_id: FEAT-3
    title: betterado_build_definition_tags + mock tests
    depends_on: []
  - feature_id: FEAT-4
    title: Docs + examples
    depends_on:
      - FEAT-1
      - FEAT-2
      - FEAT-3
---

# betterado build retention & settings

## Why

Build is covered but its createable/settable extras — retention leases
(`POST /build/retention/leases`), project build general settings (PATCH),
and build-definition tags — are absent. `build_sdk_mock` exists.

## Scope

- `betterado_build_retention_lease`: definition_id, run_id (optional),
  days_valid, protect_pipeline.
- `betterado_build_general_settings`: project_id,
  enforce_referenced_repo_scoped_token, disable_classic_pipeline_creation,
  etc.
- `betterado_build_definition_tags`: definition_id, tags list.

## Verification mandate

`go test ./azuredevops/internal/service/build/...` with `build_sdk_mock`.
No acceptance-only verification.

## Acceptance criteria

- FEAT-1/2/3 — **Given** a gomock build client, **when** CRUD/patch runs,
  **then** SDK args match and state round-trips; tests pass; names
  registered; `go build ./...` exits 0.
- FEAT-4 — docs per resource + `examples/` plan clean.

## Constraints

`build_general_settings` is project-singleton — Read must reconcile, Delete
restores defaults. Additive; vendored offline build green.

## Council constraints (binding — LLM-Council 2026-05-18)

- Gate: `go test ./azuredevops/internal/service/build/...` passes + `go build -mod=vendor ./...` exits 0 + each new `betterado_*` registered in `azuredevops/provider.go`. A test pkg that compiles but asserts nothing is a FAIL.
- Per resource: 5 mock unit tests — expand↔flatten roundtrip, create API-error, read-404-clears-state, update-calls-SDK-with-args, delete API-error — mirroring upstream `resource_environment_test.go`.
- Docs (comprehensive): `docs/resources/<name>.md` (description, basic + complex example, argument & attribute reference, import) + runnable `examples/<name>/`. Edit `docs/resources/` + `examples/` only, never `website/`.
- Fixtures: inline if <20 lines else `testdata/*.json`. Never hand-edit `azdosdkmocks/` (regenerate + commit if an SDK signature changes).
- Additive & atomic: absent config reproduces prior behaviour; a quality-gate failure marks the initiative BLOCKED (no cascade to independents).

## Scope — PM: stay inside this, do NOT explore the rest of the repo

terraform-provider-betterado is a large vendored Go monorepo (286+ `*_test.go`, a huge `vendor/`). Plan work-items ONLY against:
- `azuredevops/internal/service/build/` — the resource + test code for this initiative (create the dir if it is new).
- `azuredevops/provider.go` — register each new `betterado_*` name here.
- The matching mock `azdosdkmocks/<area>_sdk_mock.go` (read, never edit).
- ONE existing upstream `*_test.go` in a sibling `azuredevops/internal/service/*` package as the gomock pattern to mirror.

Do NOT `Glob`/scan `vendor/`, the repo root, `website/`, or `docs/` trees — every WI's `files_in_scope` lives under the paths above. Brain-query is mandatory but bounded: 1–2 targeted queries, not broad exploration.
