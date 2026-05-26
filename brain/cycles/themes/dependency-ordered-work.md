---
title: 'Dependency-ordered work — parallelism is correctness, not optimisation'
description: >-
  When work items don't declare dependencies, parallel execution silently
  corrupts merges. depends_on edges + a graph-critic make parallelism safe.
category: pattern
keywords:
  - dependencies
  - parallelism
  - depends-on
  - dependency-graph
  - merge-conflicts
  - correctness
created_at: 2026-05-04T18:00:00.000Z
updated_at: 2026-05-04T18:00:00.000Z
related_themes:
  - spec-driven-work-items
  - llm-council-pattern
  - gh-cli-and-worktrees
---

# Dependency-ordered work — parallelism is correctness

When work items don't declare dependencies, parallel execution silently corrupts merges. Two work items touching the same file in parallel = one wins, one is lost. Two work items with an implicit ordering (B depends on A) running in parallel = B builds against missing scaffolding from A.

The fix is to declare dependencies and let the orchestrator schedule respecting them:

- Every work item declares `depends_on: [WI-X, WI-Y]`.
- A dependency-graph critic (in the architect's LLM Council) checks for missing edges before queueing.
- Parallel execution is fearless **because** dependencies make it safe — it's a correctness property, not an optimisation.
- Target: ≥30% of work items run in parallel without conflict.

The shift in mindset: parallelism *is* correctness. The graph is the schedule; if the graph is wrong, parallelism corrupts. If the graph is right, parallelism is safe — and free.

Forge implements this via `git worktree` (one worktree per claimed work unit, isolated by filesystem) plus the bounded scheduler.

## Sources

- [`agentic-engineering-best-practices.chat.md`](../../_raw/web/agentic-engineering-best-practices.chat.md) — synthesis section 3.
- [`forge-v2-phase-project-manager.docs.md`](../../_raw/docs/forge-v2-phase-project-manager.docs.md) — `_graph.md` mermaid view.

## See also

- [[spec-driven-work-items]] — where `depends_on` lives.
- [[llm-council-pattern]] — the dependency-graph critic.
- [[gh-cli-and-worktrees]] — the parallelism mechanism.
