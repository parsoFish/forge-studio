---
title: Four-WI depends_on chain with TDD delivered in iteration 1 each
description: >-
  The compare-ref-analytics-delta initiative used a clean WI-1→WI-2→WI-3→WI-4
  dependency chain mirroring the natural build order; every WI completed in a
  single iteration with the gate expected-fail → implement → gate pass TDD rhythm.
category: pattern
keywords:
  - tdd
  - depends_on
  - single-iteration
  - pure-modules
  - quality-gate
related_themes: [2026-06-21-single-iteration-4wi-milestone-delivery, 2026-06-21-single-iteration-delivery-tdd-pure-modules, 2026-06-22-model-rendering-wi-split-overgranular]
created_at: 2026-06-22T00:00:00.000Z
updated_at: 2026-06-22T00:00:00.000Z
---

# Four-WI depends_on chain delivered in iteration 1 each

## Pattern

The initiative decomposed as:
- WI-1: pure delta model (`src/compare.ts:computeDelta`) — no dependencies
- WI-2: delta rendering (`src/format.ts:renderDelta`, `serializeDelta`) — depends WI-1
- WI-3: CLI wiring (`src/cli.ts:--compare`) — depends WI-1, WI-2
- WI-4: acceptance fixture extension with two git tags — depends WI-1, WI-2, WI-3

Each WI followed the exact TDD rhythm:
1. Gate expected-fail (`gate.expected-fail` event with `expected_fail: true`)
2. Write implementation + test file
3. Run gate → `gate.pass` event
4. Commit, push, start next WI

No WI needed a second iteration. Zero wedge events, zero send-back rounds.

## Why it worked

- ACs were written as Given-When-Then with exact sentinel values (non-default counts), making the gate command unambiguous.
- WI-1 was pure (no I/O), so it could be implemented and tested in complete isolation before any CLI wiring.
- The `depends_on` chain serialised the WIs into the only correct order, preventing hidden coupling violations.

## Sources

- `_logs/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta/events.jsonl` — `gate.expected-fail` at WI-1 iter 0, `gate.pass` at WI-1 iter 1; same pattern for WI-2, WI-3, WI-4
- `/home/parso/forge/brain/cycles/_raw/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta.md`

## See also

- [[2026-06-21-single-iteration-4wi-milestone-delivery]] — same single-iteration 4-WI TDD rhythm
- [[2026-06-21-single-iteration-delivery-tdd-pure-modules]] — sibling single-iteration TDD delivery
- [[2026-06-22-model-rendering-wi-split-overgranular]] — the over-granular critique of this decomposition
