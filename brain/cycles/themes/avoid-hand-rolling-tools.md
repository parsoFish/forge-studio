---
title: Avoid hand-rolling tools that battle-tested community equivalents exist for
description: >-
  User principle 1 — plug into Claude, gh CLI, git worktree, Ralph loop, etc.
  The user's idea is in hanging powerful ideas together, not building from
  scratch.
category: pattern
keywords:
  - hand-rolling
  - battle-tested
  - community-tools
  - principle-1
  - dependencies
  - leverage
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - simplicity-as-architecture
  - claude-agent-sdk
  - ralph-loop-pattern
  - gh-cli-and-worktrees
---

# Avoid hand-rolling tools

User principle 1 (verbatim): *"Avoid hand rolling solutions at all cost if there are existing solutions that fill the requirements of a component in the forge architecture, and wherever possible plug into solutions that are already heavily in use such as claude, github copilot, etc. … These solutions are at this stage battle tested and likely more powerful than any solution I could come up with on my own given the community support and attention. … I think my idea is powerful in hanging other powerful ideas together, not in building the entire thing from scratch."*

Concrete consequences in v2:

- Agent runtime → Claude Agent SDK (ADR 001).
- Developer loop → Ralph loop pattern (ADR 002).
- Agents themselves → Claude Code skills (ADR 003).
- Git/PR ops → `gh` CLI + `git worktree` (ADR 006).
- CI → GitHub Actions.
- Wiki rendering → Obsidian (ADR 004).

Test: when reviewing a proposed addition to v2, ask "is this re-inventing X that already exists?" If yes, find X. If no X exists, *then* hand-roll — minimally, with a clear single responsibility.

## Sources

- [`PRINCIPLES.md`](../../../PRINCIPLES.md) — principle 1.
- [`adr-001-claude-agent-sdk.docs.md`](../../_raw/docs/adr-001-claude-agent-sdk.docs.md), [`adr-002-ralph-loop-pattern.docs.md`](../../_raw/docs/adr-002-ralph-loop-pattern.docs.md), [`adr-003-skills-not-self-baked-agents.docs.md`](../../_raw/docs/adr-003-skills-not-self-baked-agents.docs.md), [`adr-006-gh-cli-and-worktrees.docs.md`](../../_raw/docs/adr-006-gh-cli-and-worktrees.docs.md) — codifications.

## See also

- [[simplicity-as-architecture]] — companion principle.
- [[claude-agent-sdk]] — claude agent sdk as the agent runtime.
- [[ralph-loop-pattern]] — ralph loop pattern.
- [[gh-cli-and-worktrees]] — gh cli + git worktrees + github actions.
- [[infrastructure-evolution]] — what got swapped.
