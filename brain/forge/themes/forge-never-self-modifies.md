---
title: Forge never self-modifies while running
description: >-
  Reflection outputs recommendations; a human implements forge changes in a
  separate session after the forge process is stopped. CI validates before forge
  restarts.
category: operation
keywords:
  - self-modification
  - reflect
  - separate-session
  - mid-cycle-risk
  - recommendations
  - governance
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes:
  - unattended-scheduler
  - file-based-state-machine
  - brain-gap-feedback-loop
---

# Forge never self-modifies while running

Forge is the orchestrator managing active jobs, event logs, and queue state. If a reflect agent modified `orchestrator/scheduler.ts` or `orchestrator/queue.ts` while jobs are running, the next heartbeat cycle would execute against partially-written files, corrupting state.

Discipline:

- The reflect phase outputs a **structured list of recommendations** (in retro.md + new theme-page deltas).
- A human reads them, approves the ones that make sense, and implements changes in a separate Claude Code session **after `forge serve` is stopped**.
- CI validates the changes before forge is restarted.

Forge improvements follow conventional commits and normal PR review — they're code changes that deserve the same quality gates as project code.

This is the first "pause point" in the system. Even though the unattended scheduler can run for arbitrary durations, **changes to forge itself can't ride the unattended path**. They must hit the human-in-the-loop architect → review → reflection cycle just like any other initiative.

## Sources

- [`v1-themes-failure-modes.cycle.md`](../../_raw/v1-wiki/v1-themes-failure-modes.cycle.md) — full discipline + rationale.

## See also

- [[unattended-scheduler]] — what gets paused before self-modification.
- [[file-based-state-machine]] — the state at risk of corruption.
- [[brain-gap-feedback-loop]] — how reflect-output flows into the brain.
