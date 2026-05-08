---
title: Roadmaps converge on simplification before features
description: All 4 v1 project roadmaps independently chose simplify-and-consolidate before adding new capabilities. The planner has a reliable instinct for structural health — useful default for the architect.
category: pattern
keywords: [roadmap, simplification, convergence, planner-instinct, technical-debt, architect-default]
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
related_themes: [design-is-the-bottleneck, llm-council-pattern]
---

# Roadmaps converge on simplification before features

The four v1 project roadmaps, generated independently in Cycle 3, all began with some variant of "simplify and consolidate before adding features":

- **env-optimiser**: *"Simplification and operational readiness. Every milestone either removes friction from daily use or strengthens the structural foundation."*
- **trafficGame**: *"Simplification first, then foundational algorithm work. Phase 1 reduces codebase weight by archiving the MCP server."*
- **GitWeave**: *"Simplify and consolidate. The project has substantial work scattered across 6 unmerged branches."*
- **simplarr**: *"Foundational hardening: consolidate duplicated logic in configure scripts, close VPN and split-setup test gaps."*

This convergence is a useful default for v2's architect: when in doubt about an initiative's framing, **lean toward consolidation/hardening before features**. The CEO critic in the LLM Council should flag "this is a feature initiative on a project with significant technical debt" as a taste decision worth surfacing to the user.

Either the planner has a reliable instinct for structural health, *or* all four projects had accumulated similar debt by Cycle 3. Either way, the consistent strategy validates "clean house first" as a cross-project planning pattern.

## Sources

- [`v1-themes-design-and-merge.cycle.md`](../../_raw/v1-wiki/v1-themes-design-and-merge.cycle.md) — roadmap convergence section.

## Related

- [Theme: Design is the bottleneck](./design-is-the-bottleneck.md) — why early planning quality compounds.
- [Theme: LLM Council pattern](./llm-council-pattern.md) — where the "feature vs hardening" critique lives.
