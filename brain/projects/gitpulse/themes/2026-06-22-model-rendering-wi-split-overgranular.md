---
title: Splitting pure model and rendering into separate WIs is over-granular for small pure modules
description: >-
  Operator flagged the 4-WI decomposition (WI-1: compare.ts model, WI-2: format.ts
  rendering) as "too many" — WI-1 and WI-2 could have been one WI given the pure
  module is small (~50 LOC) and the renderer immediately depends on it.
category: antipattern
keywords:
  - decomposition
  - granularity
  - pure-module
  - model-rendering
  - wi-split
  - pm
related_themes: [2026-06-22-single-iteration-tdd-with-4-wi-chain, 2026-06-21-single-iteration-4wi-milestone-delivery]
created_at: 2026-06-22T00:00:00.000Z
updated_at: 2026-06-22T00:00:00.000Z
---

# Model + rendering WI split is over-granular for small pure modules

## Observation

The compare-ref-analytics-delta initiative split into 4 WIs:

- WI-1: `src/compare.ts:computeDelta` (pure delta model)
- WI-2: `src/format.ts:renderDelta`/`serializeDelta` (delta rendering) — depends WI-1
- WI-3: `src/cli.ts:--compare` wiring — depends WI-1, WI-2
- WI-4: acceptance fixture extension — depends WI-1, WI-2, WI-3

Operator feedback: **Too many** — WI-1 and WI-2 could have been merged.

## Why the split was unnecessary here

- `src/compare.ts` is ~50 LOC pure function + types. It has no own I/O, no own acceptance test.
- `renderDelta` in `src/format.ts` is its sole consumer (in this milestone).
- Both were implemented in iteration 1 each. Neither was complex enough to justify isolation — the only benefit was testability, but the unit tests for the model could have been written in the same WI as the rendering tests.
- Cost: 2 WI overhead sessions × ~$0.55 dev-loop cost each = ~$1.10 for a split that added no correctness value.

## Guidance for gitpulse

When a new pure module is ≤100 LOC and has exactly one consumer within the same initiative:
- Combine model + consumer rendering into one WI.
- Reserve the split for modules that will have multiple consumers or independent reuse across WIs.

Maintain the WI-3 (CLI wiring) and WI-4 (acceptance) as separate WIs — those have distinct acceptance gates and higher complexity.

## Sources

- `_logs/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta/user-feedback.md` — operator answer: "Too many — could have merged compare.ts + format additions into one WI"
- `/home/parso/forge/brain/cycles/_raw/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta.md`

## See also

- [[2026-06-22-single-iteration-tdd-with-4-wi-chain]] — critiques that same 4-WI decomposition as over-granular
- [[2026-06-21-single-iteration-4wi-milestone-delivery]] — the multi-WI delivery this granularity lesson bounds
