---
initiative_id: INIT-2026-10-04-overlay-team-grant-lint
project: story-s1
project_repo_path: /home/parso/forge-m7-e/projects/story-s1
created_at: '2026-10-04T00:39:15.717Z'
iteration_budget: 4
cost_budget_usd: 3
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: >-
      overlay.schema.json is updated with an optional spec.teams string-array
      field AND copier-module.schema.json is updated with an optional
      _metadata.grants_teams string-array field
    when: >-
      python -m pytest tests/test_overlay_schema.py tests/test_copier_schema.py
      tests/test_copier_schema_ci.py runs
    then: >-
      all existing schema tests pass (backward-compat confirmed: overlays
      without spec.teams and modules without _metadata.grants_teams are still
      valid)
  - given: >-
      example-template/copier.yaml carries _metadata.grants_teams containing at
      least one real team slug (e.g. 'platform' from config/teams.yaml), and a
      test overlay's spec.teams contains that same slug
    when: python -m pytest tests/ runs (new positive-path test in a new test file)
    then: >-
      the positive-path test passes: lint exits 0 and emits an OK line in the
      existing output format (source: suppression-env-fakes-the-pass — result
      holds regardless of CI environment)
  - given: >-
      a test overlay has spec.teams containing a slug granted by no module in
      modules/ (or the referenced module slug is absent from modules/ entirely —
      treated as zero grants)
    when: >-
      python -m pytest tests/ runs (new negative-path test in the same new test
      file)
    then: >-
      the negative-path test passes: lint exits non-zero AND emits a FAIL line
      in the existing 'FAIL <filename>: <message>' format — not exit 0 (source:
      declared-data-fails-open — schema extension alone is insufficient; the
      execution path must also enforce non-zero exit)
  - given: python -m pytest tests/ --collect-only runs after the implementation lands
    when: the test discovery output is inspected
    then: >-
      at least one new test file under tests/ is discovered that covers the
      team-grant lint, confirming the quality gate cannot pass vacuously
      (source: quality-gate-cmd-must-assert-new-work — new test file is
      mandatory, not optional)
title: Add overlay team-grant lint
cycle_id: 2026-10-04T00-41-23_INIT-2026-10-04-overlay-team-grant-lint
flow_id: forge-architect
architect_session_id: 2026-10-04T00-27-08-039e26d6
architect_cost_usd: 3.5988088999999994
architect_duration_ms: 854657
---

## Context

GitWeave validates repo overlay configs against `overlay.schema.json` via `validate_overlay_configs.py`. Today, overlays have no way to reference GitHub teams — a broken team grant goes undetected until it reaches GitHub provisioning. This initiative wires up the lint at plan time.

## Defaults adopted (all three interview questions received constraint-restatement answers — proceeding with these defaults for operator review at the plan gate)

- **Overlay teams field**: `spec.teams: [string]` — optional array of team slugs a repo overlay may declare.
- **Module grants location**: `_metadata.grants_teams: [string]` in each module's `copier.yaml` — the authoritative source for which teams a module grants.
- **Lint location**: Python extension inside `validate_overlay_configs.py` (or a helper it imports), same file the existing schema validation lives in.

## Deliverables

### 1. Schema extensions

- **`schemas/overlay.schema.json`**: add optional `spec.teams` as `{ type: array, items: { type: string } }`. `additionalProperties: false` currently blocks any teams field; this PR extends the spec object to permit it while keeping the unknown-field guard intact for everything else.
- **`schemas/copier-module.schema.json`**: add optional `_metadata.grants_teams` as `{ type: array, items: { type: string } }`.

### 2. Example-template seed (enables positive-path testing)

- **`modules/example-template/copier.yaml`**: add `_metadata.grants_teams: [<real-slug-from-config/teams.yaml>]` — establishes the convention and gives the positive-path test a real fixture to run against. Without at least one module carrying `grants_teams`, only negative-path tests can be written.

### 3. Lint implementation

Extend `validate_overlay_configs.py` (or a helper it imports) to:

1. Build `grants_table: dict[module_slug, set[str]]` by scanning `modules/*/copier.yaml` and reading `_metadata.grants_teams`. Files that fail `yaml.safe_load` are skipped with a warning (zero grants). A missing `modules/` directory produces an empty table — not a tool error; an overlay with `spec.teams` will then fail correctly.
2. For each overlay: if `spec.teams` is present, verify every slug appears in at least one module's grant set. Ungranted slugs → emit `FAIL <filename>: team '<slug>' is not granted by any module` via the existing output path and **exit non-zero**.
3. Preserve existing output lines exactly: `OK   <filename>`, `FAIL <filename>: <message>`, `Validated N files`. No new output channel or section.

Use `yaml` and `jsonschema` already in the project — no new dependencies.

### 4. Tests (mandatory — gate is `python -m pytest tests/`)

New test file(s) under `tests/` covering:
- **Positive path**: overlay `spec.teams` contains a slug that `example-template` grants → exit 0, OK line.
- **Negative path**: overlay `spec.teams` contains an ungranted slug → exit non-zero, FAIL line in existing format.
- **Backward compat**: overlay without `spec.teams` → exit 0, output unchanged.
- **Missing-module**: overlay references a module slug absent from `modules/` → zero grants → exit non-zero.
- **Missing `modules/` dir**: empty grants table → overlay with `spec.teams` exits non-zero.

## Not in scope

- Team parent/child inheritance (`platform` under `engineering`); slug-level exact match only.
- `config/teams.yaml` coverage gaps (teams listed but granted by no module are not a lint error here).
- GitHub API calls, Terraform team validation, live-env checks of any kind.
- Changes to any existing scan command or existing output format.
- Jinja2/YAML-include parsing beyond `yaml.safe_load` (unparseable file = skip with warning = zero grants).
- `config/orgs/*.yaml` — operator-owned, locked-core constraint, never modified.
