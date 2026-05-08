---
title: healarr — tier-coded tool boundaries (Observe / Nudge / Correct / Escalate)
description: Every tool maps to exactly one tier. Tier sets the default policy: Observe always-on, Nudge auto, Correct email-gated, Escalate propose-only. New tools require an explicit tier assignment.
category: decision
keywords: [healarr, tier, tool-boundaries, observe, nudge, correct, escalate, blast-radius, approval]
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
related_themes: []
---

# healarr — tier-coded tool boundaries

healarr's safety model is a four-tier classification of every tool the agent can call:

| Tier | Examples | Default policy |
|---|---|---|
| **Observe** (read-only) | get queue, get history, get torrents | Always on |
| **Nudge** (reversible, no data loss) | trigger search, rescan library, retry import | Auto |
| **Correct** (destructive but reversible) | blocklist release, delete torrent + files, manual import | **Email approval gated** |
| **Escalate** (high blast radius) | delete media, modify Plex library | **Off — agent can only propose** |

Discipline:

- Every tool is added by choosing its tier, documenting the choice in `docs/tools.md`, and wiring the default policy.
- **Reversibility check**: anything in Nudge must be undoable without data loss. If it isn't, it's actually Correct (or Escalate). The architect's Engineering critic flags this.
- The architect rejects "let the agent just decide" framings — a tool's tier is a decision the user makes, not the agent.

This is healarr's instance of the system-level *quality-gates-orchestrator-verified* discipline: trust is structural, not promised.

## Sources

- healarr README "What it does about it" — full tier table + default policies.

## Related

- [Theme: Quality gates orchestrator-verified](../../../forge/themes/quality-gates-orchestrator-verified.md) — sister principle at the system level.
