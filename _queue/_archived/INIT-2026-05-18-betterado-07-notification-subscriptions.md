---
initiative_id: INIT-2026-05-18-betterado-07-notification-subscriptions
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
  - ./azuredevops/internal/service/notification/...
depends_on_initiatives:
  - INIT-2026-05-18-betterado-01-release-def-test-substrate
  - INIT-2026-05-18-betterado-03-task-group-test-substrate
features:
  - feature_id: FEAT-1
    title: >-
      New notification package + betterado_notification_subscription resource +
      mock tests + registration
    depends_on: []
  - feature_id: FEAT-2
    title: Subscription scoping (team/group) + filters/channels + mock tests
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: betterado_notification_subscription_template data source + docs
    depends_on:
      - FEAT-1
---

# betterado_notification_subscription

## Why

Notification subscriptions (`POST /notification/subscriptions`) are entirely
absent — no `notification` service package — though `notification_sdk_mock`
and the vendored `notification` SDK client exist. Net-new vs upstream.

## Scope

- New package `azuredevops/internal/service/notification/`.
- `betterado_notification_subscription`: subscriber (team/group descriptor),
  channel (email/soap), filter (event type + criteria), scope (project).
- `betterado_notification_subscription_template` data source (read available
  templates to drive subscription creation).

## Verification mandate

`go test ./azuredevops/internal/service/notification/...` with
`notification_sdk_mock`. No acceptance-only verification.

## Acceptance criteria

- FEAT-1 — **Given** a gomock notification client returning a fixture
  `NotificationSubscription`, **when** CRUD runs, **then** SDK args match
  and state round-trips; package compiles; name registered; `go build ./...`
  exits 0.
- FEAT-2 — team/group scoping + channel + filter expand/flatten round-trip
  with no drift under mock.
- FEAT-3 — data source returns templates; `docs/resources/...` +
  `examples/` plan clean.

## Constraints

Mirror upstream package idioms; additive; vendored offline build green.
Rollback: new package only.

## Council constraints (binding — LLM-Council 2026-05-18)

- Gate: `go test ./azuredevops/internal/service/notification/...` passes + `go build -mod=vendor ./...` exits 0 + each new `betterado_*` registered in `azuredevops/provider.go`. A test pkg that compiles but asserts nothing is a FAIL.
- Per resource: 5 mock unit tests — expand↔flatten roundtrip, create API-error, read-404-clears-state, update-calls-SDK-with-args, delete API-error — mirroring upstream `resource_environment_test.go`.
- Docs (comprehensive): `docs/resources/<name>.md` (description, basic + complex example, argument & attribute reference, import) + runnable `examples/<name>/`. Edit `docs/resources/` + `examples/` only, never `website/`.
- Fixtures: inline if <20 lines else `testdata/*.json`. Never hand-edit `azdosdkmocks/` (regenerate + commit if an SDK signature changes).
- Additive & atomic: absent config reproduces prior behaviour; a quality-gate failure marks the initiative BLOCKED (no cascade to independents).

## Scope — PM: stay inside this, do NOT explore the rest of the repo

terraform-provider-betterado is a large vendored Go monorepo (286+ `*_test.go`, a huge `vendor/`). Plan work-items ONLY against:
- `azuredevops/internal/service/notification/` — the resource + test code for this initiative (create the dir if it is new).
- `azuredevops/provider.go` — register each new `betterado_*` name here.
- The matching mock `azdosdkmocks/<area>_sdk_mock.go` (read, never edit).
- ONE existing upstream `*_test.go` in a sibling `azuredevops/internal/service/*` package as the gomock pattern to mirror.

Do NOT `Glob`/scan `vendor/`, the repo root, `website/`, or `docs/` trees — every WI's `files_in_scope` lives under the paths above. Brain-query is mandatory but bounded: 1–2 targeted queries, not broad exploration.
