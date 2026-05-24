---
initiative_id: INIT-2026-05-18-betterado-05-test-case-and-variables
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
  - ./azuredevops/internal/service/test/...
depends_on_initiatives:
  - INIT-2026-05-18-betterado-04-test-plan-core
features:
  - feature_id: FEAT-1
    title: betterado_test_variable + mock tests
    depends_on: []
  - feature_id: FEAT-2
    title: betterado_test_case (work-item-backed) + mock tests
    depends_on: []
  - feature_id: FEAT-3
    title: betterado_test_suite_entry (suite<->case association) + mock tests
    depends_on:
      - FEAT-2
  - feature_id: FEAT-4
    title: Docs + examples
    depends_on:
      - FEAT-1
      - FEAT-3
---

# betterado Test Management — cases & variables

## Why

Builds on INIT 04 (test package + plan/suite). Test cases, test variables
and suite-membership are the remaining createable Test Management primitives
needed for a usable Terraform-managed test setup.

## Scope

- `betterado_test_variable` (name, values, project).
- `betterado_test_case` (created via the work-item track as a Test Case work
  item; title, steps, project).
- `betterado_test_suite_entry` (associate an existing test case with a
  suite; suite_id, plan_id, test_case_id).

## Verification mandate

`go test ./azuredevops/internal/service/test/...` with `test_sdk_mock`
(reuses INIT 04 package + helpers — hence the initiative dependency).

## Acceptance criteria

- FEAT-1/2 — **Given** a gomock test client, **when** CRUD runs for
  test_variable / test_case, **then** SDK args match and state round-trips;
  tests pass; names registered; `go build ./...` exits 0.
- FEAT-3 — **Given** an existing suite + case, **when** test_suite_entry is
  created/deleted, **then** the add/remove suite-entry SDK calls fire with
  expected ids; mock test asserts idempotent membership.
- FEAT-4 — docs + `examples/` for all three plan clean.

## Constraints

Additive; vendored offline build green. Rollback: new resources only.

## Council constraints (binding — LLM-Council 2026-05-18)

- Gate: `go test ./azuredevops/internal/service/test/...` passes + `go build -mod=vendor ./...` exits 0 + each new `betterado_*` registered in `azuredevops/provider.go`. A test pkg that compiles but asserts nothing is a FAIL.
- Per resource: 5 mock unit tests — expand↔flatten roundtrip, create API-error, read-404-clears-state, update-calls-SDK-with-args, delete API-error — mirroring upstream `resource_environment_test.go`.
- Docs (comprehensive): `docs/resources/<name>.md` (description, basic + complex example, argument & attribute reference, import) + runnable `examples/<name>/`. Edit `docs/resources/` + `examples/` only, never `website/`.
- Fixtures: inline if <20 lines else `testdata/*.json`. Never hand-edit `azdosdkmocks/` (regenerate + commit if an SDK signature changes).
- Additive & atomic: absent config reproduces prior behaviour; a quality-gate failure marks the initiative BLOCKED (no cascade to independents).

## Scope — PM: stay inside this, do NOT explore the rest of the repo

terraform-provider-betterado is a large vendored Go monorepo (286+ `*_test.go`, a huge `vendor/`). Plan work-items ONLY against:
- `azuredevops/internal/service/test/` — the resource + test code for this initiative (create the dir if it is new).
- `azuredevops/provider.go` — register each new `betterado_*` name here.
- The matching mock `azdosdkmocks/<area>_sdk_mock.go` (read, never edit).
- ONE existing upstream `*_test.go` in a sibling `azuredevops/internal/service/*` package as the gomock pattern to mirror.

Do NOT `Glob`/scan `vendor/`, the repo root, `website/`, or `docs/` trees — every WI's `files_in_scope` lives under the paths above. Brain-query is mandatory but bounded: 1–2 targeted queries, not broad exploration.
