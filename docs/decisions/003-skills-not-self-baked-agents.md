# ADR 003 — All "agents" are Claude Code skills

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

V1 had three agents (planner, developer, reviewer) defined as markdown personas spawned as Claude CLI subprocesses with custom turn limits, custom session handling, and custom prompt assembly. That made every prompt change a code change, every persona update a deploy, and every Claude Code platform improvement (skills, slash commands, hot-swappable prompts) bypass forge entirely.

## Decision

**Every "agent" in forge v2 is a Claude Code skill.**

A skill is a directory containing a `SKILL.md` (mandatory) and optional helper files. Skills are version-controlled, hot-swappable, and benefit from the Claude Code platform's native skill conventions.

Forge ships nine skills at scaffold time:
- `skills/architect/` — interactive ideation → initiative.
- `skills/architect-llm-council/` — multi-perspective critic chain.
- `skills/project-manager/` — initiative → work items.
- `skills/reviewer/` — review-prep + reviewer persona.
- `skills/reflector/` — cycle retrospective.
- `skills/brain-ingest/` — wiki appender.
- `skills/brain-lint/` — wiki integrity.
- `skills/brain-query/` — wiki lookup; mandated as the first action of every other skill.
- `skills/developer-ralph/` — launches the developer loop (calls into `loops/ralph/`).

Every `SKILL.md` follows the same shape: single responsibility, declared inputs (file/folder paths), declared outputs (artifacts written), `brain-query`-first, declared event-log entries.

The orchestrator spawns each phase as a clean, model-tiered **agent** that composes skills/CLIs/MCP — the agent→skill composition layer is formalised in [ADR 024](./024-phases-as-subagents-invoking-skills.md).

## Consequences

**Positive:**
- Prompt changes are content changes, not code changes.
- Users can plug in their own skills without touching orchestrator code.
- Forge benefits directly from Claude Code platform improvements.

**Negative / accepted trade-offs:**
- Skill discovery is conventional (filesystem-based), not registered. We rely on the convention rather than a registry.
- Skills don't have first-class types — the contract lives in `SKILL.md` prose.

## Alternatives considered

- **V1's markdown personas + spawned CLI** — explained above, rejected.
- **A custom skill registry/loader in TS** — premature; the filesystem is fine.
- **gstack-style `SKILL.md.tmpl` per skill** — keep optional. Some skills will benefit; others won't. Don't mandate.

## References

- [Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills)
- [garrytan/gstack](https://github.com/garrytan/gstack) — example of a system built entirely on skills
