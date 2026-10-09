---
title: Repository Structure
description: Live vs. retiring directories, entry points, module layout
category: reference
created_at: 2026-10-09T05:00:53Z
updated_at: 2026-10-09T05:00:53Z
---

## Live directories (I1 baseline)

| Path | Role |
|---|---|
| `config/` | Overlay config YAMLs; `config/repos/` holds per-repo `RepositoryOverlay` files |
| `schemas/` | JSON Schema files: `overlay.schema.json`, `copier-module.schema.json` |
| `modules/` | Template modules — each a subdirectory with a `copier.yaml` declaring `_metadata` |
| `scripts/apply-overlays.py` | Overlay apply engine (dry-run + stub apply; see `key-patterns.md`) |
| `scripts/bootstrap.sh` | Local stack init — requires `terraform`, `docker` daemon, `python3` |
| `.github/workflows/ci.yaml` | CI gate: `structural-tests` job + `dry-run-smoke` job |
| `tests/test_structure.py` | Structural assertions (dirs, files, workflow YAML, copilot-context) |
| `tests/test_overlay_schema.py` | `schemas/overlay.schema.json` contract |
| `tests/test_copier_schema.py`, `tests/test_copier_schema_ci.py` | `schemas/copier-module.schema.json` contract |
| `AGENTS.md` | Operator-signed constitution (authority over CLAUDE.md) |
| `roadmap.md` | Initiative sequence; current phase MVP greenfield |

## Currently-live but retiring in I1

These are present in `main` today but are deleted by I1. Do not add new tests or code that depends on them.

| Path | Why retiring |
|---|---|
| `metrics/` | Full FastAPI + PostgreSQL DORA service; replaced by GitHub-native DORA (I6). No hosted service in the north star. |
| `modules/example-template/` | Placeholder only — `copier.yaml` + `README.md`, no template files. Stub, not a real module. |
| `modules/python-service/`, `modules/terraform-module/` | Suites with permanently-failing tests; never had working implementations. |
| `infra/` | Terraform for org baseline; retires in I2 when `gw apply` engine takes over. |
| `tests/test_modules/test_python_service.py`, `tests/test_modules/test_terraform_module.py` | Permanently-red April spike suites. |
| Orphaned `tests/test_webhook_signature.py` (metrics), `tests/test_metrics_*`, brownfield tests | No live implementation; deleted in I1. |

Source: `roadmap.md §Retired from April`, `AGENTS.md §Constitution III`.

## Modules layout

Each module lives in `modules/<name>/` and **must** have a `copier.yaml` with a `_metadata` block satisfying `schemas/copier-module.schema.json`. Currently the only module is `modules/example-template/` (a stub). Real modules arrive in I4.

## Config layout

`config/repos/<slug>.yaml` — one file per managed repo; must satisfy `schemas/overlay.schema.json` (`apiVersion: gitweave.io/v1`, `kind: RepositoryOverlay`). `config/repos/example.yaml` is the CI smoke fixture (`my-org/example-smoke-repo`).
