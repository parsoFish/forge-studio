---
title: v1 vs v2 — what was rejected and why
description: >-
  V2 keeps v1's mental models (TDD, dep-ordered work, brain-as-wiki) and
  replaces v1's hand-rolled infrastructure with battle-tested community tools.
category: reference
keywords:
  - v1
  - v2
  - comparison
  - evolution
  - rejected
  - infrastructure
  - refactor
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - avoid-hand-rolling-tools
  - simplicity-as-architecture
  - six-phases-of-forge
---

# v1 vs v2 — what was rejected and why

V1 grew rich infrastructure: a job queue, a worker pool, a resource controller, adaptive concurrency, process isolation. Each was a reasonable response to a real problem at the time. Together they made it onerous to change the *shape* of the system.

V2 is a fresh repo (not a refactor) that keeps v1's mental models and replaces v1's infrastructure:

| v1 | v2 |
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

V2 has **no v1 users to support** — no feature flags, no fallbacks, no "for backwards compatibility" paths.

## Sources

- [`forge-v2-architecture.docs.md`](../../_raw/docs/forge-v2-architecture.docs.md) — "What forge is *not*" section.
- [`adr-011-unattended-scheduler.docs.md`](../../_raw/docs/adr-011-unattended-scheduler.docs.md) — explicit non-rebuild list.

## See also

- [[avoid-hand-rolling-tools]] — principle that drove the swap.
- [[simplicity-as-architecture]] — principle that drove the cuts.
- [[six-phases-of-forge]] — six phases of forge backed by a brain.
