---
title: Design is the bottleneck
description: >-
  Planner quality multiplies everything downstream — agents churn through
  implementation fast; bad work-item design produces churn, failed completions,
  and wasted tokens that better design would prevent.
category: pattern
keywords:
  - design
  - planning
  - bottleneck
  - planner
  - work-item-quality
  - leverage
  - downstream
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes:
  - spec-driven-work-items
  - llm-council-pattern
  - declarative-specs-vs-imperative
---

# Design is the bottleneck

Validated across Gas Town, Anthropic research, and forge v1's three cycles: the highest-leverage investment is in work-item design, not in agent prompting or pipeline mechanics. *"Agents churn through implementation fast. Planner quality multiplies everything downstream."*

Concretely: trafficGame's 48% job failure rate in v1 Cycle 3 was traced to algorithm-heavy items (Steiner topology, graph colouring) scoped as single work units. They weren't hard because the agents were bad — they were hard because they required multi-file restructuring with tight coupling. Better planning would have decomposed them before agents ever saw them.

The architectural implication for v2: **the architect + project-manager phases are the highest-value phases in the pipeline**, but they're also the most under-specified by the model alone. Vague planning produces vague work items which produce bad completions. Good planning — atomic scope, explicit Given-When-Then acceptance criteria, dependency ordering — multiplies every downstream phase's effectiveness.

This is why the LLM Council pattern lives at the architect, not at the developer loop: catching design issues at the *initiative* level is cheaper than catching them at the *work item* or *PR* level.

## Sources

- [`v1-themes-design-and-merge.cycle.md`](../../_raw/v1-wiki/v1-themes-design-and-merge.cycle.md) — full v1 lesson + Gas Town reference.
- [`v1-themes-completion-stats.cycle.md`](../../_raw/v1-wiki/v1-themes-completion-stats.cycle.md) — empirical floor (109 items, completion-rate-by-domain).

## See also

- [[spec-driven-work-items]] — what good design produces.
- [[llm-council-pattern]] — where design is critiqued before queuing.
- [[declarative-specs-vs-imperative]] — the prompt-level companion.
