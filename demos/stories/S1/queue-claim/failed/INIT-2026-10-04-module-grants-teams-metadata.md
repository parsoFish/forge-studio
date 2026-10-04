---
initiative_id: INIT-2026-10-04-module-grants-teams-metadata
project: story-s1
project_repo_path: /home/parso/forge-clean-m7e/projects/story-s1
created_at: '2026-10-04T15:28:37.432Z'
iteration_budget: 3
cost_budget_usd: 0.8
phase: pending
origin: architect
class: config
acceptance_criteria:
  - given: '`modules/example-template/copier.yaml` after the change'
    when: ''
    then: >-
      the file contains a `grants_teams` list with at least one non-empty string
      entry
  - given: the `grants_teams` key added to the example module
    when: >-
      `python -m pytest tests/test_copier_schema.py
      tests/test_copier_schema_ci.py` runs
    then: all pre-existing tests pass unchanged
title: Add grants_teams metadata to module copier.yaml
cycle_id: 2026-10-04T15-29-34_INIT-2026-10-04-module-grants-teams-metadata
flow_id: forge-architect
architect_session_id: 2026-10-04T15-15-22-61928e32
architect_cost_usd: 3.3157028000000004
architect_duration_ms: 851638
flow_version: 1
claim_blocked_clauses: 
---

## Context

No module in `modules/` currently declares which teams it grants. The team lint needs a source of truth. The natural home is a `grants_teams` list in each module's `copier.yaml` metadata block. `modules/example-template/` is currently the only module; it must gain a demonstrative entry.

A module whose `copier.yaml` lacks the `grants_teams` key entirely must behave identically to `grants_teams: []` — it contributes nothing to the grant union. The lint treats the absent key as an empty list, never as an error.

## What changes

- `modules/example-template/copier.yaml` — add `grants_teams: [example-team]` (or another illustrative slug) under the module metadata block.
- If a copier YAML schema (`schemas/copier.schema.json` or equivalent) validates the copier.yaml shape, add `grants_teams` there too and update affected test fixtures.

## Not in scope

No lint logic. No changes to overlay files. No changes to `validate_overlay_configs.py` or `apply-overlays.py`.
