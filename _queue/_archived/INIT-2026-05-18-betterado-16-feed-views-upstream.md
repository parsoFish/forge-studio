---
initiative_id: INIT-2026-05-18-betterado-16-feed-views-upstream
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
  - ./azuredevops/internal/service/feed/...
depends_on_initiatives:
  - INIT-2026-05-18-betterado-01-release-def-test-substrate
  - INIT-2026-05-18-betterado-03-task-group-test-substrate
features:
  - feature_id: FEAT-1
    title: betterado_feed_view + mock tests
    depends_on: []
  - feature_id: FEAT-2
    title: betterado_feed_upstream_source + mock tests
    depends_on: []
  - feature_id: FEAT-3
    title: Docs + examples
    depends_on:
      - FEAT-1
      - FEAT-2
---

# betterado feed views & upstream sources

## Why

`betterado_feed` / `feed_permission` / `feed_retention_policy` exist, but
feed views (`POST .../feeds/{id}/views`) and upstream sources — both
createable — are absent. `feed_sdk_mock` exists.

## Scope

- `betterado_feed_view`: feed_id, name, type (release/implicit),
  visibility.
- `betterado_feed_upstream_source`: feed_id, name, protocol, location,
  upstream_source_type.

## Verification mandate

`go test ./azuredevops/internal/service/feed/...` with `feed_sdk_mock`. No
acceptance-only verification.

## Acceptance criteria

- FEAT-1/2 — **Given** a gomock feed client, **when** CRUD runs, **then**
  SDK args match and state round-trips; tests pass; names registered;
  `go build ./...` exits 0.
- FEAT-3 — docs + `examples/` plan clean.

## Constraints

Additive; vendored offline build green. Rollback: new resources only.

## Council constraints (binding — LLM-Council 2026-05-18)

- Gate: `go test ./azuredevops/internal/service/feed/...` passes + `go build -mod=vendor ./...` exits 0 + each new `betterado_*` registered in `azuredevops/provider.go`. A test pkg that compiles but asserts nothing is a FAIL.
- Per resource: 5 mock unit tests — expand↔flatten roundtrip, create API-error, read-404-clears-state, update-calls-SDK-with-args, delete API-error — mirroring upstream `resource_environment_test.go`.
- Docs (comprehensive): `docs/resources/<name>.md` (description, basic + complex example, argument & attribute reference, import) + runnable `examples/<name>/`. Edit `docs/resources/` + `examples/` only, never `website/`.
- Fixtures: inline if <20 lines else `testdata/*.json`. Never hand-edit `azdosdkmocks/` (regenerate + commit if an SDK signature changes).
- Additive & atomic: absent config reproduces prior behaviour; a quality-gate failure marks the initiative BLOCKED (no cascade to independents).

## Scope — PM: stay inside this, do NOT explore the rest of the repo

terraform-provider-betterado is a large vendored Go monorepo (286+ `*_test.go`, a huge `vendor/`). Plan work-items ONLY against:
- `azuredevops/internal/service/feed/` — the resource + test code for this initiative (create the dir if it is new).
- `azuredevops/provider.go` — register each new `betterado_*` name here.
- The matching mock `azdosdkmocks/<area>_sdk_mock.go` (read, never edit).
- ONE existing upstream `*_test.go` in a sibling `azuredevops/internal/service/*` package as the gomock pattern to mirror.

Do NOT `Glob`/scan `vendor/`, the repo root, `website/`, or `docs/` trees — every WI's `files_in_scope` lives under the paths above. Brain-query is mandatory but bounded: 1–2 targeted queries, not broad exploration.
