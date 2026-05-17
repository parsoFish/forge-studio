---
title: Atomic TDD work-item decomposition produced high first-pass throughput
description: The PM split 3 features into 5 WIs separating impl from test WIs. 4 of 5 WIs passed quality gates on iteration 1. First-pass completion rate: 80% with no wedges.
category: pattern
keywords: [atomic-decomposition, tdd, work-items, pm, first-pass, quality-gates, iteration-efficiency]
created_at: 2026-05-17T02:41:01Z
updated_at: 2026-05-17T02:41:01Z
related_themes: [tdd-with-agents, spec-driven-work-items, dependency-ordered-work]
---

# Atomic TDD work-item decomposition produced high first-pass throughput

## What happened

In cycle `chained-INIT-2025-05-17-slugifier-package-1778984667230`, the PM decomposed 3 features into 5 work items:

- **WI-1**: FEAT-1 implementation (`src/slugify.ts`)
- **WI-2**: FEAT-1 tests (`tests/slugify.test.ts`)
- **WI-3**: FEAT-2 implementation + tests (`src/batch.ts`)
- **WI-4**: FEAT-3 options implementation (extend `slugify.ts`)
- **WI-5**: FEAT-3 options tests (extend `tests/slugify.test.ts`)

The PM ran with 10 brain reads, 0 parse errors, and 0 hidden-coupling violations. Each WI had explicit Given-When-Then acceptance criteria directly traceable to the initiative manifest's feature specs.

**Results:**
- WI-2, WI-3, WI-4, WI-5 all passed quality gates on iteration 1 (80% first-pass rate).
- Only WI-1 needed 2 iterations, and that was due to scratch-file orientation overhead — not a spec or implementation failure.
- No wedge events. No send-backs in the dev loop.

## Why it worked

1. **Separation of impl from test WIs** (FEAT-1, FEAT-3): the developer implemented code in one WI and verified/expanded tests in the next. Each WI had a focused, narrow output set.
2. **Explicit acceptance criteria per WI**: every WI inherited Given-When-Then cases directly from the initiative manifest, so the agent could self-verify without ambiguity.
3. **Dependency ordering**: WI-1 before WI-2, FEAT-2 and FEAT-3 both depend on FEAT-1, ensuring the implementation order was safe.

## Sources

- `_logs/chained-INIT-2025-05-17-slugifier-package-1778984667230/events.jsonl` — PM end event `EV_mp95n8vd_35yc8jj3` (5 WIs, 0 errors); WI end events EV_mp95ruhg, EV_mp95t1ht, EV_mp95un7g, EV_mp95wi0x (all status=complete, iterations=1)
- `/home/parso/forge/brain/_raw/cycles/chained-INIT-2025-05-17-slugifier-package-1778984667230.md`
