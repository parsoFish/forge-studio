---
title: >-
  Cost-aware model routing — Opus for design, Sonnet for coding, Haiku for
  triage
description: >-
  Different tasks have different reasoning depths. Per-skill model overrides in
  forge.config.json route triage to Haiku, coding to Sonnet, deep design to
  Opus.
category: pattern
keywords:
  - model-routing
  - opus
  - sonnet
  - haiku
  - cost
  - model-selection
  - per-skill
  - frontmatter
created_at: 2026-05-04T18:00:00.000Z
updated_at: 2026-05-04T18:00:00.000Z
related_themes:
  - minimal-runtime-config
  - claude-agent-sdk
  - skills-as-agent-surface
---

# Cost-aware model routing

Different tasks have different reasoning depths. Using the most powerful model for everything is wasteful and slow.

Practitioner default mapping:

- **Haiku 4.5** — lightweight agents with frequent invocation; worker agents in multi-agent systems; pair programming. ~3× cost savings vs Sonnet at ~90% capability. Forge default for `brain-query`.
- **Sonnet 4.6** — main development work; orchestrating multi-agent workflows; complex coding tasks. The default for the developer loop.
- **Opus 4.7** — complex architectural decisions; maximum reasoning requirements; research and analysis. Forge default for `architect`.

Forge configuration:

```jsonc
// forge.config.json
{
  "models": {
    "default": "claude-sonnet-4-6",
    "architect": "claude-opus-4-7",
    "brain-query": "claude-haiku-4-5"
  }
}
```

Per-skill `SKILL.md` frontmatter (`model:` field) is the alternative — useful when a skill is the canonical owner of its model choice rather than user-overridden.

The routing isn't fixed. A skill's model choice is itself a benchmark target — Haiku at brain-query is good if recall doesn't drop. If it does, escalate to Sonnet. The benchmark delta tells the answer.

**v1 evidence:** v1's `pr-creator` running on Haiku at $0.12/run validated that misrouting (running everything on Opus) wastes ~87% of per-token cost. Together with prompt caching's 92% hit rate, model routing is one of the two largest cost levers in v1's Cycle 3 token budget.

## Sources

- [`agentic-engineering-best-practices.chat.md`](../../_raw/web/agentic-engineering-best-practices.chat.md) — synthesis section 5.
- [`adr-009-minimal-config.docs.md`](../../_raw/docs/adr-009-minimal-config.docs.md) — `models.<skill>` override location.
- [`v1-themes-cost-and-cache.cycle.md`](../../_raw/v1-wiki/v1-themes-cost-and-cache.cycle.md) — 87% cost-reduction data point + pr-creator at $0.12/run.

## See also

- [[minimal-runtime-config]] — where overrides live.
- [[claude-agent-sdk]] — the runtime that respects the choice.
- [[skills-as-agent-surface]] — per-skill defaults via `SKILL.md`.
