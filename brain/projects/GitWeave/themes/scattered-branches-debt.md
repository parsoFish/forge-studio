---
title: GitWeave — scattered branches debt; consolidate before features
description: 6 unmerged branches at end of v1 Cycle 3. Roadmap says "simplify and consolidate" first. Architect should reject feature initiatives that add to the pile.
category: antipattern
keywords: [gitweave, scattered-branches, technical-debt, simplify-first, roadmap, consolidate]
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
related_themes: []
---

# GitWeave — scattered branches debt

GitWeave entered v1 Cycle 3 with **substantial work scattered across 6 unmerged branches**. The Cycle-3 roadmap explicitly chose simplification + consolidation as Phase 1. Pulling these branches to ground (review, merge or discard) is prerequisite to landing new modules.

For forge initiatives on GitWeave:

- The architect should ask **"is this a feature or a consolidation?"** as the first orientation question.
- If consolidation work is outstanding (visible via `git branch -r` count or `gh pr list --state open`), feature initiatives need explicit user justification. The CEO critic flags this.
- Layered-merge order matters here even more than elsewhere — when you finally merge the queue, you'll be merging ~6+ PRs in one go. Layer 0 must be unambiguous.

This is the GitWeave instance of the cross-project [`roadmap-simplification-convergence`](../../../forge/themes/roadmap-simplification-convergence.md) pattern.

## Sources

- GitWeave v1 roadmap (in `~/sideProjects/.forge/wiki/_raw/roadmaps/GitWeave.json`).
- [`v1-themes-design-and-merge.cycle.md`](../../../_raw/v1-wiki/v1-themes-design-and-merge.cycle.md) — roadmap-simplification-convergence section.

## Related

- [Theme: Layered merge order](../../../forge/themes/layered-merge-order.md) — what to do when finally merging.
- [Theme: Roadmap simplification convergence](../../../forge/themes/roadmap-simplification-convergence.md) — system-level pattern.
