---
initiative_id: INIT-2026-05-18-betterado-19-pat-token-management
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
  - ./azuredevops/internal/service/tokens/...
depends_on_initiatives:
  - INIT-2026-05-18-betterado-01-release-def-test-substrate
  - INIT-2026-05-18-betterado-03-task-group-test-substrate
features:
  - feature_id: FEAT-1
    title: >-
      betterado_personal_access_token resource (create/revoke) + mock tests +
      secret handling
    depends_on: []
  - feature_id: FEAT-2
    title: Docs + security note
    depends_on:
      - FEAT-1
---

# betterado_personal_access_token

## Why

PAT lifecycle (`POST /tokens/pats`) is createable and absent. SENSITIVE:
the token value is returned once on create and must be handled as a secret.
The vendored `delegatedauthorization` client backs this.

## Scope

- New package `azuredevops/internal/service/tokens/`.
- `betterado_personal_access_token`: display_name, scope, valid_to;
  computed Sensitive `token` (set only on create), `authorization_id`.
  Update = re-issue; Delete = revoke.

## Verification mandate

`go test ./azuredevops/internal/service/tokens/...` against an injectable
fake/gomock client (no live token issuance, no real HTTP).

## Acceptance criteria

- FEAT-1 — **Given** a fake tokens client returning a fixture PAT, **when**
  Create/Read/Delete run, **then** SDK args match, the `token` attribute
  is Sensitive and never written to logs/diagnostics, and state
  round-trips (token not re-read on Read); tests pass; name registered;
  `go build ./...` exits 0.
- FEAT-2 — `docs/resources/personal_access_token.md` includes an explicit
  secret-handling/SECURITY note; `examples/` plans clean.

## Constraints

Security-reviewer must confirm no token leakage in logs/state diffs.
Additive; vendored offline build green. Rollback: new package only.

## Council constraints (binding — LLM-Council 2026-05-18)

- Gate: `go test ./azuredevops/internal/service/tokens/...` passes + `go build -mod=vendor ./...` exits 0 + each new `betterado_*` registered in `azuredevops/provider.go`. A test pkg that compiles but asserts nothing is a FAIL.
- Per resource: 5 mock unit tests — expand↔flatten roundtrip, create API-error, read-404-clears-state, update-calls-SDK-with-args, delete API-error — mirroring upstream `resource_environment_test.go`.
- Docs (comprehensive): `docs/resources/<name>.md` (description, basic + complex example, argument & attribute reference, import) + runnable `examples/<name>/`. Edit `docs/resources/` + `examples/` only, never `website/`.
- Fixtures: inline if <20 lines else `testdata/*.json`. Never hand-edit `azdosdkmocks/` (regenerate + commit if an SDK signature changes).
- Additive & atomic: absent config reproduces prior behaviour; a quality-gate failure marks the initiative BLOCKED (no cascade to independents).

## Scope — PM: stay inside this, do NOT explore the rest of the repo

terraform-provider-betterado is a large vendored Go monorepo (286+ `*_test.go`, a huge `vendor/`). Plan work-items ONLY against:
- `azuredevops/internal/service/tokens/` — the resource + test code for this initiative (create the dir if it is new).
- `azuredevops/provider.go` — register each new `betterado_*` name here.
- The matching mock `azdosdkmocks/<area>_sdk_mock.go` (read, never edit).
- ONE existing upstream `*_test.go` in a sibling `azuredevops/internal/service/*` package as the gomock pattern to mirror.

Do NOT `Glob`/scan `vendor/`, the repo root, `website/`, or `docs/` trees — every WI's `files_in_scope` lives under the paths above. Brain-query is mandatory but bounded: 1–2 targeted queries, not broad exploration.
