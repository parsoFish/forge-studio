---
title: Eval-driven development — every change shows a benchmark delta
description: >-
  If a change can't move a benchmark, you don't know if it helped. Per-phase
  benchmarks + per-PR delta + reflection-discovered failures become new cases.
category: pattern
keywords:
  - eval-driven
  - edd
  - benchmarks
  - score-delta
  - regression
  - reflection
  - fixtures
created_at: 2026-05-04T18:00:00.000Z
updated_at: 2026-05-04T18:00:00.000Z
related_themes:
  - phase-isolation-benchmarks
  - tdd-with-agents
  - brain-gap-feedback-loop
---

# Eval-driven development — every change shows a benchmark delta

If a change can't move a benchmark, you don't know if it helped. Eval-driven development is the discipline of attaching a measurable score-delta to every change.

Practice:

- **Every phase has a benchmark suite** (`benchmarks/<phase>/`). Wired-but-empty is fine; populate as the phase is built.
- **Every PR shows the delta.** Before / after score on the affected phase's benchmark. If the score didn't move, the change is decorative.
- **Reflection-discovered failures become new cases.** When a cycle goes sideways, the failure mode is fixed *and* a fixture is added so future changes can't regress.
- **Drift from real-world is mitigated by occasional full-cycle runs.** Phase benchmarks measure phase behaviour; full cycles measure system behaviour. Both are needed.

The discipline reduces "did this help?" to "did the score go up?". The conversation around a PR shifts from prose argument to fixture inspection.

This is the practitioner-version of forge's principle 3 (phase isolation with fast feedback) — they're the same idea seen from different angles.

## Sources

- [`agentic-engineering-best-practices.chat.md`](../../_raw/web/agentic-engineering-best-practices.chat.md) — synthesis section 4.
- [`adr-005-phase-isolation.docs.md`](../../_raw/docs/adr-005-phase-isolation.docs.md) — codified locally.

## See also

- [[phase-isolation-benchmarks]] — forge's instantiation.
- [[tdd-with-agents]] — sister discipline (test-vs-benchmark).
- [[brain-gap-feedback-loop]] — the brain version.
