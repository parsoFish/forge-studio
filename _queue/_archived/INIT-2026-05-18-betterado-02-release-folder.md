---
initiative_id: INIT-2026-05-18-betterado-02-release-folder
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-18T22:35:00.000Z'
iteration_budget: 34
cost_budget_usd: 23
phase: pending
origin: architect
quality_gate_cmd:
  - go
  - test
  - ./azuredevops/internal/service/release/...
depends_on_initiatives:
  - INIT-2026-05-18-betterado-01-release-def-test-substrate
features:
  - feature_id: FEAT-1
    title: >-
      betterado_release_folder resource (create/rename/delete vsrm release
      folders) + mock tests
    depends_on: []
  - feature_id: FEAT-2
    title: betterado_release_folder data source + mock tests
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Docs + example
    depends_on:
      - FEAT-1
---

# betterado_release_folder

## Why

Release definitions live in folders (`path` = `\\`); the provider can set a
definition's path but cannot manage the folder hierarchy itself. `vsrm`
exposes createable release-definition folders. Net-new (no upstream support).

## Scope

- `betterado_release_folder` resource: create / rename (path move) / delete a
  release folder under a project; attributes `project_id`, `path`,
  `description`.
- `betterado_release_folder` data source: look up an existing folder.

## Verification mandate

`go test ./azuredevops/internal/service/release/...` with `release_sdk_mock`
(reuses the FEAT-1 harness from INIT 01 — hence the initiative dependency).

## Acceptance criteria

- FEAT-1 — **Given** a gomock release client, **when** Create/Read/Update
  (rename)/Delete run, **then** the SDK folder calls are made with expected
  args and state round-trips; tests pass; `go build ./...` exits 0; the name
  is registered in `azuredevops/provider.go` ResourcesMap.
- FEAT-2 — data source returns the folder by `project_id` + `path`; mock test
  asserts the lookup.
- FEAT-3 — `docs/resources/release_folder.md` + an `examples/` snippet.

## Constraints

Additive; vendored offline build green. Rollback: new resource only — no
impact on existing state.

## Council constraints (binding — LLM-Council 2026-05-18)

- Gate: `go test ./azuredevops/internal/service/release/...` passes + `go build -mod=vendor ./...` exits 0 + each new `betterado_*` registered in `azuredevops/provider.go`. A test pkg that compiles but asserts nothing is a FAIL.
- Per resource: 5 mock unit tests — expand↔flatten roundtrip, create API-error, read-404-clears-state, update-calls-SDK-with-args, delete API-error — mirroring upstream `resource_environment_test.go`.
- Docs (comprehensive): `docs/resources/<name>.md` (description, basic + complex example, argument & attribute reference, import) + runnable `examples/<name>/`. Edit `docs/resources/` + `examples/` only, never `website/`.
- Fixtures: inline if <20 lines else `testdata/*.json`. Never hand-edit `azdosdkmocks/` (regenerate + commit if an SDK signature changes).
- Additive & atomic: absent config reproduces prior behaviour; a quality-gate failure marks the initiative BLOCKED (no cascade to independents).

## Scope — PM: stay inside this, do NOT explore the rest of the repo

terraform-provider-betterado is a large vendored Go monorepo (286+ `*_test.go`, a huge `vendor/`). Plan work-items ONLY against:
- `azuredevops/internal/service/release/` — the resource + test code for this initiative (create the dir if it is new).
- `azuredevops/provider.go` — register each new `betterado_*` name here.
- The matching mock `azdosdkmocks/<area>_sdk_mock.go` (read, never edit).
- ONE existing upstream `*_test.go` in a sibling `azuredevops/internal/service/*` package as the gomock pattern to mirror.

Do NOT `Glob`/scan `vendor/`, the repo root, `website/`, or `docs/` trees — every WI's `files_in_scope` lives under the paths above. Brain-query is mandatory but bounded: 1–2 targeted queries, not broad exploration.
