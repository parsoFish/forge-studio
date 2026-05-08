---
title: Six phases of forge backed by a brain
description: Brain → Architect → Project Manager → Developer Loop → Review Loop → Reflection. Three human-in-the-loop touchpoints; everything else unattended.
category: reference
keywords: [phases, architecture, six-phases, brain, architect, pm, developer-loop, review-loop, reflection]
created_at: 2026-05-04T17:55:00Z
updated_at: 2026-05-04T17:55:00Z
related_themes: [phase-isolation-benchmarks, markdown-artifact-flow, unattended-scheduler]
---

# Six phases of forge backed by a brain

Forge is six phases backed by a brain. Phases run in sequence per initiative; the brain is read by every phase as the first source of knowledge and written to at the end of every cycle.

```
                              ┌──────────┐
                              │  Brain   │ ◄───────────────────────────┐
                              └────┬─────┘                              │
                                   │ queried by every phase             │ ingest
                                   ▼                                    │
   user ──► Architect ──► Project Manager ──► Developer Loop ──► Review Loop ──► Reflection
```

| Phase | Mode | Purpose |
|---|---|---|
| Brain | always-on | Karpathy three-layer wiki + 3 skills (ingest/lint/query) |
| Architect | human-in-loop | Idea → initiative manifest (LLM Council pattern) |
| Project Manager | unattended | Initiative → spec-driven work items with deps |
| Developer Loop | unattended | Ralph loop pattern over Claude Agent SDK |
| Review Loop | human-in-loop | Review-prep + demo + PR + human approval |
| Reflection | human-in-loop, then ingest | Retro → new theme pages in brain |

Three human interaction points: Architect (ideation), Review (closeout), Reflection (feedback). Everything else runs unattended.

## Sources

- [`forge-v2-architecture.docs.md`](../../_raw/docs/forge-v2-architecture.docs.md) — narrative architecture.
- [`forge-v2-phase-brain.docs.md`](../../_raw/docs/forge-v2-phase-brain.docs.md) through [`forge-v2-phase-reflection.docs.md`](../../_raw/docs/forge-v2-phase-reflection.docs.md) — per-phase docs.

## Related

- [Theme: Phase isolation benchmarks](./phase-isolation-benchmarks.md) — how each phase measures improvement.
- [Theme: Markdown artifact flow](./markdown-artifact-flow.md) — what flows between the phases.
