---
initiative_id: INIT-2026-05-18-betterado-11-git-collaboration-extras
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
  - ./azuredevops/internal/service/git/...
depends_on_initiatives:
  - INIT-2026-05-18-betterado-10-git-pull-request
features:
  - feature_id: FEAT-1
    title: betterado_git_annotated_tag + mock tests
    depends_on: []
  - feature_id: FEAT-2
    title: betterado_git_import_request + mock tests
    depends_on: []
  - feature_id: FEAT-3
    title: betterado_git_commit_status + mock tests
    depends_on: []
  - feature_id: FEAT-4
    title: Docs + examples
    depends_on:
      - FEAT-1
      - FEAT-2
      - FEAT-3
---

# betterado git collaboration extras

## Why

Remaining createable git primitives: annotated tags
(`POST .../annotatedtags`), import requests (`POST .../importRequests`),
commit statuses (`POST .../commits/{id}/statuses`). Severely-partial gap;
reuses the git mock test helper introduced in INIT 10 (hence the initiative
dependency).

## Scope

- `betterado_git_annotated_tag` (repository_id, name, message, object id).
- `betterado_git_import_request` (repository_id, source URL, service
  endpoint, git/tfvc).
- `betterado_git_commit_status` (repository_id, commit id, state, context,
  target URL).

## Verification mandate

`go test ./azuredevops/internal/service/git/...` with `git_sdk_mock`. No
acceptance-only verification.

## Acceptance criteria

- FEAT-1/2/3 — **Given** a gomock git client, **when** CRUD runs for each
  resource, **then** SDK args match and state round-trips; tests pass;
  names registered; `go build ./...` exits 0. Import-request handles the
  async status (mock returns completed).
- FEAT-4 — docs per resource + `examples/` plan clean.

## Constraints

Additive; vendored offline build green. Rollback: new resources only.

## Council constraints (binding — LLM-Council 2026-05-18)

- Gate: `go test ./azuredevops/internal/service/git/...` passes + `go build -mod=vendor ./...` exits 0 + each new `betterado_*` registered in `azuredevops/provider.go`. A test pkg that compiles but asserts nothing is a FAIL.
- Per resource: 5 mock unit tests — expand↔flatten roundtrip, create API-error, read-404-clears-state, update-calls-SDK-with-args, delete API-error — mirroring upstream `resource_environment_test.go`.
- Docs (comprehensive): `docs/resources/<name>.md` (description, basic + complex example, argument & attribute reference, import) + runnable `examples/<name>/`. Edit `docs/resources/` + `examples/` only, never `website/`.
- Fixtures: inline if <20 lines else `testdata/*.json`. Never hand-edit `azdosdkmocks/` (regenerate + commit if an SDK signature changes).
- Additive & atomic: absent config reproduces prior behaviour; a quality-gate failure marks the initiative BLOCKED (no cascade to independents).

## Scope — PM: stay inside this, do NOT explore the rest of the repo

terraform-provider-betterado is a large vendored Go monorepo (286+ `*_test.go`, a huge `vendor/`). Plan work-items ONLY against:
- `azuredevops/internal/service/git/` — the resource + test code for this initiative (create the dir if it is new).
- `azuredevops/provider.go` — register each new `betterado_*` name here.
- The matching mock `azdosdkmocks/<area>_sdk_mock.go` (read, never edit).
- ONE existing upstream `*_test.go` in a sibling `azuredevops/internal/service/*` package as the gomock pattern to mirror.

Do NOT `Glob`/scan `vendor/`, the repo root, `website/`, or `docs/` trees — every WI's `files_in_scope` lives under the paths above. Brain-query is mandatory but bounded: 1–2 targeted queries, not broad exploration.
