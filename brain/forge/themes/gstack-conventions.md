---
title: 'gstack conventions — process-not-tools, skill-driven, markdown-artifact-flow'
description: >-
  23 sprint-phase skills + SKILL.md/SKILL.md.tmpl + /autoplan + /learn. Inspired
  forge v2's skills-as-agents and markdown-artifact-flow.
category: reference
keywords:
  - gstack
  - garrytan
  - skills
  - autoplan
  - learn
  - sprint-phases
  - markdown-artifacts
created_at: 2026-05-04T18:00:00.000Z
updated_at: 2026-05-04T18:00:00.000Z
related_themes:
  - skills-as-agent-surface
  - markdown-artifact-flow
  - llm-council-pattern
---

# gstack conventions

[gstack](https://github.com/garrytan/gstack) is a skill-driven agentic system that influenced multiple forge v2 decisions. Three patterns to absorb:

- **Sprint-phase skills.** 23 skills organised across Think → Plan → Build → Review → Test → Ship → Reflect. Each skill represents a role (CEO, Designer, Eng Manager, QA Lead) invoked via slash commands. Skills feed downstream — design docs from `/office-hours` inform `/plan-ceo-review`; test plans from `/plan-eng-review` guide `/qa`.

- **`SKILL.md` + `SKILL.md.tmpl`.** Each skill is self-describing via `SKILL.md`. The template variant enables per-host customisation across Claude Code, Cursor, Codex, and others — adapt by configuration, not duplication.

- **Markdown-artifact knowledge chain.** Skills communicate through structured markdown — design docs, architecture diagrams, test matrices, decision logs. Each skill reads what prior skills wrote, building context without prompt engineering. `/learn` explicitly manages the memory.

- **`/autoplan`** orchestrates multi-perspective review automatically (CEO → Design → Engineering) with taste-decision surfacing — the inspiration for forge's LLM Council pattern.

The framing slogan: gstack treats this as a **process, not tools**. Claude's weakness (overcomplexity, wrong assumptions) is mapped to skills that force decisions into the open *before code exists*.

## Sources

- [`gstack-readme.web.md`](../../_raw/web/gstack-readme.web.md) — README extract.

## See also

- [[skills-as-agent-surface]] — what forge inherits.
- [[markdown-artifact-flow]] — what forge inherits.
- [[llm-council-pattern]] — `/autoplan` is the inspiration.
