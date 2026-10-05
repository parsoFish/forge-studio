---
initiative_id: INIT-2026-10-05-overlay-team-grant-lint
project: story-s1
project_repo_path: /home/parso/forge-docs-w0w1-run/projects/story-s1
created_at: '2026-10-05T16:24:32.083Z'
iteration_budget: 4
cost_budget_usd: 3
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: >-
      `schemas/overlay.schema.json` has `additionalProperties: false` on `spec`
      and `schemas/copier-module.schema.json` has no `grants_teams` field
    when: >-
      both schemas are extended and `python -m pytest
      tests/test_overlay_schema.py` runs
    then: >-
      all existing schema tests pass, `spec.teams` (optional string array) is
      accepted in the overlay schema, `_metadata.grants_teams` (optional string
      array) is accepted in the copier-module schema, and
      `TestAdditionalPropertiesRejected` still rejects unknown `spec` keys
  - given: >-
      `validate_overlay_configs.py` is modified and `modules/` contains
      copier.yaml files some with `_metadata.grants_teams` and one with
      malformed YAML
    when: the script validates any overlay
    then: >-
      it performs a pre-loop recursive glob of `modules/**/copier.yaml`, builds
      a frozenset of all `grants_teams` slugs from parseable files, emits a
      stderr warning for the malformed file without crashing, and passes that
      frozenset into the per-overlay team check — never reading `infra/` or
      `config/orgs/` paths (source: profile.md forge:constraint
      no-infra-state-mutation)
  - given: >-
      a fixture overlay with `spec.teams: ["platform"]` and a module fixture
      with `_metadata.grants_teams: ["platform"]`
    when: '`python scripts/validate_overlay_configs.py <overlay-path>` runs'
    then: >-
      output contains exactly `OK <filename>.yaml`, no FAIL lines appear, and
      exit code is 0
  - given: >-
      a fixture overlay with `spec.teams: ["missing-team"]` and no module in
      `modules/` grants `"missing-team"`
    when: '`python scripts/validate_overlay_configs.py <overlay-path>` runs'
    then: >-
      output contains `FAIL <filename>.yaml: team 'missing-team' not granted by
      any module`, exit code is non-zero, and the `Validated N files` summary
      line format is unchanged
  - given: >-
      a fixture overlay with `spec.teams: ["frontend", "missing-team"]` where
      only `"frontend"` is in the collected grant set
    when: '`python scripts/validate_overlay_configs.py <overlay-path>` runs'
    then: >-
      exactly one FAIL line appears for `"missing-team"`, no FAIL line appears
      for `"frontend"`, and both findings are returned in a single run without
      early exit on first failure
  - given: >-
      an overlay fixture with no `spec.teams` field (matching all current
      overlays including `config/repos/example.yaml`)
    when: '`python -m pytest tests/` runs after the changes'
    then: >-
      all existing tests pass and the overlay produces only the existing `OK
      filename.yaml` line with no additional output
  - given: >-
      `modules/` contains no `copier.yaml` with any `grants_teams` declarations
      (empty grant set)
    when: 'the lint checks a fixture overlay with `spec.teams: ["any-team"]`'
    then: >-
      lint produces a FAIL line for `"any-team"` (not a crash, not a silent
      pass), and `python -m pytest tests/test_team_grant_lint.py` includes a
      test that exercises this case
  - given: >-
      `tests/test_team_grant_lint.py` exists with fixture-based tests covering:
      grant collection, passing lint, failing lint, partial-failure
      full-reporting, empty grant set, malformed copier.yaml skip-with-warning,
      and no-teams overlay pass-through
    when: '`python -m pytest tests/test_team_grant_lint.py -v` runs'
    then: >-
      all tests pass — confirming the gate is not vacuous and the
      quality-gate-cmd-must-assert-new-work antipattern is avoided (source:
      brain/cycles/antipatterns.md → quality-gate-cmd-must-assert-new-work)
title: Add team-grant lint to overlay validation
cycle_id: 2026-10-05T16-25-13_INIT-2026-10-05-overlay-team-grant-lint
flow_id: forge-architect
architect_session_id: 2026-10-05T16-15-34-2875e559
architect_cost_usd: 2.3652468
architect_duration_ms: 578657
---

## Context

`validate_overlay_configs.py` validates repo overlay YAML files against schema and module membership but has no awareness of GitHub team grants. Overlays can declare `spec.teams` (teams to grant), but modules declare which teams they grant via `_metadata.grants_teams` in `copier.yaml`. A misconfigured overlay naming an ungrantable team currently reaches GitHub silently.

## Integration point

The team-grant check integrates into `validate_overlay_configs.py` **at its existing per-overlay validation call site** — the loop that already runs per-overlay schema and module checks. No new standalone script. No new CLI scan command.

Two additions to `validate_overlay_configs.py`:

1. **Pre-loop grant-collection pass** — walk `modules/**/copier.yaml` recursively (glob, not one-level scan), collect all `_metadata.grants_teams` slugs into a frozenset. A module whose `copier.yaml` cannot be parsed as YAML is skipped with a warning to stderr; it does not crash the linter. `config/orgs/`, `infra/`, and all state files are never read.

2. **Per-overlay team check** — for each overlay, if `spec.teams` is present, assert every slug is in the collected frozenset. Non-matching slugs produce `FAIL filename.yaml: team 'X' not granted by any module`. All failures reported in one pass; no early exit on first bad reference.

## Schema changes (prerequisite sub-task)

Both schemas need extending before the semantic lint is meaningful:

- `schemas/overlay.schema.json`: add optional `spec.teams` — `type: array, items: {type: string}` with a description noting slugs must be exact canonical form (case-sensitive lowercase-hyphen). `additionalProperties: false` on `spec` currently rejects unknown keys; the field must be declared explicitly.
- `schemas/copier-module.schema.json`: add optional `_metadata.grants_teams` — `type: array, items: {type: string}`.

`TestAdditionalPropertiesRejected` continues to reject unknown `spec` keys after the addition of `spec.teams`.

## Output format contract

Preserved exactly. New FAIL lines follow the existing pattern:
```
FAIL filename.yaml: team 'X' not granted by any module
```
The `Validated N files` summary line format is unchanged. Overlays with no `spec.teams` field produce only the existing `OK filename.yaml` line — no new output.

## Test strategy (TDD)

`tests/test_team_grant_lint.py` is written **first** with fixture-based tests, then the lint is implemented. Gate: `python -m pytest tests/test_team_grant_lint.py`. Existing `tests/test_overlay_schema.py` must pass unchanged.

Fixtures live under `tests/fixtures/team_grant/` and cover:
- a module tree with and without `grants_teams` declarations
- a malformed `copier.yaml` alongside valid ones
- overlays with zero, one, and multiple `spec.teams` entries (passing, failing, mixed)

## Not in scope

- Changes to `scripts/apply-overlays.py`, `scripts/bootstrap.sh`, or any other existing script
- Reading `infra/*.tfstate`, `infra/.terraform/`, or `config/orgs/*.yaml`
- Checking team grants against the live GitHub API
- Module-version-aware grant scoping (all module versions treated equally)
- Changes to the `apply-overlays.py` execution path
