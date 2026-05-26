---
title: Work-item completion by domain complexity
description: >-
  Domain complexity — not item count or codebase size — is the primary predictor
  of agent failure rate. Clean Python achieves 3.6 min avg; complex TS canvas
  takes 5.2 min with 26.9 min outliers.
category: pattern
keywords:
  - domain-complexity
  - completion-rate
  - develop-time
  - planner-estimation
  - project-manager
  - 109-items
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes:
  - design-is-the-bottleneck
  - spec-driven-work-items
  - dependency-ordered-work
---

# Work-item completion by domain complexity

Across **109 work items** in v1's first full autonomous cycle (Cycle 3, Apr 2–6 2026):

| Project | Items | Avg Develop | Max Develop | Completion |
|---------|-------|-------------|-------------|------------|
| env-optimiser | 11 | 3.6 min | 8.3 min | 100% |
| trafficGame | 28 | 5.2 min | 26.9 min | 100% |
| GitWeave | 37 | 4.8 min | 14.8 min | 95% |
| simplarr | 33 | 6.3 min | 19.9 min | 100% |

Observations:

- **simplarr's** dual-language constraint (Bash + PowerShell parallel implementations) inflates avg time despite clean domain logic.
- **trafficGame's** outliers cluster around algorithm-heavy items (Steiner trees, graph colouring).
- **env-optimiser's** tight distribution confirms a well-understood domain (Python stdlib, pytest, SQLite) produces the most predictable agent behaviour.
- **GitWeave's** 95% maps to scattered-branches debt identified in its roadmap.

**Planning implication**: weight external dependency complexity and domain novelty heavily when estimating work-item difficulty. Two items with identical line counts can have 4× different develop times based on domain.

For v2's project-manager phase, this is the empirical floor: PM benchmarks should distinguish domain-clean cases from domain-novel ones, and `estimated_iterations` in work-item frontmatter should be tuned per-project from observed develop-time distributions.

## Sources

- [`v1-themes-completion-stats.cycle.md`](../../_raw/v1-wiki/v1-themes-completion-stats.cycle.md) — full table + project commentary.

## See also

- [[design-is-the-bottleneck]] — why decomposition matters.
- [[spec-driven-work-items]] — where `estimated_iterations` lives.
- [[dependency-ordered-work]] — parallelism axis.
