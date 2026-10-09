---
title: Sharp Edges
description: Red tests, retiring artefacts still in tree, bootstrap Docker dep, spec.repository pattern
category: antipattern
created_at: 2026-10-09T05:00:53Z
updated_at: 2026-10-09T05:00:53Z
---

## 317 failing tests in tests/ — do not fix, delete

Running `python3 -m pytest tests/` yields 317 failing tests across 42 test files. These are April-2026 spike artefacts. They fail because their implementations never existed or were abandoned. They are **scheduled for deletion in I1**, not repair. Attempting to fix them would mean building the wrong thing.

Key failing suites:
- `tests/test_modules/test_python_service.py` — no `modules/python-service` implementation
- `tests/test_modules/test_terraform_module.py` — no `modules/terraform-module` implementation
- `metrics/tests/` suites (brownfield, webhook-signature, metrics-token) — FastAPI service retiring in I1
- Brownfield import / incremental validation tests — no brownfield implementation

Source: operator guidance; `roadmap.md §Retired from April`.

## test_bootstrap_script_exits_zero requires Docker daemon

`tests/test_structure.py::TestRepoStructure::test_bootstrap_script_exits_zero` runs `scripts/bootstrap.sh` which calls `docker info` (fails without Docker daemon) and `terraform -chdir=infra init`. Running locally without Docker/Terraform causes this test to fail. **Always `--deselect` it locally.** CI provisions both via setup-terraform and the ubuntu runner.

Source: `scripts/bootstrap.sh` lines 35-45, `AGENTS.md §Commands`.

## modules/example-template is a stub, not a real module

`modules/example-template/` contains only `copier.yaml` and `README.md` — no actual template files. The `dry-run-smoke` CI job references it (`config/repos/example.yaml` lists `example-template`). `apply-overlays.py --dry-run` resolves modules by directory existence only, so the stub passes the smoke gate. Real module application (`gw apply`) will require actual template files. This stub retires in I1 along with the rest of the April artefacts.

Source: `modules/example-template/` (Glob result), `roadmap.md §Retired from April`.

## infra/ Terraform present but retiring in I2

`infra/` contains Terraform for org baseline provisioning. `AGENTS.md` Constitution III (amended) explicitly rejects desired-state tools and state files. `infra/` is a legacy holdover that retires when the `gw apply` engine lands in I2. The `structural-tests` CI job requires Terraform installed (for `bootstrap.sh`), but no `terraform validate` or `terraform plan` runs in CI. Do not add new Terraform modules.

Source: `AGENTS.md §Constitution III`, `roadmap.md §I2`, `.github/workflows/ci.yaml`.

## spec.repository pattern is strict — no spaces, exactly one slash

`schemas/overlay.schema.json` enforces `^[^\s/]+/[^\s/]+$` on `spec.repository`. Common mistakes that fail:
- `"my-org-my-repo"` (no slash)
- `"org/owner/repo"` (two slashes)
- `"/my-repo"` (leading slash, empty owner)
- `"my-org/"` (trailing slash, empty repo)
- `"my org/my repo"` (spaces)

Source: `tests/test_overlay_schema.py::TestRepositoryPatternValidation`.

## apply path is a stub — no real API calls yet

`scripts/apply-overlays.py` apply mode (without `--dry-run`) prints `[apply] Applying module: <name>` but makes no network calls. The real implementation (`gw apply`) is planned for I2. Do not build features that assume the apply path works end-to-end.

Source: `scripts/apply-overlays.py` lines 263-267.
