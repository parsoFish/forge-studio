---
title: Simplicity is key — every "no" defends it
description: User principle 2. Forge is a small core that hangs powerful tools together. The non-goals lists across ADRs are load-bearing.
category: pattern
keywords: [simplicity, principle-2, minimal, non-goals, small-core, knobs]
created_at: 2026-05-04T17:55:00Z
updated_at: 2026-05-04T17:55:00Z
related_themes: [avoid-hand-rolling-tools, minimal-runtime-config, v1-vs-v2-key-differences]
---

# Simplicity is key — every "no" defends it

User principle 2 (verbatim): *"Simplicity is key and is powerful, I have seen some incredible solutions built entirely out of only a handful of skills, agent personas, and some scripts or tools that those agents know how to utilise well."*

The shape of the system is what costs to change later. Every knob, every fallback, every "for backwards compatibility" path widens the surface and slows future iteration. V1 grew rich infrastructure; V2 holds a hard line.

Defended in:

- **`forge.config.json` is minimal** — ~10 lines (ADR 009). Settings live in ADRs / SKILL.md / manifest frontmatter.
- **No job queue / worker / resource controller** — `_queue/` directories + ~150-line scheduler (ADR 011).
- **No process isolation module** — `git worktree` (ADR 006/011).
- **No retry / dedup / priority queue** — failure → human triage; pending items processed in filesystem order.
- **No vector DB** — `brain-query` does grep-and-load; embeddings only if recall becomes a bottleneck (ADR 004).
- **No `forge-v1`-style stage pipeline** — Ralph loop pattern collapses it (ADR 002).

Every ADR's "Alternatives considered" + non-goals section is part of this principle.

## Sources

- [`forge-v2-principles.docs.md`](../../_raw/docs/forge-v2-principles.docs.md) — principle 2.
- [`adr-009-minimal-config.docs.md`](../../_raw/docs/adr-009-minimal-config.docs.md), [`adr-011-unattended-scheduler.docs.md`](../../_raw/docs/adr-011-unattended-scheduler.docs.md) — explicit small-core defenses.

## Related

- [Theme: Avoid hand-rolling tools](./avoid-hand-rolling-tools.md) — companion principle.
- [Theme: Minimal runtime config](./minimal-runtime-config.md) — concrete codification.
