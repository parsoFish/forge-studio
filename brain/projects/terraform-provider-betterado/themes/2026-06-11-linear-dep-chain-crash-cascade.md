---
title: Fully-linear WI dependency chain amplifies single crash to total failure
description: A 5-WI fully sequential dependency chain (WI-1 → WI-2 → ... → WI-5) caused 0/5 delivery when WI-1 crashed twice; all 4 downstream WIs skipped as prerequisite-failed. Re-decomposed to 2 WIs on resume — same scope, delivered in 1 iteration each.
category: antipattern
keywords: [linear-dependency-chain, crash-cascade, prerequisite-failed, over-granulated, fan-out-then-merge, decompose-shape, resilience]
related_themes: [cycle-recovery-index, pm-decomposition-index]
created_at: 2026-06-11T13:42:00Z
updated_at: 2026-06-11T13:42:00Z
---

# Fully-linear WI dependency chain amplifies single crash to total failure

## Observation

In Run 1 (2026-06-08) of `INIT-2026-06-08-release-definition-environment-config-surface`, the PM emitted 5 WIs in a fully sequential chain: WI-1 → WI-2 → WI-3 → WI-4 → WI-5. WI-1 agent crashed twice (`Claude Code process exited with code 1`, attempts 1+2 at 12:08:42 and 12:08:55). With `max_retries=2` exhausted, `ralph.end status=failed`. All 4 downstream WIs logged `ralph.skipped reason=prerequisite-failed`. Cycle terminated with `developer-loop: 0/5 work items completed — total failure`.

On resume (Run 2, 2026-06-11), PM re-decomposed to 2 WIs: WI-1 (schema + expand/flatten + 4 unit tests) + WI-2 (live acceptance). Both passed at iteration 1. Identical scope — different resilience.

## Why it matters

A fully sequential dependency chain concentrates all downstream risk on the first WI. When the first WI is implementation-heavy (multiple schema fields, nested expand/flatten, unit tests), crash probability rises and the blast radius is maximised. WI-2..WI-5 in Run 1 were largely orthogonal in content — they only depended on WI-1 because the PM over-granulated.

## Pattern

Prefer **fan-out-then-merge** over fully-linear chains when WIs are orthogonal in content. Reserve `depends_on` for genuine data dependencies, not just temporal ordering. For a 4-field implementation, two WIs (impl-all-fields + live-test) is usually correct; 5 sequential slices is over-granular.

## Operator confirmation

User feedback Q1: "The 2-WI re-decomposition was right; the original 5-WI chain was over-granular and fragile... a fully linear dependency chain concentrates all downstream risk on the first link."

## Sources

- `_logs/2026-06-08T12-01-16_INIT-2026-06-08-release-definition-environment-config-surface/events.jsonl` — events `dev-loop.agent-crash-retry` (12:08:42, 12:08:55), `ralph.end status=failed` (12:09:08), `error developer-loop: 0/5 work items completed — total failure` (12:09:10), `ralph.skipped` WI-2..WI-5 (12:09:10)
- `brain/cycles/_raw/2026-06-08T12-01-16_INIT-2026-06-08-release-definition-environment-config-surface.md`
