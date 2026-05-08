---
title: Layered merge order with health checks
description: Stacked PRs merge in strict Layer 0 → Layer 1 → Layer 2 order, with a post-merge health check between each layer. The merge train stops on failure; human review unblocks.
category: pattern
keywords: [layered-merge, stacked-prs, layer-0, health-check, dependency-ordering, merge-train, gitweave]
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
related_themes: [squash-merge-stacked-prs, health-check-protocol, gh-cli-and-worktrees]
---

# Layered merge order with health checks

When PRs have dependency relationships (B depends on A), merging requires ordering awareness. The layered merge pattern formalises this:

- **Layer 0** (foundation): merge first, completely, with health check.
- **Layer 1**: only begins after Layer 0 health check passes; items in Layer 1 can run in parallel with each other.
- **Layer 2+**: strictly after prior layers complete.

Canonical GitWeave example (PR #21–#24, v1 Cycle 3):

```
Layer 0: PR #21 (containerize metrics) → unblocks #24, #23, #22
Layer 1: PR #23 (PostgreSQL metrics) + PR #22 (deployment guide)  ← parallel
Layer 2: PR #24 (getting-started guide)
```

A failed health check halts all subsequent layers — the merge train stops; human review required to unblock. This is the operational enforcement of v2's dependency-ordered work pattern at the *PR-merge* level (which was previously left implicit).

In v2 the responsibility lands on the review-loop phase (review-prep verifies the layer-0 PR, merges it, runs the project's quality gates as the health check, only then unblocks layer 1).

## Sources

- [`v1-themes-design-and-merge.cycle.md`](../../_raw/v1-wiki/v1-themes-design-and-merge.cycle.md) — full pattern + GitWeave PR sequence.

## Related

- [Theme: Squash-merge stacked PRs](./squash-merge-stacked-prs.md) — antipattern this prevents.
- [Theme: Health-check protocol](./health-check-protocol.md) — the gate between layers.
- [Theme: gh CLI + worktrees](./gh-cli-and-worktrees.md) — the tooling layer.
