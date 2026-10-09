---
title: GitWeave — Project Profile
description: One-page overview of purpose, scope, tech, and brain map
category: reference
created_at: 2026-10-09T05:00:53Z
updated_at: 2026-10-09T05:00:53Z
---

## What it is

GitWeave is a single "control repository" that declares the standard for a GitHub organisation — settings, teams, policy, template modules — and applies it through the GitHub API. It overlays the provider; it does not host or replicate it.

**Tech:** Python, GitHub Actions, YAML/JSON Schema. A `gw` CLI is planned (roadmap I2) but not yet built. **Tests:** pytest. **Licence:** AGPL-3.0-or-later.

## North star (from `roadmap.md`)

> One control repo weaves a GitHub org: declared standards applied through the API, self-service first, DORA from GitHub itself.

The MVP delivers one scenario end to end: Bootstrap → Update → Reset against a throwaway org.

## Current state (as of 2026-10-09)

The tree contains April-2026 spike artefacts alongside the I1 baseline. **I1 has not yet landed on `main`**: retired artefacts (`modules/python-service`, `modules/terraform-module` suites, `metrics/` FastAPI/PostgreSQL service, orphaned webhook-signature and metrics-token specs, `modules/example-template` placeholder, `infra/` Terraform) are **still present** in the tree and are scheduled for deletion in I1. Infra Terraform retires in I2 once the `gw` apply engine exists.

**Gate (credential-free, 4 files, 141 tests pass):**
```
python3 -m pytest tests/test_structure.py tests/test_overlay_schema.py \
  tests/test_copier_schema.py tests/test_copier_schema_ci.py \
  --deselect tests/test_structure.py::TestRepoStructure::test_bootstrap_script_exits_zero
```

**Whole `tests/` (42 test files):** 780 passing, 317 failing, 72 skipped — failures are the April spike suites scheduled for deletion in I1.

## What each theme covers

| Theme | What it answers |
|---|---|
| `structure.md` | Repo layout, which dirs are live vs. retiring, entry points |
| `conventions.md` | Overlay schema format, naming rules, commit conventions |
| `build-and-test.md` | Exact commands, the gate, bootstrap.sh constraints |
| `key-patterns.md` | apply-overlays.py pipeline, schema validation pattern, dry-run |
| `sharp-edges.md` | Red tests, retiring artefacts, bootstrap.sh Docker dep |

## Key files read

- `AGENTS.md` — operator-signed constitution (authority)
- `roadmap.md` — initiative sequence
- `CLAUDE.md` — project instructions
- `tests/test_structure.py`, `tests/test_overlay_schema.py`, `tests/test_copier_schema.py`
- `scripts/apply-overlays.py`
- `scripts/bootstrap.sh`
- `.github/workflows/ci.yaml`
- `config/repos/example.yaml`, `modules/example-template/copier.yaml`
- `schemas/overlay.schema.json` (path confirmed), `schemas/copier-module.schema.json` (path confirmed)
