---
initiative_id: INIT-2026-05-18-betterado-08a-audit-client
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-18T22:35:00.000Z'
iteration_budget: 28
cost_budget_usd: 18
phase: pending
origin: architect
quality_gate_cmd:
  - go
  - test
  - '-mod=vendor'
  - ./azuredevops/utils/sdk/audit/...
depends_on_initiatives:
  - INIT-2026-05-18-betterado-01-release-def-test-substrate
  - INIT-2026-05-18-betterado-03-task-group-test-substrate
features:
  - feature_id: FEAT-1
    title: >-
      Injectable auditsdk.Client interface over the ADO audit REST endpoint +
      gomock-compatible MockAuditClient (mirror release_sdk_mock.go structure) +
      client unit tests
    depends_on: []
  - feature_id: FEAT-2
    title: >-
      azuredevops/utils/sdk/audit/README.md — interface contract +
      why-no-vendored-SDK rationale + comprehensive godoc
    depends_on:
      - FEAT-1
---

# betterado audit SDK client (08a)

## Why

Audit streams are net-new vs upstream, but there is **no vendored `audit` SDK client and no `audit_sdk_mock`** — unlike every other area. Per council (flags ENG-4 / init-08-audit-mock-pattern / FLAG-2) the client abstraction is isolated into its own initiative so its injectable pattern is validated by tests before any resource depends on it.

## Scope

- `azuredevops/utils/sdk/audit/`: an `auditsdk.Client` interface (Create/Get/Update/Delete stream) wrapping the ADO `audit` REST endpoint.
- A gomock-compatible `MockAuditClient` with `EXPECT()` assertions that **matches the azdosdkmocks pattern and release_sdk_mock.go structure** — so 08b's resource tests look identical to every other area's.
- No live HTTP in any test; the interface is the only seam.

## Acceptance criteria

- FEAT-1 — **Given** the mock audit client, **when** each wrapper method runs, **then** request URL/verb/body match the documented audit-streams API; `go test -mod=vendor ./azuredevops/utils/sdk/audit/...` passes; `go build -mod=vendor ./...` exits 0; the mock exposes `EXPECT()` like azdosdkmocks.
- FEAT-2 — `azuredevops/utils/sdk/audit/README.md` documents the interface contract, the no-upstream-SDK rationale, and the migration path if a vendored SDK later appears.

## Constraints

Injectable interface only — zero real HTTP in tests. Additive; vendored offline build green. Rollback: new util package only.

## Council constraints (binding — LLM-Council 2026-05-18)

- Gate: `go test -mod=vendor ./azuredevops/utils/sdk/audit/...` passes + `go build -mod=vendor ./...` exits 0 + each new `betterado_*` registered in `azuredevops/provider.go`. A test pkg that compiles but asserts nothing is a FAIL.
- Per resource: 5 mock unit tests — expand↔flatten roundtrip, create API-error, read-404-clears-state, update-calls-SDK-with-args, delete API-error — mirroring upstream `resource_environment_test.go`.
- Docs (comprehensive): `docs/resources/<name>.md` (description, basic + complex example, argument & attribute reference, import) + runnable `examples/<name>/`. Edit `docs/resources/` + `examples/` only, never `website/`.
- Fixtures: inline if <20 lines else `testdata/*.json`. Never hand-edit `azdosdkmocks/` (regenerate + commit if an SDK signature changes).
- Additive & atomic: absent config reproduces prior behaviour; a quality-gate failure marks the initiative BLOCKED (no cascade to independents).

## Scope — PM: stay inside this, do NOT explore the rest of the repo

terraform-provider-betterado is a large vendored Go monorepo (286+ `*_test.go`, a huge `vendor/`). Plan work-items ONLY against:
- `azuredevops/utils/sdk/audit/` — the resource + test code for this initiative (create the dir if it is new).
- `azuredevops/provider.go` — register each new `betterado_*` name here.
- The matching mock `azdosdkmocks/<area>_sdk_mock.go` (read, never edit).
- ONE existing upstream `*_test.go` in a sibling `azuredevops/internal/service/*` package as the gomock pattern to mirror.

Do NOT `Glob`/scan `vendor/`, the repo root, `website/`, or `docs/` trees — every WI's `files_in_scope` lives under the paths above. Brain-query is mandatory but bounded: 1–2 targeted queries, not broad exploration.
