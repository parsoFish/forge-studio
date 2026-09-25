# GitWeave — Claude Instructions

## Project Overview

**GitWeave** is a single "control" repository that configures and weaves together a GitHub organisation using in-repo modules, overlays, and provider-native tooling. It overlays your GitHub organization to provide standardized templates, governance, and observability while leveraging GitHub's native strengths (Actions, Issues, Packages).

**Tech:** TypeScript/Terraform/GitHub Actions. **Tests:** Vitest (unit), custom infra validation.

## Constitution (Non-Negotiable Principles)

### I. Control Repo Centricity
All behavior, configuration, and templates MUST drive from this single repository. No heavy standalone platforms — overlay the provider.

### II. Provider-Native First
Leverage GitHub for hosting, CI (Actions), and Identity. Do not re-implement Git hosting or pipeline runners.

### III. Platform as Code & Local Reproducibility
Express all organization behavior via configuration, Terraform, and lightweight overlays. CLI tooling MUST support local dry-runs (`gw:plan`) to ensure developer confidence before applying changes.

### IV. Composable Modules (Opinionated Templates)
Template modules (skeletons, workflows, infra) live inside the control repo for discoverability and reuse. Modules MUST be versioned and composable.

### V. Observability via Standards
Expose DORA metrics in Prometheus/OpenTelemetry-compatible formats — not proprietary stores.

### VI. Integrated Work Management
Use **GitHub Issues and Projects** for all work tracking. Commits and PRs MUST be linked to Issues to enable DORA lead-time calculations.

### VII. Secure Supply Chain
Use **GitHub Packages** for artifact storage and **GitHub Secrets / OIDC** for service connections. No custom artifact stores or credential managers.

## Non-Goals
- No competing CI runner (GitHub Actions is available)
- No bare git hosting (no `/data/repos`)
- No separate authentication surface (use GitHub IDP)

## Build & Test Commands

```bash
# Infrastructure validation
terraform validate          # Validate Terraform modules
terraform plan              # Dry-run (local reproducibility gate)

# Tests
npm test                    # Unit tests (if applicable)

# GitHub Actions (run via workflow files, not locally)
# .github/workflows/        # All automation lives here
```

## Architecture

```
modules/                    # Composable template modules (e.g., lang-node, workflows/ci-basic)
config/repos/               # Overlay config: which templates apply to which repos
infra/                      # Terraform for GitHub resource provisioning
metrics/                    # DORA metrics aggregation (Prometheus/OTel format)
schemas/                    # JSON schemas for config validation
.github/workflows/          # GitHub Actions (standard for all orchestration)
```

## Key Conventions

- **Governance**: Primary deployment unit is this control repo
- **Infrastructure**: Terraform is the standard for all infra provisioning
- **Orchestration**: GitHub Actions is the standard for all automation
- **Work tracking**: GitHub Issues & Projects (not custom trackers)
- **Artifacts**: GitHub Packages for build output storage
- **Commits**: Must be linked to GitHub Issues; use conventional commits
- **Versioning**: All template modules must be versioned

## Code Style

- Follow ecosystem conventions — if GitHub/Terraform has a way, use that way
- Modules must be composable and independently versioned
- All config schemas must be in `schemas/` and validated
- DORA metrics must be in Prometheus/OTel-compatible format (no proprietary format)
