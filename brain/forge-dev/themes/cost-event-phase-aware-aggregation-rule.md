---
title: Cost aggregation from events.jsonl must be phase-aware
description: Iteration-loop phases emit overlapping cost-bearing events (per-iteration, per-WI-end, phase-rollup); naive summation double/triple-counts. New cost tooling must reuse the phase-aware rule, not re-derive it.
category: reference
keywords: [cost-aggregation, events.jsonl, double-counting, metrics, run-model-derive, phase-rollup, iteration-events, cost-instrumentation]
created_at: 2026-07-13
updated_at: 2026-07-13
related_themes: [jsonl-event-log, holistic-metrics-onboarding]
---

# Cost aggregation from events.jsonl must be phase-aware

- **Evidence**: betterado 2026-07 cost-autopsy (git history). `cli/metrics.ts::aggregate()` is the one correct implementation; `per_skill` and `orchestrator/run-model-derive.ts::buildNodeMeta()` both summed unconditionally and inflated dev-loop/unifier cost 2–3× (they feed Studio's `data-phase-cost-usd` badges) — fixed 2026-07-11.

For a phase with an internal iteration loop (developer-loop, unifier), iteration
events, per-WI-end events, and phase-rollup-end events can each carry `cost_usd`
for **overlapping** spend. Summing every event for the phase double- or
triple-counts. The single correct rule: **if the phase emits `iteration`-typed
events, sum only those; otherwise sum all events for that phase.**

This trap isn't visible from the event schema alone — the same bug recurred
independently in two places that both fed user-visible cost figures. Treat the
phase-aware rule as a named invariant any new cost tooling checks against, not
something to re-derive per implementation.

Separately: the **architect phase logs `cost_usd: 0` on every completion event** —
architect spend is real but structurally invisible in the log, so any cost-based
decision (ceilings, waste analysis) undercounts the architect by construction.

## See also

- [[jsonl-event-log]] — the event-log contract this rule reads.
- [[holistic-metrics-onboarding]] — how forge onboards run-level metrics.
