---
title: LLM Council pattern — chained-reviewer perspectives
description: >-
  Multi-perspective critic chain (CEO/eng/design/DX) auto-resolves mechanical
  questions and surfaces only taste decisions to the user. Inspired by gstack
  /autoplan.
category: pattern
keywords:
  - llm-council
  - multi-perspective
  - critic-chain
  - autoplan
  - gstack
  - taste-decisions
  - architect
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - skills-as-agent-surface
  - gstack-conventions
---

# LLM Council pattern — chained-reviewer perspectives

The architect uses an LLM Council pattern — a chain of skill invocations each adopting a different perspective (CEO, engineering, design, developer experience). Each critic reviews the proposed initiative and either:

- Auto-resolves a mechanical question (e.g. "this work item lacks an acceptance criterion → add one"), or
- Surfaces a taste decision to the human (e.g. "should this be one initiative or two?").

The user only sees the genuine taste decisions; the mechanics are handled. Inspired by gstack's `/autoplan` chain.

Implementation lives in `skills/architect-llm-council/`. Each critic is a skill invocation (per ADR 003). Pass/fail is structured — when all critics pass without escalation, the initiative is ready to queue.

The dependency-graph critic specifically watches for hidden dependencies that would cause parallel work-item collisions. The acceptance-criteria critic specifically watches for vagueness that would propagate downstream and break the developer loop.

## Sources

- [`docs/phases/architect.md`](../../../docs/phases/architect.md) — phase doc references the pattern.
- [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) — narrative mention.

## See also

- [[skills-as-agent-surface]] — each council critic is a skill.
- [[gstack-conventions]] — the inspiration.
