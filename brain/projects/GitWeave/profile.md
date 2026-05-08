---
project: GitWeave
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
status: active
domain: GitHub-organisation control-repo / platform-as-code
stack: [terraform, github-actions, python, yaml]
taste_decay: 0.05
---

# GitWeave

A single "control" repository that configures and weaves together a GitHub organisation using in-repo modules, overlays, and provider-native tooling. Instead of building a heavy standalone platform, GitWeave overlays existing GitHub orgs to provide standardised templates, governance, and observability while leveraging GitHub's native strengths (Actions, Issues, Packages).

## Taste signals

- **Control-repo centricity** — *all* behaviour drives from this repo. No bespoke services, no parallel control planes.
- **Provider-native first** — GitHub for hosting, CI, identity, work management. Don't re-invent wheels GitHub already provides.
- **Platform as code** — Terraform for infra, GitHub Actions for orchestration. Everything else is YAML config.
- **Local reproducibility** — every CLI tool must support `gw:plan` (local dry-run). No "trust the agent and run the apply."
- **Observability via DORA** — Prometheus / OpenTelemetry standards, not bespoke metrics.

## Hard constraints

- **Greenfield AND brownfield must work** — GitWeave can bootstrap a new org *or* overlay an existing one. Initiatives must consider both paths.
- **No platform lock-in** — managed repos remain standard Git; GitWeave only manages overlay config / workflows.
- **Terraform state needs a real backend** in production (S3/GCS). Local-only state is dev-only.
- **Module composability** — `modules/lang-node`, `modules/workflows/ci-basic`, etc. are mix-and-match. New modules must be composable, not monolithic.

## Layered-merge sensitivity

GitWeave's v1 Cycle 3 was the canonical layered-merge example (PR #21 → #22+#23 → #24). Multi-PR initiatives in this repo are routine. The reviewer phase **must** apply the layered-merge-order discipline; squash-merging stacked PRs is what produced 90 test failures in v1.

## Active focus (v1 roadmap, carried forward)

- **Simplify and consolidate** — substantial work scattered across 6 unmerged branches at end of v1 Cycle 3. Pull these to ground before adding new modules.
- **Metrics aggregator** is partially built; complete the DORA metrics path before adding new domains.
