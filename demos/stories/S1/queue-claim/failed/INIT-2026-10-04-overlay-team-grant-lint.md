---
initiative_id: INIT-2026-10-04-overlay-team-grant-lint
project: story-s1
project_repo_path: /home/parso/forge-m7-e/projects/story-s1
created_at: '2026-10-04T08:03:19.401Z'
iteration_budget: 8
cost_budget_usd: 8
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: >-
      schemas/overlay.schema.json is updated to add an optional spec.teams
      property typed as array of non-empty strings, with additionalProperties:
      false still enforced
    when: >-
      an overlay YAML with spec.teams: ["backend-devs"] is validated against the
      schema
    then: >-
      validation passes; an overlay with spec.teams: [123] (non-string item) is
      rejected; an overlay with spec.teams: "backend-devs" (string not array) is
      rejected; an overlay with no teams key passes
  - given: >-
      schemas/copier-module.schema.json is updated to add an optional
      _metadata.grants.teams property typed as array of non-empty strings, with
      additionalProperties: false still enforced
    when: >-
      a copier.yaml with _metadata.grants.teams: ["backend-devs"] is validated
      against the schema
    then: >-
      validation passes; _metadata.grants.teams: "backend" (string not list) is
      rejected; a copier.yaml with no grants key passes
  - given: modules/example-template/copier.yaml _metadata is updated
    when: the file is read and validated against schemas/copier-module.schema.json
    then: >-
      grants.teams exists as a list; version follows YYYYMMDD.Patch calver and
      is strictly greater than the prior value; schema validation passes
  - given: >-
      fixture modules under tests/fixtures/overlay-team-grant/modules/ declare
      grants.teams entries including "backend-devs"
    when: collect_granted_teams() runs against that fixture directory
    then: >-
      returns the lowercase union of all declared teams; a module with no grants
      key contributes nothing to the set; duplicate grants across modules are
      deduplicated
  - given: >-
      fixture overlays exist in tests/fixtures/overlay-team-grant/overlays/ —
      one referencing a granted team, one an ungrantable team, one with no teams
      key, one with empty teams array
    when: >-
      python3 -m pytest tests/test_overlay_team_grant_lint.py runs against those
      fixture directories
    then: >-
      the overlay referencing a granted team passes; the overlay referencing an
      ungrantable team fails with a message naming the fixture filename and
      team; the overlay with no teams key passes vacuously; the overlay with
      empty teams array passes vacuously
  - given: >-
      a fixture module declares grants.teams: ["backend-devs"] (lowercase) and a
      fixture overlay declares spec.teams: ["Backend-Devs"] (mixed case)
    when: the lint runs against those fixtures
    then: >-
      the overlay passes — comparison is case-insensitive (both sides normalised
      to lowercase)
  - given: the actual modules/ and config/repos/ directories in the repository
    when: >-
      python3 -m pytest tests/ runs (specifically
      test_real_overlays_have_no_ungrantable_teams)
    then: >-
      the test passes on current clean config (no broken grants in live
      overlays); all violations are accumulated before asserting so a single run
      surfaces every broken grant; if a future overlay in config/repos/ declares
      a team not granted by any module in modules/, the test fails naming the
      file and team — this gate is structural, not fixture-only
  - given: >-
      conftest.py collect_ignore does NOT list
      tests/test_overlay_team_grant_lint.py
    when: python3 -m pytest tests/ runs
    then: >-
      tests from test_overlay_team_grant_lint.py are collected and executed; the
      total collected count includes those tests; no '[no tests to run]' is
      reported for that module
title: 'Overlay team-grant lint: fail pytest when an overlay names an ungrantable team'
cycle_id: 2026-10-04T08-05-06_INIT-2026-10-04-overlay-team-grant-lint
flow_id: forge-architect
architect_session_id: 2026-10-04T07-52-48-dea15f74
architect_cost_usd: 2.6495551999999996
architect_duration_ms: 737218
flow_version: 1
claim_blocked_clauses: 
---

## Context

Repo overlay YAMLs in `config/repos/` can currently reference team names that no module in the org actually grants — this misconfiguration would reach GitHub silently. The operator wants a structural lint, enforced by the existing `python3 -m pytest tests/` gate, that catches such mismatches before apply.

## Technical approach

**Schema additions** (no existing command changed):

1. `schemas/overlay.schema.json` — add optional `spec.teams` property: array of non-empty strings. `additionalProperties: false` stays.
2. `schemas/copier-module.schema.json` — add optional `_metadata.grants.teams` property: array of non-empty strings. `additionalProperties: false` stays.

**Module declaration** (example-template only — not applied to live config):

3. `modules/example-template/copier.yaml` — add `grants.teams: []` to `_metadata`; bump calver version (YYYYMMDD.Patch).

**Lint implementation + tests** (TDD — add file to `conftest.py::collect_ignore` first; remove once passing):

4. `tests/test_overlay_team_grant_lint.py`:
   - `collect_granted_teams(modules_dir: Path) → set[str]` — walks `modules/*/copier.yaml`, reads `_metadata.grants.teams`, normalises all values to lowercase, returns union.
   - `collect_overlay_team_requirements(config_repos_dir: Path) → dict[str, list[str]]` — walks `config/repos/*.yaml`, returns `{filename: [teams]}` for overlays with a non-empty `spec.teams`.
   - **Fixture unit tests** using YAMLs under `tests/fixtures/overlay-team-grant/`: a module fixture granting `backend-devs`; `overlay-pass.yaml` (`spec.teams: [backend-devs]`); `overlay-fail.yaml` (`spec.teams: [unknown-team]`); `overlay-no-teams.yaml` (no `teams` key); `overlay-empty-teams.yaml` (`spec.teams: []`); `overlay-case.yaml` (`spec.teams: [Backend-Devs]`).
   - **`test_real_overlays_have_no_ungrantable_teams()`** — reads the actual repository `modules/` and `config/repos/` directories; accumulates ALL violations before asserting; fails with `f"overlay {filename}: team '{team}' not granted by any module in modules/"` for every violation found.

5. `conftest.py` — remove `tests/test_overlay_team_grant_lint.py` from `collect_ignore` once implementation passes.

## Not in scope

- No changes to `apply-overlays.py`, `validate` scripts, or any existing CLI command — human-readable output of existing commands is unchanged.
- No changes to `config/orgs/*.yaml` (operator-owned).
- No changes to `infra/` or `.terraform/` (operator-owned Terraform state).
- No GitHub Actions workflow changes — CI already runs `python3 -m pytest tests/`.
- The lint is **org-scoped**: any module in `modules/` contributes to the allowed set regardless of which modules an overlay applies. Per-overlay scoped enforcement is out of scope.
- No pre-commit hooks or runtime enforcement — the lint is a pytest test only.
- No changes to live `config/repos/*.yaml` to add `teams` fields — that is operator work after the lint ships.
