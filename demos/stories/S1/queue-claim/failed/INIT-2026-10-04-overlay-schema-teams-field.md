---
initiative_id: INIT-2026-10-04-overlay-schema-teams-field
project: story-s1
project_repo_path: /home/parso/forge-clean-m7e/projects/story-s1
created_at: '2026-10-04T15:28:37.432Z'
iteration_budget: 3
cost_budget_usd: 1
phase: pending
origin: architect
class: config
acceptance_criteria:
  - given: 'An overlay YAML with `spec.teams: ["dev-team"]` under its `spec` block'
    when: it is validated against the updated `schemas/overlay.schema.json`
    then: validation passes (no schema errors)
  - given: An overlay YAML whose `spec` block omits `spec.teams` entirely
    when: it is validated against the updated `schemas/overlay.schema.json`
    then: validation passes (field is optional)
  - given: >-
      The `spec.teams` field added to the schema alongside coordinated fixture
      updates
    when: '`python -m pytest tests/test_overlay_schema.py` runs'
    then: >-
      all pre-existing tests pass AND at least one new test covering
      `spec.teams` is present and passes
title: Add spec.teams field to overlay schema
cycle_id: 2026-10-04T15-29-34_INIT-2026-10-04-overlay-schema-teams-field
flow_id: forge-architect
architect_session_id: 2026-10-04T15-15-22-61928e32
architect_cost_usd: 3.3157028000000004
architect_duration_ms: 851638
flow_version: 1
claim_blocked_clauses: 
---

## Context

`schemas/overlay.schema.json` currently has no `spec.teams` field. The team lint has nothing to read until this field exists. Because `additionalProperties: false` is already enforced on the overlay spec, the schema addition and its test fixture updates must land in the same commit — a schema-only change breaks `test_overlay_schema.py`.

## What changes

- `schemas/overlay.schema.json` — add `spec.teams` as an optional `array` of `string` (team slugs) under `spec`. No default; absent = no constraint.
- Any overlay fixture files used by `tests/test_overlay_schema.py` — add at least one fixture with `spec.teams` populated and one without, so the optional-field invariant is exercised.
- `tests/test_overlay_schema.py` — add tests covering the new field (present + absent).

## Not in scope

No lint logic. No changes to `apply-overlays.py` or `validate_overlay_configs.py`. No changes to `config/repos/` overlays. This initiative only makes the schema aware of the field.
