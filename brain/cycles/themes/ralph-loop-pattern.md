---
title: Ralph loop pattern
description: >-
  ~30-line outer loop where iteration lives in the loop itself, not the
  orchestrator. Used as forge v2's developer loop.
category: pattern
keywords:
  - ralph
  - loop
  - agentic-loop
  - developer-loop
  - ghuntley
  - stop-conditions
  - iteration
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - claude-agent-sdk
  - wedged-loop-detector
  - alternative-loop-runtimes
---

# Ralph loop pattern

The Ralph loop pattern (Geoffrey Huntley, late 2025) is a ~30-line outer loop that calls an underlying agent (Claude Agent SDK `query()`) against a worktree, commits changes, checks stop conditions, and repeats. Iteration is *inside* the loop — the orchestrator never has to retry.

```
loop:
  read PROMPT.md, AGENT.md (institutional memory), specs/, fix_plan.md
  call query() against the worktree
  commit changes
  check stop conditions (quality gates pass | iteration budget | wedged)
  if stop: exit; else update fix_plan.md, repeat
```

Stop conditions are pluggable (`loops/ralph/stop-conditions.ts`): quality gates pass, iteration budget exceeded, wedged-detector. The pattern is **agent-swappable** — `loops/_adapters/` will hold hermes/aider/openhands variants implementing the same loop shape with different underlying agents.

Reference implementations exist from Anthropic (ralph-wiggum plugin), Vercel (ralph-loop-agent), and HumanLayer's writeup.

## Sources

- [`adr-002-ralph-loop-pattern.docs.md`](../../_raw/docs/adr-002-ralph-loop-pattern.docs.md) — decision record + alternatives.

## See also

- [[claude-agent-sdk]] — what Ralph calls.
- [[wedged-loop-detector]] — one of the stop conditions.
- [[alternative-loop-runtimes]] — alternative loop runtimes — aider, openhands, openclaw, hermes.
