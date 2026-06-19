---
title: Infrastructure evolution — what was rejected and why
description: >-
  Forge keeps its founding mental models (TDD, dep-ordered work,
  brain-as-wiki) and replaces hand-rolled infrastructure with battle-tested
  community tools. The comparison records what the prior approach grew and
  what the current design ships instead.
category: reference
keywords:
  - comparison
  - evolution
  - rejected
  - infrastructure
  - refactor
  - hand-rolling
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-06-19T00:00:00.000Z
related_themes:
  - avoid-hand-rolling-tools
  - simplicity-as-architecture
  - six-phases-of-forge
---

# Infrastructure evolution — what was rejected and why

A **prior approach** grew rich infrastructure: a job queue, a worker pool, a
resource controller, adaptive concurrency, process isolation. Each was a
reasonable response to a real problem at the time. Together they made it
onerous to change the *shape* of the system.

The **current** design keeps the founding mental models and replaces the
hand-rolled infrastructure with battle-tested community tools:

| Prior approach | Current |
|---|---|
| Job queue + worker pool + resource controller (~6,000 LOC) | `_queue/` directories + ~300-LOC scheduler |
| Adaptive concurrency, CPU/memory monitoring | Static `maxConcurrentInitiatives` (default 2) |
| Custom process-isolation module | `git worktree` |
| Markdown personas spawned as `claude` subprocesses | Claude Code skills via `@anthropic-ai/claude-agent-sdk` |
| Stage agents (plan→test→develop→pr) with retry in orchestrator | Ralph loop pattern (iteration inside the loop) |
| Hand-rolled `src/git/workflow.ts` | `gh` CLI + `git worktree` |
| TS objects + JSON state files between phases | Markdown artifacts + YAML frontmatter (gstack-style) |
| Bloated `forge.config.json` | Minimal config; settings live in ADRs / SKILL.md / manifest |
| Multiple log surfaces (worker, agent, event, budget) | One JSONL event log per cycle |

The current design has **no legacy users to support** — no feature flags, no
fallbacks, no "for backwards compatibility" paths.

## Sources

- [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) — "What forge is *not*" section.
- [`docs/decisions/011-unattended-scheduler.md`](../../../docs/decisions/011-unattended-scheduler.md) — explicit non-rebuild list.

## See also

- [[avoid-hand-rolling-tools]] — principle that drove the swap.
- [[simplicity-as-architecture]] — principle that drove the cuts.
- [[six-phases-of-forge]] — six phases of forge backed by a brain.
