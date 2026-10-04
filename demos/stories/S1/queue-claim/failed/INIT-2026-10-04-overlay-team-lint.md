---
initiative_id: INIT-2026-10-04-overlay-team-lint
project: story-s1
project_repo_path: /home/parso/forge-clean-m7e/projects/story-s1
created_at: '2026-10-04T15:28:37.432Z'
iteration_budget: 6
cost_budget_usd: 3
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: >-
      an overlay YAML with `spec.modules: [example-template]` and `spec.teams:
      [example-team]` (where example-template grants example-team)
    when: '`validate_overlay_configs.py` runs against it'
    then: exits zero and the output contains no `LINT-FAIL` line
  - given: >-
      an overlay YAML with `spec.modules: [example-template]` and `spec.teams:
      [unknown-team]` (where no referenced module grants unknown-team)
    when: '`validate_overlay_configs.py` runs against it'
    then: >-
      exits non-zero and emits `LINT-FAIL <file>: team 'unknown-team' not
      granted by any module in spec.modules`
  - given: an overlay YAML whose `spec` block has no `spec.teams` field
    when: '`validate_overlay_configs.py` runs against it'
    then: exits zero with no LINT-FAIL line (field absent = no constraint)
  - given: the same valid-grant and invalid-grant overlay cases used above
    when: '`apply-overlays.py` processes them'
    then: >-
      lint outcomes (exit code and LINT-FAIL presence) are identical to those
      produced by `validate_overlay_configs.py`
  - given: >-
      `tests/test_overlay_team_lint.py` exists and contains at least one test
      that directly invokes `lint_team_grants` with an unknown-team overlay and
      asserts the returned violations list is non-empty
    when: '`python -m pytest tests/test_overlay_team_lint.py` runs'
    then: all tests pass
  - given: the complete implementation landed
    when: >-
      `python -m pytest tests/test_validate_overlay_configs_script.py
      tests/test_apply_overlays_behavioral_contracts.py` runs
    then: >-
      all pre-existing tests in both files pass unchanged (explicit regression
      guard for both modified scripts)
  - given: the full implementation with tests
    when: '`python -m pytest tests/` runs'
    then: >-
      all tests pass and the total passing test count is greater than before
      this initiative began (gate is non-vacuous)
title: Implement overlay team lint in validate and apply paths
cycle_id: 2026-10-04T15-29-34_INIT-2026-10-04-overlay-team-lint
flow_id: forge-architect
architect_session_id: 2026-10-04T15-15-22-61928e32
architect_cost_usd: 3.3157028000000004
architect_duration_ms: 851638
depends_on_initiatives:
  - INIT-2026-10-04-overlay-schema-teams-field
  - INIT-2026-10-04-module-grants-teams-metadata
flow_version: 1
claim_blocked_clauses: 
---

## Context

Scope: onboarding path only. Two call sites — `validate_overlay_configs.py` (pre-apply schema check, runs on `gw:plan`) and `apply-overlays.py` (apply path) — must both run the team lint so the check fires at every onboarding entry point.

## Shared lint function

```python
def lint_team_grants(overlay_path, overlay_data, modules_dir) -> list[str]:
    """Return list of LINT-FAIL messages; empty = pass."""
    teams = overlay_data.get('spec', {}).get('teams') or []
    if not teams:
        return []
    module_slugs = overlay_data.get('spec', {}).get('modules') or []
    granted = set()
    for slug in module_slugs:
        cy = modules_dir / slug / 'copier.yaml'
        if cy.exists():
            granted.update(t.lower() for t in (load_yaml(cy).get('grants_teams') or []))
    violations = []
    for team in teams:
        if team.lower() not in granted:
            violations.append(
                f"LINT-FAIL {overlay_path}: team '{team}' not granted by any module in spec.modules"
            )
    return violations
```

Callers append messages to their output and exit non-zero if violations are non-empty. Existing OK/FAIL/Validated lines in `validate_overlay_configs.py` must stay byte-identical; LINT-FAIL lines are new additions that do not alter the existing output contract.

## Design decision: spec.modules-scoped, not org-wide

_In the context of_ **team-grant validity** [situation], _facing_ **whether to check all `modules/` in the org or only the overlay's declared `spec.modules`** [concern], _we chose_ **check only `spec.modules`** [decision] _to achieve_ **semantic accuracy — an overlay can only inherit grants from modules it actually applies** [goal], _accepting tradeoff_ **an overlay must list a module in `spec.modules` to benefit from its grants, even if that module exists in the org** [tradeoff].

The operator idea said "no module in the org actually grants"; two interview questions on this scope were deflected with out-of-scope answers. This decision is stated explicitly so a future operator can widen the scope if org-wide semantics are desired. If that scope is wanted, the change is one line: replace the `module_slugs` loop with a walk of `modules_dir/*/copier.yaml`.

## Implementation notes

- `apply-overlays.py`: call `lint_team_grants` **after** the existing module-existence check (Contract 2 in `test_apply_overlays_behavioral_contracts.py`). Module existence is a prerequisite — the lint does not need to handle missing modules.
- Case-insensitive comparison: normalise both sides to lowercase before membership check.
- Missing `grants_teams` key in a module's copier.yaml → treated as `[]`, not an error.
- `config/teams.yaml` (Terraform org registry) is NOT consulted — that conflates two separate concerns.

## Not in scope

- Changes to `gw scan` or any CLI command outside the onboarding path.
- Cross-validation against `config/teams.yaml`.
- Changes to `apply-overlays.py` beyond adding the `lint_team_grants` call.
