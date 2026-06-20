---
title: trafficGame — algorithm-heavy items must be decomposed before queueing
description: >-
  Steiner topology + graph colouring as single work units caused 48% failure
  rate in v1 Cycle 3. Multi-file algorithmic restructuring exceeds the
  developer-loop's atomic-item design point.
category: antipattern
keywords:
  - trafficgame
  - steiner
  - graph-coloring
  - decomposition
  - algorithm-heavy
  - 48-percent-failure
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes: []
---

# trafficGame — algorithm-heavy items must be decomposed

trafficGame's 48% job failure rate in v1 Cycle 3 was traced to algorithm-heavy items — Steiner topology, graph colouring — scoped as single work units. They weren't hard because the agents were bad. They were hard because they required multi-file restructuring with tight coupling, which exceeds the Ralph loop's atomic-item design point.

Practice for new trafficGame initiatives:

- **Decompose any algorithmic feature into ≥3 work items** (data-shape change → algorithm step → integration with existing code → tests).
- **One algorithm = many commits** — the agent should land the data-structure change first, then incrementally introduce the algorithm step.
- **Reference impl first** — if the algorithm has a known reference (NetworkX, graphlib), pin to it; don't re-derive.
- **Visual regression test** for any flow-prediction change. The BPR scoring is sensitive to subtle flow-graph changes.

The architect's LLM Council should flag any trafficGame initiative whose Engineering critic detects "this work item touches >3 files in the algorithmic core" as an escalation, not an auto-resolve.

## Sources

- [`v1-themes-completion-stats.cycle.md`](../../../_raw/v1-wiki/v1-themes-completion-stats.cycle.md) — 5.2 min avg / 26.9 min max for trafficGame; outlier cluster.
- [`v1-themes-design-and-merge.cycle.md`](../../../_raw/v1-wiki/v1-themes-design-and-merge.cycle.md) — design-is-the-bottleneck section names trafficGame's 48% failure rate.
