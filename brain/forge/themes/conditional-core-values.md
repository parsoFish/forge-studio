---
title: Conditional core-values injection per role
description: Each agent role receives only the subset of core values relevant to its job. Smaller stable prefix → better cache hits + less token waste on irrelevant context.
category: pattern
keywords: [core-values, role-specific, system-prompt, cache-prefix, token-optimization, per-skill]
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
related_themes: [prompt-caching-strategy, skills-as-agent-surface, cost-aware-model-routing]
---

# Conditional core-values injection per role

Forge has three core values: Quality Gates, Bold Autonomy, Self-Sufficient Specs. Not all roles need all three. A pr-creator agent doesn't need detailed TDD guidance; a developer agent doesn't need PR description format guidance. Injecting all values into all agents wastes tokens on irrelevant context **and** bloats the cacheable system-prompt prefix.

Per-role allocation (from v1):

- **developer**: Quality Gates (TDD, zero warnings) + Bold Autonomy (own decisions).
- **planner / project-manager**: Self-Sufficient Specs (work items need no clarification).
- **reviewer**: Quality Gates (verify gates passed) + Self-Sufficient Specs (PR descriptions explain decisions).

In v2 this generalises naturally to the SKILL.md pattern: each skill's `SKILL.md` declares its own constraints in its prose, so the role-specific values are *embedded* rather than injected. The `coreValuesPromptForRole()` helper from v1 isn't needed when the skill *is* the prompt.

The secondary benefit — a smaller, more stable prefix means better prompt-cache utilisation — still applies. Skills should not import each other's constraints unless directly relevant.

## Sources

- [`v1-themes-cost-and-cache.cycle.md`](../../_raw/v1-wiki/v1-themes-cost-and-cache.cycle.md) — v1 implementation details.

## Related

- [Theme: Prompt caching strategy](./prompt-caching-strategy.md) — what the compact prefix enables.
- [Theme: Skills as agent surface](./skills-as-agent-surface.md) — v2's natural form.
- [Theme: Cost-aware model routing](./cost-aware-model-routing.md) — sister cost lever.
