---
initiative_id: INIT-2026-10-03-overlay-team-lint
project: story-s1
project_repo_path: /home/parso/forge-m7-e/projects/story-s1
created_at: '2026-10-03T22:35:34.379Z'
iteration_budget: 4
cost_budget_usd: 3
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: >-
      `schemas/overlay.schema.json` and the `_metadata` sub-schema in
      `schemas/copier-module.schema.json` are updated with the new optional
      fields
    when: >-
      an overlay with `spec.teams: []` and a module with no `grants_teams` field
      are validated against their schemas
    then: jsonschema validation passes and all 134 existing tests remain green
  - given: >-
      `scripts/lint_overlay_teams.py` exists and a repo overlay's `spec.teams`
      names a team absent from every applied module's `grants_teams`
    when: >-
      `lint_overlay_teams.py` is run against that overlay with no `GITHUB_TOKEN`
      set
    then: >-
      it exits non-zero, prints the offending team slug and the overlay file
      name, and reads no network resource
  - given: >-
      a repo overlay's `spec.teams` entries are all present in the union of its
      applied modules' `grants_teams`
    when: '`lint_overlay_teams.py` is run against that overlay'
    then: it exits 0 with no error output
  - given: >-
      `scripts/bootstrap.sh --check` is invoked against an overlay with a broken
      team grant
    when: the `--check` step executes
    then: >-
      it calls `lint_overlay_teams.py`, exits non-zero, and produces no changes
      to the human-readable output of other `--check` steps (brain:
      `suppression-env-fakes-the-pass`)
  - given: >-
      `tests/test_overlay_team_lint.py` and
      `tests/test_overlay_team_lint_integration.py` exist with named test
      functions for every unit case and one parameterised integration case per
      file in `config/repos/`
    when: '`python -m pytest tests/` is run'
    then: >-
      all tests pass, total test count exceeds 134, and
      `test_overlay_team_lint.py` appears in the collected output (brain:
      `quality-gate-cmd-must-assert-new-work`)
  - given: >-
      a parameterised integration test runs `lint_overlay_teams.py` against
      every file in `config/repos/` as part of `python -m pytest tests/`
    when: CI runs the existing quality gate
    then: >-
      every current real overlay passes lint, closing the
      declared-data-fails-open chain without any CI workflow YAML change (brain:
      `declared-data-fails-open`)
title: Overlay team-grant lint with CI enforcement via pytest
cycle_id: 2026-10-03T22-36-36_INIT-2026-10-03-overlay-team-lint
flow_id: forge-architect
architect_session_id: 2026-10-03T22-22-44-d64781e8
architect_cost_usd: 3.6620710000000005
architect_duration_ms: 831486
flow_version: 1
claim_blocked_clauses: 
---

## Context

Repo overlays in `config/repos/` can name teams via a new optional `spec.teams` field. Today no gate checks that every named team is actually granted by the applied modules. A broken grant silently reaches GitHub.

The lint must close the full declared-data-fails-open chain (brain: `declared-data-fails-open`, `suppression-env-fakes-the-pass`):

> schema declares → lint reads → bootstrap --check calls lint → CI catches real overlay violations

CI runs `python -m pytest tests/` only. The hook for 'CI catches real overlays' is a parameterised pytest test that runs the lint against the actual `config/repos/*.yaml` files — **no CI workflow YAML changes required**.

## Deliverables

### 1. Schema changes (backward-compatible)

- `schemas/overlay.schema.json` — add optional `spec.teams` (array of lowercase-hyphen strings).
- `schemas/copier-module.schema.json` `_metadata` sub-schema — add optional `grants_teams` (array of strings). A module with no `grants_teams` grants zero teams (strict default).

### 2. `scripts/lint_overlay_teams.py`

Standalone Python module. No new dependencies — `yaml.safe_load` + `jsonschema` already present.

- Accepts one or more overlay file paths.
- For each overlay: reads `spec.teams` (default `[]`).
- Resolves applied modules from `spec.modules`; reads each module's `grants_teams` (default `[]`).
- Granted set = union of all applied modules' `grants_teams`.
- For every entry in `spec.teams` not in the granted set: prints `FAIL <overlay>: team '<slug>' not granted by any applied module` and exits non-zero.
- Case-normalises both sides to lowercase before comparison.
- Module not found in `modules/` — pre-existing Contract 2 check fires; lint asserts modules present before running team check.
- Reads only local files. No `GITHUB_TOKEN`, no `gh` CLI. Environment-independent.

### 3. `scripts/bootstrap.sh --check` wiring

The `--check` step calls `python scripts/lint_overlay_teams.py <overlays>`. Human-readable output of all other `--check` steps unchanged.

### 4. Tests

`tests/test_overlay_team_lint.py` — unit tests:
- `spec.teams` absent → no-op
- `spec.teams: []` → no-op
- Granted team → exits 0
- Ungranted team → exits non-zero, error includes slug and file name
- Multiple modules → union semantics (team granted by any module passes)
- Missing module → pre-existing guard fires before team check
- Case normalisation (`Engineering` == `engineering`)

`tests/test_overlay_team_lint_integration.py` — CI enforcement hook:
- Parameterised over every file in `config/repos/*.yaml`.
- Runs `lint_overlay_teams.py` against each real overlay.
- All current real overlays must pass (none name teams today; `spec.teams` absent is a no-op).
- A PR that adds an overlay with a broken grant fails `python -m pytest tests/`.

## Not in scope

- Changes to `validate_overlay_configs.py` or existing scan commands.
- Sub-team hierarchy / parent-grants-child semantics — exact slug match only; a module granting `engineering` does NOT implicitly grant `platform`.
- Cross-referencing `config/teams.yaml` for team existence — Terraform validation owns that gate.
- CI workflow YAML changes (`.github/workflows/`).
- Human-readable output changes to any existing command.
