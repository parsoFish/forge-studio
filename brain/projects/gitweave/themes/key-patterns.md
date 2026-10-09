---
title: Key Patterns
description: apply-overlays pipeline, schema validation idiom, dry-run contract, test structure
category: pattern
created_at: 2026-10-09T05:00:53Z
updated_at: 2026-10-09T05:00:53Z
---

## apply-overlays.py pipeline

`scripts/apply-overlays.py` is the current runtime for overlay application. Pipeline:

1. `_load_config(path)` — YAML parse; exits 1 on missing file or bad YAML.
2. `_validate_config(doc)` — checks `apiVersion == "gitweave.io/v1"`, `kind == "RepositoryOverlay"`, non-empty `spec.repository`; exits 1 on mismatch.
3. `_resolve_modules(modules)` — resolves each `name` to `modules/<name>/`; exits 2 if directory not found.
4. `--dry-run` path: `_print_dry_run_plan()` → `compute_dry_run_summary()` → `format_dry_run_table()` — prints a formatted table of repos × modules × estimated actions, no network calls.
5. Apply path (stub): prints `[apply] Applying module: <name>` per module; real implementation is planned (`gw apply`, I2).

Exit codes: `0` success, `1` config error, `2` module not found. Source: `scripts/apply-overlays.py`.

## Schema validation pattern

Both schemas (`overlay.schema.json`, `copier-module.schema.json`) are JSON Schema Draft 7. Tests load the schema with `json.load`, construct minimal valid documents, then assert `jsonschema.validate` raises `ValidationError` on invalid inputs and passes on valid ones. The `additionalProperties: false` constraint at strategic levels catches typos. Source: `tests/test_overlay_schema.py`, `tests/test_copier_schema.py`.

## Dry-run contract (CI smoke gate)

The `dry-run-smoke` CI job runs:
```bash
python3 scripts/apply-overlays.py --dry-run config/repos/example.yaml
```
and asserts the output contains `"my-org/example-smoke-repo"` and `"example-template"`. This is the only end-to-end execution test in CI. Any change to `apply-overlays.py`, `config/repos/example.yaml`, or `modules/example-template/` must keep this smoke assertion green.

## No-Terraform, no-state-file rule

`AGENTS.md` Constitution III (amended): no desired-state tool, no state file. The `gw` CLI (planned, I2) will diff the declared config against the live GitHub API on demand. `infra/` Terraform is a legacy holdover retiring in I2. Do not add new Terraform.

## Self-service first

`AGENTS.md` Constitution III: anything a team can change for itself is applied directly through the API with policy checked at request time — not through a pull request against this repo. I3 builds this. Do not design flows that require a control-repo PR for a self-service team action.

## Test structure pattern (TDD)

All gate tests are written against a contract, with a failure message that names the file or rule that must exist. Example from `tests/test_overlay_schema.py`:
```python
self.assertTrue(os.path.isfile(SCHEMA_PATH),
    f"schemas/overlay.schema.json is missing — expected it at {SCHEMA_PATH}")
```
New tests follow this pattern: assert the contract, cite the file.
