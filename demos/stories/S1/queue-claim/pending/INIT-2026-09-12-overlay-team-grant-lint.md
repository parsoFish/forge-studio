---
initiative_id: INIT-2026-09-12-overlay-team-grant-lint
project: gitweave
project_repo_path: /home/parso/forge-clean-m6a/projects/gitweave
created_at: '2026-09-12T16:53:51.875Z'
iteration_budget: 6
cost_budget_usd: 4
phase: pending
origin: architect
class: code
acceptance_criteria:
  - given: >-
      An overlay in `config/repos/` has `spec.variables.team_name: platform` and
      `platform` is listed under `teams[*].name` in `config/teams.yaml`
    when: '`scripts/apply-overlays.py --dry-run <overlay>` is invoked'
    then: >-
      The script exits 0, emits no team-lint error, and the human-readable
      dry-run table output is byte-identical to its pre-initiative form — no new
      stdout lines are added for passing overlays. _(brain:
      suppression-env-fakes-the-pass — gate must be environment-independent;
      test must verify exit 0 both with and without a GITHUB_TOKEN env var
      present)_
  - given: >-
      An overlay has `spec.variables.team_name: ghost-team` and `ghost-team`
      does not appear in `config/teams.yaml`
    when: '`scripts/apply-overlays.py --dry-run <overlay>` is invoked'
    then: >-
      The script exits non-zero (exit code 1), writes to stderr a message that
      names both the overlay (by its `metadata.name` or file path) and the
      missing slug `ghost-team`, and does not touch any file in `config/orgs/`
      or `infra/`. _(brain: declared-data-fails-open — the validator must be
      wired end-to-end; merge-gate-fail-open — the third outcome
      'could-not-evaluate' must park needs-operator, not pass silently)_
  - given: '`config/teams.yaml` is absent from the repo root'
    when: '`scripts/apply-overlays.py --dry-run <any-overlay>` is invoked'
    then: >-
      The script exits non-zero (exit code 1) with a descriptive stderr message
      naming `config/teams.yaml` as missing — it never silently passes. _(brain:
      merge-gate-fail-open — missing config is 'could-not-evaluate', not
      'pass')_
  - given: >-
      `config/teams.yaml` exists but contains zero team entries (empty `teams:`
      list)
    when: 'An overlay with `spec.variables.team_name: any-slug` is validated'
    then: >-
      The script exits non-zero (exit code 1) because the slug is not found in
      the empty set — an empty teams file does not mean all slugs are valid.
  - given: >-
      An overlay has `spec.variables.cost_centre: infra-001` and no `team_name`
      key, and `infra-001` does not match any team slug shape
      (`^[a-z][a-z0-9-]*$` with no digits-only segments is fine; the key is not
      `team_name`)
    when: The linter runs
    then: >-
      The script exits 0 with no lint warning — `cost_centre` is not treated as
      a team reference and `infra-001` does not match any known slug.
  - given: >-
      An overlay has `spec.variables.team_name: ${TEAM_VAR}` (interpolated
      value)
    when: The linter runs
    then: >-
      The script emits a stderr warning (not an error) that the value is
      un-lintable due to template interpolation, and exits 0 — interpolated
      values are not false-positived as broken grants.
  - given: >-
      Two overlays are processed in one batch: overlay A has a valid team slug,
      overlay B has an invalid slug `phantom-team`
    when: Both overlays are validated together
    then: >-
      The error output names overlay B and slug `phantom-team` specifically;
      overlay A is not flagged. The script exits non-zero.
  - given: >-
      A new test file `tests/test_overlay_team_grant_lint.py` is added with
      tests covering: valid team pass, missing team fail, missing teams.yaml
      fail, empty teams.yaml fail, interpolated-value warning, no-team-variables
      pass, partial-batch failure reporting
    when: '`python -m pytest tests/test_overlay_team_grant_lint.py` is run'
    then: >-
      All tests in that file pass (exit 0). The file must exist at that exact
      path — confirming the quality gate asserts a real new artefact, not a
      vacuous pass. _(brain: quality-gate-cmd-must-assert-new-work — the gate
      checks for the named test file; pm-must-grep-test-name-before-gate — the
      test module path is pinned here, not invented by PM)_
title: 'Overlay team-grant lint: fail plan when spec.variables names an unknown team'
cycle_id: 2026-09-12T16-54-19_INIT-2026-09-12-overlay-team-grant-lint
flow_id: forge-architect
architect_session_id: 2026-09-12T16-45-13-7156ec87
architect_cost_usd: 2.9702116999999997
architect_duration_ms: 545982
---

## Context

GitWeave repo overlays (`config/repos/*.yaml`) carry a `spec.variables` flat string map. By convention, the key `team_name` (and potentially other keys whose values are team slugs) names a GitHub team that must be granted by at least one module in `config/teams.yaml`. Today, a broken team slug (typo, deleted team, wrong name) is only caught at GitHub-apply time — after the plan has been submitted.

This initiative wires a validator into the onboarding path so that a broken grant is refused **before** the plan reaches GitHub.

## Technical approach

### What field / convention to lint

Code inspection of `config/example.yaml` confirms the exact pattern:

```yaml
spec:
  variables:
    team_name: platform   # ← value is the team slug
    cost_centre: infra-001
```

The linter must scan **values** of `spec.variables` against the set of team slugs defined in `config/teams.yaml` (`teams[*].name`). Keys are arbitrary; only values that match a known team slug are relevant — and the only reliable way to identify "this value is intended as a team slug" is to check it against the known-slug set. The linter must:
1. Load `config/teams.yaml` → collect all `teams[*].name` values as the known-slug set.
2. For each overlay's `spec.variables` value: if the value (after stripping whitespace) matches a known slug exactly, it is a team reference — no further heuristic needed. Values that do not match any known slug AND look like team slugs (lowercase, hyphens, no whitespace, non-empty) raise a lint error.
3. Skip values containing `${` (template interpolation) — emit a warning, not an error (un-lintable, not wrong).
4. An overlay with no `spec.variables`, or no values that match the slug-shape heuristic, passes cleanly with zero output.

**Slug-shape heuristic** (to avoid false-positives on `cost_centre: infra-001` etc.): a value is treated as a candidate team-slug reference only if it matches `^[a-z][a-z0-9-]*$` AND it is either (a) an exact match for a known slug, or (b) the key name is `team_name` (the primary convention). For key `team_name`, always lint the value regardless of shape.

### Where in the onboarding path

Inspection of `scripts/apply-overlays.py` confirms the injection point:

```python
def main(argv):
    ...
    doc = _load_config(args.config)
    _validate_config(doc)       # ← structural validation today
    # NEW: _validate_team_grants(doc)  ← lint goes here, BEFORE _resolve_modules
    ...
```

The new function `validate_team_grants(doc, teams_file)` is called from `_validate_config` (or immediately after it) in `main()`. It reads `config/teams.yaml` relative to `REPO_ROOT` (same pattern as the rest of the script). It must:
- Exit with code 1 and a descriptive stderr message naming which overlay, which variable key, which slug was not found, and which overlays failed — when any team-slug value does not match any entry in `config/teams.yaml`.
- Fail loudly (exit 1) if `config/teams.yaml` is missing or YAML-invalid — never silently pass (fail-open is the documented antipattern).
- Treat an empty `config/teams.yaml` (zero teams) as a configuration with zero valid slugs — any overlay referencing a team slug will fail. An empty teams file does not mean "all slugs are valid".
- Never write to or mutate `config/teams.yaml` or any file under `config/orgs/` or `infra/`.
- Produce zero stdout during normal (passing) validation — only emit on error — so the human-readable dry-run output is unchanged.

### Org-scoping resolution

`config/teams.yaml` is the single source of team slugs for this repo. The lint reads only that file. `config/orgs/*.yaml` files are operator-managed and are never read, written, or consulted by the new validator. This means the lint scope is: "does this overlay reference a team slug that exists in `config/teams.yaml`?" — not "is this team granted in org X specifically?" That constraint is documented as Not in scope below.

### Partial-failure reporting

If multiple overlays are processed in one call and only some have broken team references, the validator must identify each failing overlay by name and list the specific slug(s) that were not found. It must not stop at the first failure — collect all errors, then exit non-zero.

## Acceptance criteria

See typed `acceptance_criteria` field.

## Not in scope

- Changes to `validate_overlay_configs.py` (schema validator) — no schema field is added.
- Changes to any scan commands or the `--dry-run` human-readable output format.
- Per-org grant resolution (determining whether a team slug is granted in org A vs org B — `config/orgs/*.yaml` is operator-managed and not read by this initiative).
- Linting team slugs that appear as variable **keys** (only values are linted).
- Adding `spec.teams[]` as a typed schema field — the lint works against the existing `spec.variables` convention without schema changes.
- Linting environment-level variables (`spec.environments.*.variables`) — only top-level `spec.variables` is in scope for this initiative.
- Changes to the GitHub Actions CI workflow beyond what the test suite already covers.

### Y-statement decisions

- In the context of **identifying team slug references in overlay configs**, facing **no typed team field in the schema**, we chose **lint values of `spec.variables` against known slugs + key-name heuristic** to achieve **correct detection of the `team_name` convention**, accepting tradeoff **other keys whose values are team slugs but don't match the heuristic may be missed** (documented as deferred).
- In the context of **org-scoping**, facing **operator-managed `config/orgs/*.yaml`**, we chose **read only `config/teams.yaml`** to achieve **zero mutation risk**, accepting tradeoff **cross-org grant ambiguity is not detected by this lint**.
- In the context of **empty teams.yaml**, facing **fail-open risk**, we chose **zero known slugs → any team reference fails** to achieve **fail-closed by default**, accepting tradeoff **a brand-new empty org config fails loudly until teams are defined**.
