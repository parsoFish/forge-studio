---
source_type: web
source_url: https://github.com/garrytan/gstack
source_title: gstack — skill-driven agentic system (README)
ingested_at: 2026-05-04T18:00:00Z
ingested_by: brain-ingest (Pass A, batch 4)
cycle_id: pass-a-bootstrap
---

# gstack: Core Conventions

## Architecture & Organisation

gstack structures AI work as **23 specialised skills** organised by sprint phase: Think → Plan → Build → Review → Test → Ship → Reflect. Each skill represents a role (CEO, Designer, Eng Manager, QA Lead) that Claude assumes through slash commands like `/office-hours`, `/review`, `/qa`. Skills feed outputs into downstream skills — design docs from `/office-hours` inform `/plan-ceo-review`, test plans from `/plan-eng-review` guide `/qa`.

## The SKILL.md Pattern

Each skill defines itself via `SKILL.md` (with templating via `SKILL.md.tmpl`). This metadata pattern allows the system to advertise capabilities to AI agents without hardcoding. The template approach enables per-host customisation — gstack adapts to Claude Code, Cursor, Codex, and eight other agents through configuration rather than duplication.

## Markdown-Artifacts Workflow

Skills communicate through structured Markdown: design docs, architecture diagrams, test matrices, and decision logs all persist as artifacts. This creates a **knowledge chain** — each skill reads what prior skills wrote, building context without prompt engineering. `/learn` explicitly manages this memory, storing project-specific patterns that compound across sessions.

## Notable Differentiators

- **`/autoplan`** orchestrates multiple reviews automatically (CEO → Design → Engineering) with taste-decision surfacing, eliminating manual skill-stacking.
- **`/pair-agent`** extends the philosophy across vendors — multiple AI agents share a browser with token-scoped isolation.
- The system treats this as a **process, not tools**: Claude's weakness (overcomplexity, wrong assumptions) maps to gstack skills that force decisions into the open before code exists.
