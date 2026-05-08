---
source_type: docs
source_url: docs/decisions/003-skills-not-self-baked-agents.md
source_title: ADR 003 — All "agents" are Claude Code skills
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 1)
cycle_id: pass-a-bootstrap
---

# ADR 003 — All "agents" are Claude Code skills

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

V1 had three agents (planner, developer, reviewer) defined as markdown personas spawned as Claude CLI subprocesses with custom turn limits, custom session handling, and custom prompt assembly. Every prompt change was a code change; every Claude Code platform improvement (skills, slash commands, hot-swappable prompts) bypassed forge.

## Decision

**Every "agent" in forge v2 is a Claude Code skill.** A skill is a directory containing a `SKILL.md` (mandatory) and optional helper files. Skills are version-controlled, hot-swappable, and benefit from the Claude Code platform's native skill conventions.

Forge ships nine skills at scaffold time: architect, architect-llm-council, project-manager, reviewer, reflector, brain-ingest, brain-lint, brain-query, developer-ralph.

Every `SKILL.md` follows the same shape: single responsibility, declared inputs (file/folder paths), declared outputs (artifacts written), `brain-query`-first, named benchmark suite, declared event-log entries.

## Consequences

- Prompt changes are content changes, not code changes.
- Users can plug in their own skills without touching orchestrator code.
- Forge benefits directly from Claude Code platform improvements.
- Each skill has a benchmark suite — improvement is measurable per skill.
- Trade-off: skill discovery is conventional (filesystem-based), not registered. We rely on the convention rather than a registry. Skills don't have first-class types — the contract lives in `SKILL.md` prose.

## Alternatives considered

- V1's markdown personas + spawned CLI — explained above, rejected.
- A custom skill registry/loader in TS — premature; the filesystem is fine.
- gstack-style `SKILL.md.tmpl` per skill — keep optional. Some skills will benefit; others won't.

## References

- https://docs.claude.com/en/docs/claude-code/skills
- https://github.com/garrytan/gstack — example of a system built entirely on skills
