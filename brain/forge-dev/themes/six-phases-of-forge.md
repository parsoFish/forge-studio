---
title: Six phases of forge backed by a brain
description: >-
  Brain → Architect → Project Manager → Developer Loop → Review Loop →
  Reflection. Three human-in-the-loop touchpoints; everything else unattended.
category: reference
keywords:
  - phases
  - architecture
  - six-phases
  - brain
  - architect
  - pm
  - developer-loop
  - review-loop
  - reflection
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - phase-isolation-benchmarks
  - markdown-artifact-flow
  - unattended-scheduler
---

# Six phases of forge backed by a brain

Forge is six phases backed by a brain. Phases run in sequence per initiative; the brain is read by the **planning phases and the reflector** as the first source of knowledge and written to at the end of every cycle.

> **Brain-read policy (ADR 010, amended 2026-05-26):** the dev-loop and reviewer do **NOT** read
> the forge brain (Brains 1+2). The planner already encoded every relevant convention/antipattern
> into the work items. They may consult Brain 3 (the project's own `brain/`) for supplemental
> project context — advisory, not mandatory. See `brain/forge-dev/themes/brain-read-policy.md`.

```
                              ┌──────────┐
                              │  Brain   │ ◄───────────────────────────┐
                              └────┬─────┘                              │
                                   │ queried by planners + reflector    │ ingest
                                   │ (NOT by dev-loop or reviewer)      │
                                   ▼                                    │
   user ──► Architect ──► Project Manager ──► Developer Loop ──► Review Loop ──► Reflection
```

| Phase | Mode | Brain access | Purpose |
|---|---|---|---|
| Brain | always-on | writes | Karpathy three-layer wiki + 3 skills (ingest/lint/query) |
| Architect | human-in-loop (UI) | reads Brain 1+2+3 | Idea → initiative manifest (LLM Council pattern) |
| Project Manager | unattended | reads Brain 2+3 | Initiative → spec-driven work items with deps |
| Developer Loop | unattended | Brain 3 only (advisory) | Ralph loop pattern over Claude Agent SDK |
| Review Loop | automated loop | Brain 3 only (advisory) | Review-prep + demo + PR + operator approval |
| Reflection | human-in-loop, then ingest | reads+writes all | Retro → new theme pages in brain |

Three human interaction points: Architect (ideation), Review (closeout on `/review/<id>` UI screen), Reflection (feedback). Everything else runs unattended.

## Sources

- [`forge-v2-architecture.docs.md`](../../_raw/docs/forge-v2-architecture.docs.md) — narrative architecture.
- [`forge-v2-phase-brain.docs.md`](../../_raw/docs/forge-v2-phase-brain.docs.md) through [`forge-v2-phase-reflection.docs.md`](../../_raw/docs/forge-v2-phase-reflection.docs.md) — per-phase docs.

## See also

- [[phase-isolation-benchmarks]] — how each phase measures improvement.
- [[markdown-artifact-flow]] — what flows between the phases.
- [[unattended-scheduler]] — unattended scheduler with file-based queue + worktree pool.
