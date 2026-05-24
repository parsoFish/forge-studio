---
initiative_id: INIT-2026-05-18-betterado-06-servicehook-subscriptions
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-18T22:35:00.000Z'
iteration_budget: 48
cost_budget_usd: 34
phase: pending
origin: architect
quality_gate_cmd:
  - go
  - test
  - ./azuredevops/internal/service/servicehook/...
depends_on_initiatives:
  - INIT-2026-05-18-betterado-01-release-def-test-substrate
  - INIT-2026-05-18-betterado-03-task-group-test-substrate
features:
  - feature_id: FEAT-1
    title: >-
      betterado_servicehook_subscription generic core
      (publisher/event/consumer/inputs) + mock tests
    depends_on: []
  - feature_id: FEAT-2
    title: Microsoft Teams typed convenience resource delegating to core + mock tests
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Slack typed convenience resource delegating to core + mock tests
    depends_on:
      - FEAT-1
  - feature_id: FEAT-4
    title: >-
      Generic-webhook + Azure-Storage-queue typed convenience resources + mock
      tests
    depends_on:
      - FEAT-1
  - feature_id: FEAT-5
    title: Comprehensive docs + runnable examples for core + each consumer
    depends_on:
      - FEAT-2
      - FEAT-3
      - FEAT-4
---

# betterado service-hook subscriptions (composite: core + typed consumers)

## Why

Only 2 of ~15 service-hook consumers are represented. Operator decision (council escalation): **composite shape** — one generic `betterado_servicehook_subscription` core resource plus thin typed convenience resources that delegate to its shared expand/flatten (mirrors the `betterado_build_definition` trigger pattern). Clear for users, zero logic duplication.

## Scope

- `betterado_servicehook_subscription`: generic — `publisher_id`, `event_type`, `consumer_id`, `consumer_action_id`, `publisher_inputs` (map), `consumer_inputs` (map).
- Typed convenience resources (Teams, Slack, generic webhook, Azure Storage queue) — typed inputs only; CRUD delegates entirely to the generic core.

## Acceptance criteria

- FEAT-1 — **Given** a gomock servicehooks client, **when** CRUD runs, **then** the subscription create payload matches the configured publisher/event/consumer/inputs and state round-trips; `go test -mod=vendor ./azuredevops/internal/service/servicehook/...` passes; `go build -mod=vendor ./...` exits 0.
- FEAT-2/3/4 — each typed resource produces the correct consumer_id/consumer_action_id + typed inputs **by calling the core's expand/flatten** (assert no duplicated CRUD); registered in provider.go.
- FEAT-5 — comprehensive docs + `examples/` for core and each consumer plan clean.

## Constraints

Convenience resources MUST NOT duplicate core logic. Additive; vendored offline build green. Rollback: new resources only.

## Council constraints (binding — LLM-Council 2026-05-18)

- Gate: `go test ./azuredevops/internal/service/servicehook/...` passes + `go build -mod=vendor ./...` exits 0 + each new `betterado_*` registered in `azuredevops/provider.go`. A test pkg that compiles but asserts nothing is a FAIL.
- Per resource: 5 mock unit tests — expand↔flatten roundtrip, create API-error, read-404-clears-state, update-calls-SDK-with-args, delete API-error — mirroring upstream `resource_environment_test.go`.
- Docs (comprehensive): `docs/resources/<name>.md` (description, basic + complex example, argument & attribute reference, import) + runnable `examples/<name>/`. Edit `docs/resources/` + `examples/` only, never `website/`.
- Fixtures: inline if <20 lines else `testdata/*.json`. Never hand-edit `azdosdkmocks/` (regenerate + commit if an SDK signature changes).
- Additive & atomic: absent config reproduces prior behaviour; a quality-gate failure marks the initiative BLOCKED (no cascade to independents).

## Scope — PM: stay inside this, do NOT explore the rest of the repo

terraform-provider-betterado is a large vendored Go monorepo (286+ `*_test.go`, a huge `vendor/`). Plan work-items ONLY against:
- `azuredevops/internal/service/servicehook/` — the resource + test code for this initiative (create the dir if it is new).
- `azuredevops/provider.go` — register each new `betterado_*` name here.
- The matching mock `azdosdkmocks/<area>_sdk_mock.go` (read, never edit).
- ONE existing upstream `*_test.go` in a sibling `azuredevops/internal/service/*` package as the gomock pattern to mirror.

Do NOT `Glob`/scan `vendor/`, the repo root, `website/`, or `docs/` trees — every WI's `files_in_scope` lives under the paths above. Brain-query is mandatory but bounded: 1–2 targeted queries, not broad exploration.
