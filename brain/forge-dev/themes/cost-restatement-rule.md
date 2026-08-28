---
title: Cost restatement — a streaming API restates cumulative dollars, so summing every event triple-counts
description: >-
  Agent SDK turns restate the same cumulative dollars on later events, so any
  totaller that sums every cost-bearing row over-reports. event-cost.ts holds
  the authoritative restatement rule; anything totalling spend adopts it rather
  than re-deriving one. The betterado docs run reported $80.83 against a real
  $30.19. The rule also has to be checked PER WORK ITEM, not only at phase
  boundaries, or one long dev-loop phase blows the ceiling before anything looks.
category: decision
keywords:
  - cost
  - cost-tracker
  - restatement
  - triple-count
  - event-cost
  - cost-ceiling
  - per-work-item
  - budget-enforcement
  - streaming-api
created_at: 2026-08-28
updated_at: 2026-08-28
related_themes:
  - cost-event-phase-aware-aggregation-rule
  - derived-never-stored-run-model
  - orchestrator-owned-execution-beats-heuristic-verification
---

# Cost restatement — sum the restatements and you triple-count

Agent SDK turns report **cumulative** cost: a turn emits its per-turn dollars on an `iteration` event, then later events **restate the same dollars**. `orchestrator/event-cost.ts` says so in its own header — "every other row restates dollars already counted". A totaller that naively sums every cost-bearing row therefore reports a multiple of the truth.

Measured: the betterado docs run (`_logs/2026-08-18T12-42-15_INIT-2026-08-14-betterado-gap-registry/`) reported **$80.83** against a real **$30.19** — a 2.7× over-report. An over-report is not a harmless conservatism: it trips the cost ceiling and parks a cycle that was well inside budget, which is how a run that should have merged instead stopped at "$80 / $52".

## The rule

1. **`event-cost.ts` is the single authoritative restatement rule.** Anything that totals spend — the tracker, a report, a UI tile, a harness assertion — **adopts it**. Nobody re-derives a second summation, because a second summation is a second thing to get wrong, and it will drift from the first silently (both look plausible; neither is checked against the other).
2. **Check the ceiling per work item, not only at phase boundaries.** A ceiling enforced only where phases hand off cannot see a single long phase overrunning inside itself: one dev-loop phase overshot its ceiling by **55%** and nothing looked until it was over. The check belongs where the spend accrues.

## Why this is a decision and not a bug fix

The naive summation is *locally* reasonable at every call site — that is exactly why it recurred. The durable fix is not "remember to subtract restatements" but **one owner of the rule that every consumer calls**, which is the same shape as [[derived-never-stored-run-model]]: derive the number from its source of truth and give no one a place to keep a private, staler copy.

## Sources

- `orchestrator/event-cost.ts` — the restatement rule, stated in the module header (lines 6, 15).
- Bead `forge-6gv.16` — "Cost ceiling is enforced only at phase boundaries — one dev-loop phase overshot it by 55%".
- `_logs/2026-08-18T12-42-15_INIT-2026-08-14-betterado-gap-registry/events.jsonl` — the run whose $30.19 was reported as $80.83.
- `docs/superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md` §5.7 — "`CostTracker` adopts the `event-cost.ts` restatement rule and checks per WI".

## See also

- [[cost-event-phase-aware-aggregation-rule]] — the phase-aware aggregation this rule composes with.
- [[derived-never-stored-run-model]] — the same constructive shape: derive, never store a copy.
