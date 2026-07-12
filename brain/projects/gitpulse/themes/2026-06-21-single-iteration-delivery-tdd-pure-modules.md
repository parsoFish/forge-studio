---
title: TDD + pure module pattern delivers 4/4 WIs in single iterations
description: >-
  The established gitpulse discipline (gate expected-fail → write pure module +
  tests → gate pass) produced zero-failure-iteration delivery across all 4 WIs
  in the ownership/hotspot initiative.
category: pattern
keywords:
  - tdd
  - pure-module
  - single-iteration
  - quality-gate
  - zero-wedge
related_themes: [2026-06-21-single-iteration-4wi-milestone-delivery, 2026-06-22-single-iteration-tdd-with-4-wi-chain, git-truth-and-pure-aggregation]
created_at: 2026-06-21T00:00:00.000Z
updated_at: 2026-06-21T00:00:00.000Z
---

# TDD + pure module pattern delivers 4/4 WIs in single iterations

## Pattern observed

All 4 WIs in the ownership-hotspots-top-flag initiative completed in exactly 1
iteration each:
- WI-1: `src/ownership.ts` + `test/ownership.test.ts` (5 ACs, 1 iter)
- WI-2: `src/hotspot.ts` + `test/hotspot.test.ts` (5 ACs, 1 iter)
- WI-3: `--top` flag + stats wiring + `test/cli-top.test.ts` (7 ACs, 1 iter)
- WI-4: `src/format.ts` ownership/hotspot tables + `test/format-new.test.ts` (6 ACs, 1 iter)

Zero wedge events, zero rate-limit hits, zero review send-backs. Unifier:
23/23 ACs met.

## Why it works

The gitpulse pattern (see `git-truth-and-pure-aggregation.md`) constrains each
new analytics feature to:
1. A pure function over `Commit[]` with no I/O.
2. A unit test file exercising that function against hand-built fixtures.
3. A CLI wire-up that feeds the function from the existing git-truth seam.
4. An optional read-back acceptance assertion.

With this shape, each WI has a clear pass/fail signal from the first test run.
The TDD loop (expected-fail gate → implement → gate pass) is short: typically
2-4 file writes + 1 test run. No ambiguity about what "done" means.

## When this breaks

- If a WI spans the git-truth seam AND a new parse format AND CLI output, it
  is more complex and may require multiple iterations.
- If the acceptance gate scope is too narrow (see
  `acceptance-gate-covers-only-headline-output.md`), a green gate does not imply
  correct end-to-end behavior.

## Sources

- `_logs/2026-06-21T04-52-20_INIT-2026-06-21-ownership-hotspots-top-flag/events.jsonl` — `ralph.end` events for WI-1 through WI-4, all with `iterations: 1` and `stop_reason: quality-gates-pass`.
- `/home/parso/forge/brain/cycles/_raw/2026-06-21T04-52-20_INIT-2026-06-21-ownership-hotspots-top-flag.md`

## See also

- [[2026-06-21-single-iteration-4wi-milestone-delivery]] — sibling single-iteration TDD delivery
- [[2026-06-22-single-iteration-tdd-with-4-wi-chain]] — same single-iteration 4-WI TDD rhythm
- [[git-truth-and-pure-aggregation]] — the pure-aggregation contract this pattern relies on
