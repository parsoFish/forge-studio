---
title: 'TDD with agents — tests first, verified in a worktree'
description: >-
  Agents produce plausible-looking code that doesn't quite work. Tests make
  correctness mechanically verifiable. Orchestrator runs the gate, not the
  agent.
category: pattern
keywords:
  - tdd
  - test-driven-development
  - red-green-refactor
  - hallucinated-tests
  - coverage
  - worktree
created_at: 2026-05-04T18:00:00.000Z
updated_at: 2026-05-04T18:00:00.000Z
related_themes:
  - quality-gates-orchestrator-verified
  - spec-driven-work-items
  - eval-driven-development
---

# TDD with agents

Agents are good at producing plausible-looking code that doesn't quite work. Tests are the cheapest way to make "does it work?" mechanically verifiable.

Practice:

- **Tests first, red.** Write failing tests before any implementation. The failing tests are the contract.
- **Implement against the failing tests.** The agent's job is to make red go green; nothing else.
- **Verify in a worktree, not in the agent's response.** "Tests pass" is what `npm test` says, not what the agent claims.
- **Hallucinated test passes are real.** Never trust agent self-reports of green. The orchestrator runs the gate independently (per-quality-gates pattern).
- **Coverage ≥80%.** Includes unit + integration + E2E. (Inherits forge's global rule.)

The discipline matters more for agents than for humans: a human with a wrong mental model writes broken code that fails a test; an agent with a wrong mental model writes broken code *and* a wrong-feeling test that "passes" by coincidence. Orchestrator verification is the only reliable gate.

**v1 evidence:** validated across **109 work items** in v1's first full autonomous cycle (Cycle 3). Atomic, TDD-shaped items had the highest completion rates; algorithm-heavy items scoped as single units (trafficGame's Steiner / graph-colouring) had a 48% failure rate that traced back to skipping decomposition before TDD.

## Sources

- [`agentic-engineering-best-practices.chat.md`](../../_raw/web/agentic-engineering-best-practices.chat.md) — synthesis section 1.
- [`v1-themes-completion-stats.cycle.md`](../../_raw/v1-wiki/v1-themes-completion-stats.cycle.md) — 109 items + completion-by-domain.
- [`v1-themes-design-and-merge.cycle.md`](../../_raw/v1-wiki/v1-themes-design-and-merge.cycle.md) — design-is-the-bottleneck section.

## See also

- [[quality-gates-orchestrator-verified]] — the structural defence.
- [[spec-driven-work-items]] — what the tests are written from.
- [[eval-driven-development]] — broader pattern.
