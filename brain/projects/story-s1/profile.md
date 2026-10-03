# story-s1 — project brain (Brain 3 profile)

> Forge-owned + CENTRAL (ADR-035) at `brain/projects/story-s1/` in the forge repo.
> Read by planners and reflectors via the `KbBackend` seam.

## What this project is

GitWeave is a single "control" repository that configures and weaves together a
GitHub organisation. It overlays a GitHub org with standardised repo templates,
governance workflows, team structure, OIDC trust, and DORA observability — all
driven from declarative config and Terraform in this one repo, leveraging
GitHub's native strengths (Actions, Issues, Packages) rather than re-implementing
them.

The operator is one person managing multiple side-project repos under a single
GitHub organisation. GitWeave gives that operator org-wide consistency (branch
protection, CI workflow templates, module versioning) without per-repo manual
work.

## Architecture

```
scripts/apply-overlays.py    # Core engine: reads config/repos/*.yaml, applies module overlays
scripts/validate_overlay_configs.py  # Schema-validates every overlay config before apply
config/repos/                # Overlay configs: which templates apply to which repos
modules/                     # Versioned copier templates (lang-node, workflows/ci-basic, …)
infra/                       # Terraform: GitHub teams, OIDC trust, repo settings
metrics/                     # DORA metrics collector (Prometheus/OTel format)
schemas/                     # JSON/YAML schemas for overlay config validation
.github/workflows/           # GitHub Actions: CI, overlay apply, module update propagation
tests/                       # pytest structural + schema tests; mirrors CI scope
```

**Data flow:** `config/repos/*.yaml` → `apply-overlays.py` (dry-run or apply) →
GitHub API calls / file writes. Overlay configs are validated against
`schemas/overlay.schema.json` before any mutation. Terraform manages teams, OIDC,
and repo settings independently.

## Conventions

- **Overlay engine is the primary surface.** New features land in
  `scripts/apply-overlays.py` + `schemas/` + `config/repos/`; avoid adding
  parallel code paths.
- **Modules are versioned with CalVer** (`YYYY.MM.PATCH`); `bump-module-version.py`
  bumps the version and CI propagates updates.
- **Tests mirror CI scope.** The per-WI gate runs
  `bash scripts/gates/local.sh` (structural + schema tests, Docker-exempt).
  CI additionally runs `test_bootstrap_script_exits_zero` (requires Docker);
  do not widen the local gate to include it.
- **Terraform is plan-only in CI.** `terraform validate` + `terraform plan`
  run in CI with no live credentials. `terraform apply` is operator-only,
  never automated by forge.
- **DORA metrics in Prometheus/OTel format only.** No proprietary metric stores.
- **Conventional commits linked to GitHub Issues.** All commits carry `#<issue>`.
- **`infra/` state and `config/orgs/*.yaml` are operator-owned.** Forge agents
  must never modify Terraform state files or org-level overlay configs.

## Constraint blocks

<!-- forge:constraint id: no-infra-state-touch applies_to: all -->
Never modify files matching `infra/**/*.tfstate`, `infra/**/*.tfstate.*`,
`infra/**/.terraform/`, or `config/orgs/*.yaml`. These are operator-owned;
a work item that would touch them must be parked and flagged for operator review.
<!-- /forge:constraint -->

<!-- forge:constraint id: no-test-edits-to-pass applies_to: all -->
Never edit test files to make a failing test pass. Fix the production code.
If a test is structurally wrong (wrong assertion, stale fixture), flag it in
the work item's notes rather than silently changing it.
<!-- /forge:constraint -->
