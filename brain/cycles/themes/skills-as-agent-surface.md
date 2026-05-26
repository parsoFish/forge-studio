---
title: Skills as the agent surface
description: >-
  Every "agent" in forge v2 is a Claude Code skill (SKILL.md per role) — no
  spawned subprocesses, no custom registry.
category: pattern
keywords:
  - skills
  - claude-code
  - agent
  - persona
  - hot-swappable
  - version-controlled
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - claude-agent-sdk
  - brain-first-research
  - llm-council-pattern
---

# Skills as the agent surface

Every "agent" in forge v2 is a Claude Code skill — a directory with a mandatory `SKILL.md` and optional helpers. Skills are version-controlled, hot-swappable, and inherit Claude Code platform improvements automatically. V1's spawn-the-CLI-with-a-markdown-persona approach is rejected: every prompt change had to become a code change.

Forge ships nine skills at scaffold: `architect`, `architect-llm-council`, `project-manager`, `reviewer`, `reflector`, `brain-ingest`, `brain-lint`, `brain-query`, `developer-ralph`.

Every `SKILL.md` follows the same shape: single responsibility, declared inputs (file/folder paths), declared outputs (artifacts written), `brain-query`-first action, named benchmark suite, declared event-log entries.

Trade-off: skill discovery is conventional (filesystem-based), not registered. Skills don't have first-class types — the contract lives in `SKILL.md` prose.

## Sources

- [`adr-003-skills-not-self-baked-agents.docs.md`](../../_raw/docs/adr-003-skills-not-self-baked-agents.docs.md) — decision record.

## See also

- [[claude-agent-sdk]] — runtime the skills run on.
- [[brain-first-research]] — every skill's mandated first action.
- [[llm-council-pattern]] — multi-skill chain used in the architect.
