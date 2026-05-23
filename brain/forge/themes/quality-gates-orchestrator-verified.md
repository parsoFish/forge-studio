---
title: 'Quality gates verified by the orchestrator, not the agent'
description: >-
  Acceptance-criterion verification runs in orchestrator (npm test, gh pr
  checks), not in the agent's response. Defends against hallucinated test
  passes.
category: pattern
keywords:
  - quality-gates
  - hallucination
  - orchestrator-verified
  - test-pass
  - acceptance-criteria
  - trust-model
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - ralph-loop-pattern
  - wedged-loop-detector
  - spec-driven-work-items
---

# Quality gates verified by the orchestrator, not the agent

When Ralph claims "the tests pass," the orchestrator does not believe it. Quality gates run in the orchestrator (or via `gh pr checks`) — actual `npm test`, actual `npm run lint`, actual CI status — and the result of those external checks is what gates the loop's stop condition.

This is a carried-over v1 lesson. Agents will sometimes report success that doesn't reflect reality (hallucinated test passes, missed cases, off-by-one in the test runner). The mitigation is to never let the agent self-certify; the orchestrator runs the gate independently.

Implementation:

- Each work item's `acceptance_criteria` are mapped to executable verification steps.
- The Ralph runner's "stop on quality gates pass" stop condition shells out to those steps.
- For the initiative branch as a whole, `gh pr checks` is the source of truth.

Trade-off: makes acceptance-criteria authoring discipline more important — vague criteria can't be verified.

**Cross-system evidence:** validated across **Ralph, Goose, AI Maestro, and forge v1 itself** that agents will claim tests pass, claim lint is clean, and claim a task is complete when it isn't. Two related failure modes from external research: (1) `default_publishes` fallbacks advance state when an agent produces no output — the **#1 reported bug class in agent orchestration**; (2) prompt-only constraints ("don't do X") are routinely ignored — only structural enforcement (tool filtering, scope boundaries) is reliable.

## Sources

- [`forge-v2-phase-developer-loop.docs.md`](../../_raw/docs/forge-v2-phase-developer-loop.docs.md) — "hallucinated test passes" failure mode.
- [`v1-themes-failure-modes.cycle.md`](../../_raw/v1-wiki/v1-themes-failure-modes.cycle.md) — trusting-agent-output cross-system data + review-fix-loop concrete numbers.

## See also

- [[ralph-loop-pattern]] — the loop the gate stops.
- [[wedged-loop-detector]] — the other primary stop condition.
- [[spec-driven-work-items]] — where verifiable criteria live.
