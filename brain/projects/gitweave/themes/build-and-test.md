---
title: Build and Test
description: Exact commands, the passing gate, CI jobs, bootstrap constraints
category: operation
created_at: 2026-10-09T05:00:53Z
updated_at: 2026-10-09T05:00:53Z
---

## Quality gate — credential-free (local, 141 tests pass)

```bash
python3 -m pytest tests/test_structure.py tests/test_overlay_schema.py \
  tests/test_copier_schema.py tests/test_copier_schema_ci.py \
  --deselect tests/test_structure.py::TestRepoStructure::test_bootstrap_script_exits_zero
```

The `--deselect` is required locally. `test_bootstrap_script_exits_zero` runs `scripts/bootstrap.sh` which requires a live Docker daemon and `terraform`; it runs in the CI `structural-tests` job (which provisions both) but not in a credential-free local run.

Source: `AGENTS.md §Commands`.

## CI gate (`.github/workflows/ci.yaml`)

Two jobs:

### `structural-tests`

```bash
pytest tests/test_structure.py tests/test_overlay_schema.py
pytest tests/test_copier_schema.py tests/test_copier_schema_ci.py
yamllint .github/workflows/
```

Runs on `ubuntu-latest` with Python 3.12, `hashicorp/setup-terraform@v3` (needed so `bootstrap.sh` finds `terraform`), and `pip install pytest pyyaml yamllint jsonschema`.

### `dry-run-smoke`

```bash
python3 scripts/apply-overlays.py --dry-run config/repos/example.yaml
# asserts output contains "my-org/example-smoke-repo" and "example-template"
```

Uses only `pyyaml`; no credentials needed.

Source: `.github/workflows/ci.yaml`.

## Whole test suite

```bash
python3 -m pytest tests/
```

42 test files, 780 passing, **317 failing**, 72 skipped. Failures are the April-spike suites and brownfield tests scheduled for deletion in I1. Do not try to fix these — delete them per I1.

## Installing dependencies

```bash
pip install pytest pyyaml yamllint jsonschema
```

No `pyproject.toml` or `requirements.txt` in the repo root; CI installs inline.

## bootstrap.sh constraints

`scripts/bootstrap.sh` requires `git`, `terraform`, `python3`, and a **running Docker daemon** (it calls `docker compose -f metrics/docker-compose.yml up -d` and `terraform -chdir=infra init`). It fails without them. The `--check` flag validates prerequisites and prints planned actions without executing.

Note: `bootstrap.sh` starts the `metrics/` Docker Compose stack. That stack retires in I1. The script itself will need updating when metrics/ is deleted.

Source: `scripts/bootstrap.sh`.
