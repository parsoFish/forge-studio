---
initiative_id: INIT-2026-05-18-betterado-08b-audit-streams
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
  - '-mod=vendor'
  - ./azuredevops/internal/service/audit/...
depends_on_initiatives:
  - INIT-2026-05-18-betterado-08a-audit-client
features:
  - feature_id: FEAT-1
    title: >-
      betterado_audit_stream resource (uses 08a auditsdk.Client +
      MockAuditClient) + tests + provider registration
    depends_on: []
  - feature_id: FEAT-2
    title: >-
      Consumer-type variants (Splunk / Azure Monitor Log / Azure Event Grid) +
      mock tests
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Comprehensive docs + runnable example
    depends_on:
      - FEAT-2
---

# betterado_audit_stream (08b)

## Why

Audit streams (`POST /audit/streams`) are createable and net-new vs upstream. Builds on the 08a injectable audit client + MockAuditClient (hence the initiative dependency), so these resource tests use the same gomock idiom as every other area.

## Scope

- New package `azuredevops/internal/service/audit/`.
- `betterado_audit_stream`: consumer type + typed inputs, days-to-backfill, status.
- Consumer variants: Splunk, Azure Monitor Log, Azure Event Grid.

## Acceptance criteria

- FEAT-1/2 — **Given** the 08a MockAuditClient returning a fixture stream, **when** CRUD runs for each consumer type, **then** the create payload matches and state round-trips; `go test -mod=vendor ./azuredevops/internal/service/audit/...` passes; name registered; `go build -mod=vendor ./...` exits 0.
- FEAT-3 — comprehensive docs + `examples/` plan clean.

## Constraints

No direct REST — go through the 08a interface. Additive; vendored offline build green. Rollback: new package only.

## Council constraints (binding — LLM-Council 2026-05-18)

- Gate: `go test -mod=vendor ./azuredevops/internal/service/audit/...` passes + `go build -mod=vendor ./...` exits 0 + each new `betterado_*` registered in `azuredevops/provider.go`. A test pkg that compiles but asserts nothing is a FAIL.
- Per resource: 5 mock unit tests — expand↔flatten roundtrip, create API-error, read-404-clears-state, update-calls-SDK-with-args, delete API-error — mirroring upstream `resource_environment_test.go`.
- Docs (comprehensive): `docs/resources/<name>.md` (description, basic + complex example, argument & attribute reference, import) + runnable `examples/<name>/`. Edit `docs/resources/` + `examples/` only, never `website/`.
- Fixtures: inline if <20 lines else `testdata/*.json`. Never hand-edit `azdosdkmocks/` (regenerate + commit if an SDK signature changes).
- Additive & atomic: absent config reproduces prior behaviour; a quality-gate failure marks the initiative BLOCKED (no cascade to independents).

## Scope — PM: stay inside this, do NOT explore the rest of the repo

terraform-provider-betterado is a large vendored Go monorepo (286+ `*_test.go`, a huge `vendor/`). Plan work-items ONLY against:
- `azuredevops/internal/service/audit/` — the resource + test code for this initiative (create the dir if it is new).
- `azuredevops/provider.go` — register each new `betterado_*` name here.
- The matching mock `azdosdkmocks/<area>_sdk_mock.go` (read, never edit).
- ONE existing upstream `*_test.go` in a sibling `azuredevops/internal/service/*` package as the gomock pattern to mirror.

Do NOT `Glob`/scan `vendor/`, the repo root, `website/`, or `docs/` trees — every WI's `files_in_scope` lives under the paths above. Brain-query is mandatory but bounded: 1–2 targeted queries, not broad exploration.
