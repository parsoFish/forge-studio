---
initiative_id: INIT-2026-09-26-overlay-team-lint
project: story-s1
project_repo_path: /home/parso/forge-m7-d-s1/projects/story-s1
created_at: '2026-09-26T10:40:21.021Z'
iteration_budget: 3
cost_budget_usd: 3
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: >-
      overlay.schema.json has spec.teams declared as an optional array of
      strings
    when: an existing overlay with no spec.teams field is validated
    then: schema validation passes and the Validated N count is unaffected
  - given: >-
      config/teams.yaml lists team slugs including 'engineering' and an overlay
      declares spec.teams: [engineering]
    when: validate_overlay_configs.py runs in directory mode
    then: that overlay produces an OK line and the overall exit code is 0
  - given: >-
      config/teams.yaml lists ['engineering'] and an overlay declares
      spec.teams: [engineering, ghost-team, phantom]
    when: validate_overlay_configs.py runs in directory mode
    then: >-
      that overlay produces a FAIL line naming all unknown slugs ('ghost-team',
      'phantom') in one message, and exit code is non-zero
  - given: >-
      config/teams.yaml lists ['engineering'] and two overlay files are passed
      by path — one with a valid slug and one with an unknown slug
    when: >-
      validate_overlay_configs.py is invoked as 'python
      validate_overlay_configs.py file1.yaml file2.yaml'
    then: >-
      the unknown-slug file produces a FAIL line, the valid-slug file produces
      an OK line, and exit code is non-zero; confirming team-check executes in
      file-path mode
  - given: config/teams.yaml is absent from the repository
    when: validate_overlay_configs.py runs against any overlay
    then: >-
      exit code is non-zero and a clear error message is printed (not a silent
      pass)
  - given: config/teams.yaml contains invalid YAML syntax
    when: validate_overlay_configs.py runs
    then: >-
      exit code is non-zero and a clear error message identifies the parse
      failure
  - given: >-
      config/teams.yaml has 'teams: null' or 'teams: []' (empty registry) and an
      overlay declares spec.teams: [any-slug]
    when: validate_overlay_configs.py runs
    then: >-
      that overlay FAILS (the slug registry is empty so no slug is valid); an
      overlay with no spec.teams or spec.teams: [] against the same teams.yaml
      passes trivially
  - given: 'an overlay has no spec.teams field, or spec.teams: []'
    when: validate_overlay_configs.py runs with a populated teams.yaml
    then: the overlay passes the team-check step with an OK line; no false positives
  - given: >-
      tests/test_overlay_team_lint.py exists and each test case writes its own
      tempdir with a controlled teams.yaml and overlay file(s)
    when: python -m pytest tests/ is run
    then: >-
      all new test cases pass; no test reads from the real config/teams.yaml
      (environment-independence verified by running the suite against a tempdir
      that has no real teams.yaml on its path)
  - given: spec.teams is added as an optional field to overlay.schema.json
    when: python -m pytest tests/test_overlay_schema.py is run
    then: >-
      all pre-existing schema tests pass unchanged, and the FAIL/OK/Validated N
      output format produced by validate_overlay_configs.py is identical to its
      pre-change format
title: Add team-slug cross-reference lint to overlay validator
cycle_id: 2026-09-26T10-42-04_INIT-2026-09-26-overlay-team-lint
flow_id: forge-architect
architect_session_id: 2026-09-26T10-30-37-40aefd0d
architect_cost_usd: 2.6992575000000008
architect_duration_ms: 686665
---

## Context

Overlay configs at `config/repos/*.yaml` can declare `spec.teams` — a list of team slugs to grant access to a repo. Today nothing checks whether those slugs exist. A typo or deleted team silently reaches the Terraform plan. This initiative adds a cross-reference lint: `validate_overlay_configs.py` loads `config/teams.yaml` as the slug registry and fails any overlay that names an unknown team.

## Technical approach

1. **Schema change** — add `spec.teams` as an optional `array` of `string` items to `overlay.schema.json` (the `spec` object, alongside existing fields). `additionalProperties: false` already rejects unknown keys, so the field must be declared or every overlay with it fails schema validation before the team check runs.

2. **Team-check logic** — in `validate_overlay_configs.py`:
   - Load `config/teams.yaml` (relative to repo root, same derivation as `DEFAULT_SCHEMA_PATH`). If missing or unreadable → `sys.exit(1)` with a clear error. If YAML is malformed → same. If `teams` key is `null` or `[]` → slug registry is empty (any non-empty `spec.teams` will fail; empty/absent `spec.teams` passes trivially).
   - After schema validation passes for a file, if `spec.teams` is present and non-empty, check every slug against the registry. Collect ALL unknown slugs per file; emit one `FAIL filename: spec.teams references unknown team(s): [slug1, slug2]` line. Integrate into the existing per-file result tuple so the aggregate FAIL/OK/Validated N output format is unchanged.
   - The check must execute in both invocation modes: directory scan (`python -m validate_overlay_configs`) and file-path mode (`python validate_overlay_configs.py file1.yaml file2.yaml`).

3. **Tests** — new `tests/test_overlay_team_lint.py`. Every test case writes its own tempdir fixture (controlled `teams.yaml` + overlay files). No test reads from the real `config/teams.yaml` — that is ambient state, not a test precondition.

## Not in scope

- No changes to existing `forge scan` or any other scan commands — onboarding path only.
- No normalization of team slug case — exact string comparison; an uppercase variant fails the lint (document in error message).
- No per-module `grants` declaration in `copier.yaml` — the source of truth is `config/teams.yaml` exclusively.
- No changes to `config/teams.yaml`, `config/orgs/*.yaml`, or `infra/` state files — operator-managed, read-only for this lint.
- No new output patterns — FAIL/OK/Validated N format is locked.

## Decision log

- In the context of **slug source of truth**, facing **two options (teams.yaml vs per-module copier.yaml)**, we chose **config/teams.yaml** to achieve **minimal surface change**, accepting tradeoff **per-module copier.yaml could express finer-grained grants but is out of scope for this initiative**.
- In the context of **case normalization**, facing **'Engineering' vs 'engineering'**, we chose **exact string comparison** to achieve **simplicity and correctness per schema conventions**, accepting tradeoff **an uppercase variant fails; error message documents this**.
- In the context of **teams: null behaviour**, facing **treat as YAML error vs treat as empty registry**, we chose **empty registry** (valid state) to achieve **consistent semantics**: any non-empty `spec.teams` fails; empty/absent `spec.teams` passes trivially.
