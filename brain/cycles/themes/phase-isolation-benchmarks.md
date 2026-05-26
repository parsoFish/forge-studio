---
title: Phase isolation with per-phase benchmarks
description: >-
  Every phase has benchmarks/<phase>/ with sample inputs → measurable outputs so
  improvement is provable per-phase without a full cycle.
category: pattern
keywords:
  - benchmarks
  - phase-isolation
  - eval-driven
  - fast-feedback
  - score
  - regression
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - eval-driven-development
  - six-phases-of-forge
---

# Phase isolation with per-phase benchmarks

User principle 3: each phase needs clear success signals so agents can prove their changes made meaningful impact. Forge codifies this with one benchmark suite per phase under `benchmarks/<phase>/`:

- `<phase>/README.md` — input format, scoring metric, how to add cases.
- `<phase>/score.ts` — runs the suite end-to-end against the current state of the phase's skill(s) and emits a JSON score.
- `<phase>/<cases>/` — input fixtures + expected outputs (format varies per phase).

`npm run bench:<phase>` runs the suite. CI runs all suites; sessions run only the phase they're working on. This lets a session focused on (say) the Architect prove the Architect got better without running a full cycle.

Trade-off: maintaining benchmark cases is real ongoing work. Mitigated by treating reflection-discovered failures as new benchmark cases. Phase benchmarks can drift from real-world performance — mitigated by occasional full-cycle runs.

## Sources

- [`adr-005-phase-isolation.docs.md`](../../_raw/docs/adr-005-phase-isolation.docs.md) — decision record.
- [`forge-v2-principles.docs.md`](../../_raw/docs/forge-v2-principles.docs.md) — principle 3.

## See also

- [[eval-driven-development]] — the broader pattern.
- [[six-phases-of-forge]] — the phases that get benchmarked.
