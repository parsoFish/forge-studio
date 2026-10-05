---
title: Simplicity is key — every "no" defends it
description: >-
  User principle 2. Forge is a small core that hangs powerful tools together.
  The non-goals lists across ADRs are load-bearing.
category: pattern
keywords:
  - simplicity
  - principle-2
  - minimal
  - non-goals
  - small-core
  - knobs
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - avoid-hand-rolling-tools
  - minimal-runtime-config
  - infrastructure-evolution
---

# Simplicity is key — every "no" defends it

User principle 2 (verbatim): *"Simplicity is key and is powerful, I have seen some incredible solutions built entirely out of only a handful of skills, agent personas, and some scripts or tools that those agents know how to utilise well."*

The shape of the system is what costs to change later. Every knob, every fallback, every "for backwards compatibility" path widens the surface and slows future iteration. V1 grew rich infrastructure; V2 holds a hard line.

Defended in:

- **`forge.config.json` is minimal** — ~10 lines. Settings live in DECISIONS.md / SKILL.md / manifest frontmatter.
- **No job queue / worker / resource controller** — `_queue/` directories + ~150-line scheduler (R-03, D-04).
- **No process isolation module** — `git worktree` (D-02).
- **No retry / dedup / priority queue** — failure → human triage; pending items processed in filesystem order.
- **No vector DB** — `brain-query` does grep-and-load; embeddings only if recall becomes a bottleneck (SPEC §4).
- **No `forge-v1`-style stage pipeline** — Ralph loop pattern collapses it (SPEC §1).

Every ADR's "Alternatives considered" + non-goals section is part of this principle.

## Sources

- [`PRINCIPLES.md`](../../../PRINCIPLES.md) — principle 2.
- [`adr-009-minimal-config.docs.md`](../../_raw/docs/adr-009-minimal-config.docs.md), [`adr-011-unattended-scheduler.docs.md`](../../_raw/docs/adr-011-unattended-scheduler.docs.md) — explicit small-core defenses.

## See also

- [[avoid-hand-rolling-tools]] — companion principle.
- [[minimal-runtime-config]] — concrete codification.
- [[infrastructure-evolution]] — what was rejected and why.
