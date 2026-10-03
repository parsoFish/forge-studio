---
initiative_id: INIT-2026-10-03-overlay-team-grant-lint
project: story-s1
project_repo_path: /home/parso/forge-clean-m7e/projects/story-s1
created_at: '2026-10-03T11:06:34.137Z'
iteration_budget: 3
cost_budget_usd: 6
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: >-
      overlay.schema.json currently rejects unknown spec keys via
      additionalProperties:false, and copier-module.schema.json _metadata does
      the same
    when: >-
      the schemas are amended to add an optional spec.teams array (items: {name:
      string, permission: string}) and an optional _metadata.grants array
      (items: string)
    then: >-
      python -m pytest tests/test_overlay_schema.py tests/test_copier_schema.py
      tests/test_copier_schema_ci.py passes with no regressions — existing
      fixtures require no modification
  - given: >-
      an overlay referencing module-a (grants: [platform]) and module-b (grants:
      [engineering]) with spec.teams: [{name: platform}, {name: engineering}]
    when: python -m pytest tests/test_overlay_team_grants.py runs
    then: >-
      the union-grant fixture passes — a team grantable by any one applied
      module is accepted
  - given: >-
      an overlay declaring spec.teams with a team name not granted by any
      applied module
    when: python -m pytest tests/test_overlay_team_grants.py runs
    then: >-
      the test asserts lint failure, and the failure message names the violating
      team slug and the overlay file path
  - given: >-
      an overlay whose spec.modules references a module name with no matching
      directory under modules/
    when: python -m pytest tests/test_overlay_team_grants.py runs
    then: >-
      the test asserts a descriptive lint failure naming the missing module — it
      does not silently skip and pass
  - given: >-
      an overlay with no spec.teams field (config/repos/example.yaml is
      unchanged)
    when: python -m pytest tests/test_overlay_team_grants.py runs
    then: >-
      the lint skips team grant checking entirely and the fixture passes —
      example.yaml must not be modified
  - given: >-
      fixture A references a module whose copier.yaml _metadata has NO grants
      key, and fixture B references a separate module whose copier.yaml
      _metadata has grants: [] — both overlays declare spec.teams
    when: python -m pytest tests/test_overlay_team_grants.py runs
    then: >-
      both fixtures fail the lint independently — absent-grants and
      empty-array-grants are treated as zero grants, each exercised by a
      distinct named test case (e.g. test_absent_grants_zero and
      test_empty_grants_zero)
  - given: >-
      a module grants 'platform' (lowercase) and an overlay spec.teams names
      'Platform' (mixed case)
    when: python -m pytest tests/test_overlay_team_grants.py runs
    then: >-
      the lint fails the fixture — matching is case-sensitive with no
      normalisation; the failure message includes both the overlay value and the
      module-granted value
  - given: >-
      a module copier.yaml contains invalid YAML syntax and an overlay
      references that module
    when: python -m pytest tests/test_overlay_team_grants.py runs
    then: >-
      pytest reports a FAILED test (not an ERROR / unhandled exception) with a
      message identifying the malformed file path
  - given: config/orgs/ contains YAML files and the full test suite runs
    when: python -m pytest tests/test_overlay_team_grants.py runs
    then: >-
      no file under config/orgs/ is opened and no file is written anywhere — the
      lint reads only modules/ and config/repos/, strictly read-only
  - given: the new test file is placed at tests/test_overlay_team_grants.py
    when: >-
      the full quality gate python -m pytest tests/test_structure.py
      tests/test_overlay_schema.py tests/test_copier_schema.py
      tests/test_copier_schema_ci.py runs WITHOUT explicitly naming
      test_overlay_team_grants.py
    then: >-
      the run still passes (the new file is additive and must not break the
      standing gate); AND running python -m pytest
      tests/test_overlay_team_grants.py in isolation also passes — the PM must
      set quality_gate_cmd to this isolated invocation, not the broader suite,
      so a missing or misnamed file cannot vacuously pass
title: 'Add overlay lint: fail when a repo requests an ungranted team'
cycle_id: 2026-10-03T11-07-51_INIT-2026-10-03-overlay-team-grant-lint
flow_id: forge-architect
architect_session_id: 2026-10-03T10-58-22-4b0ca059
architect_cost_usd: 2.3926179
architect_duration_ms: 568567
---

## Context

GitWeave overlays declare which GitHub teams a repo grants via `spec.teams`. Today nothing checks that those teams are actually granted by the modules the overlay applies — a typo or stale team name silently passes CI and only fails when GitHub rejects the apply. This initiative adds a pytest-native lint that reads each applied module's declared grants, computes their union, and fails any overlay whose `spec.teams` names a team outside that union.

## What to build

### 1. Schema amendments (same PR, no split)

- **`schemas/overlay.schema.json`** — add optional `spec.teams` array under the `spec` object. Each item: `{name: string (required), permission: string (optional)}`. The spec object has `additionalProperties: false` on line 34; the amendment must be inside that object's `properties` map.
- **`schemas/copier-module.schema.json`** — add optional `grants` array (items: string) under the `_metadata` object. The `_metadata` object has `additionalProperties: false` on line 12; same constraint.
- Run `tests/test_overlay_schema.py`, `tests/test_copier_schema.py`, `tests/test_copier_schema_ci.py` after each schema edit to confirm zero regressions before writing a single test fixture.

### 2. Test file: `tests/test_overlay_team_grants.py`

Pure pytest — no subprocess calls, no `apply-overlays.py` invocation. The lint logic lives entirely inside this file or a helper imported by it (not in a new application module unless the PM determines otherwise).

Required fixtures (each as a self-contained tmp-path or in-repo fixture directory):

| Fixture name | Outcome | Notes |
|---|---|---|  
| `union-grant-pass` | PASS | module-a grants [platform], module-b grants [engineering]; overlay teams [platform, engineering] |
| `ungrantable-team-fail` | FAIL | overlay teams a team no module grants; message names team + file |
| `missing-module-fail` | FAIL | overlay references non-existent module directory |
| `no-spec-teams-pass` | PASS | overlay omits spec.teams entirely |
| `absent-grants-zero-fail` | FAIL | module has no grants key; overlay declares spec.teams |
| `empty-grants-zero-fail` | FAIL | module has grants: []; overlay declares spec.teams — DISTINCT from absent-grants fixture |
| `case-sensitive-fail` | FAIL | module grants 'platform'; overlay teams 'Platform' |
| `malformed-yaml-fail` | FAIL (not ERROR) | module copier.yaml is invalid YAML |
| `org-config-untouched` | PASS | confirm config/orgs/ is never opened |

Glob pattern for repo overlays must be `config/repos/**/*.yaml` — never `config/orgs/`.

### 3. `config/repos/example.yaml` — no changes

`spec.teams` is optional. The canonical passing fixture must not be modified. All existing tests that use `example.yaml` must continue to pass unchanged.

## Not in scope

- Any changes to existing scan commands or their human-readable output.
- A new GitHub Actions workflow file — the lint runs under the existing pytest gate only.
- Integration with `apply-overlays.py` — the lint is filesystem-read-only.
- Modifying `config/orgs/*.yaml` — locked-core.
- Modifying Terraform state files — locked-core.
- Permission enforcement beyond lint failure (the lint does not apply or revert grants).
- Handling GitHub API calls or live team resolution — purely filesystem.

## PM notes

- **`quality_gate_cmd`** for the WI that delivers `tests/test_overlay_team_grants.py` MUST be `python -m pytest tests/test_overlay_team_grants.py` — not `pytest tests/` — to prevent a vacuous pass if the file is missing or misnamed. _(antipattern: brain/cycles/antipatterns.md → quality-gate-cmd-must-assert-new-work)_
- The schema amendments and the test file are a single atomic WI or two tightly coupled WIs with `depends_on` — they must land in the same PR. The schema test regressions are the correctness gate for the schema work.
- `apply-overlays.py` must never be called in any test — locked-core dry-run constraint.
