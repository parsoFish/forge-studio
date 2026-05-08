---
source_type: docs
source_url: docs/decisions/005-phase-isolation-with-benchmarks.md
source_title: ADR 005 — Phase isolation with per-phase benchmarks
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 1)
cycle_id: pass-a-bootstrap
---

# ADR 005 — Phase isolation with per-phase benchmarks

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

User principle 3: each phase should have clear success signals. Without them, every change is judged by running a full cycle — slow, expensive, noisy. V1's eval harness was scoped to overall agent behaviour rather than per-phase improvement.

## Decision

Every phase has a benchmark suite at `benchmarks/<phase>/` exposing:

- `<phase>/README.md` — input format, scoring metric, how to add cases.
- `<phase>/score.ts` — runs the suite end-to-end against the current state of the phase's skill(s) and emits a JSON score.
- `<phase>/<cases>/` — input fixtures + expected outputs.

`npm run bench:<phase>` runs the suite. CI can run all suites; sessions run only the phase they're working on. The phase docs in `docs/phases/<phase>.md` each name their benchmark contract. The scaffold ships the harness wired-but-empty; cases are added as each phase is built.

## Consequences

- Fast feedback per-phase. A change to the Architect skill can be benchmarked in seconds, not minutes.
- Cycle-over-cycle improvement is measurable.
- Reduces the "did this help?" debate to "did the score go up?".
- Trade-off: maintaining benchmark cases is real ongoing work. Mitigated by treating reflection-discovered failures as new benchmark cases. A phase's benchmark can drift from real-world performance — mitigated by occasional full-cycle runs.

## Alternatives considered

- Only end-to-end evals — slow and noisy.
- Manual qualitative judgment — doesn't scale with autonomy.
- A single shared eval harness across phases — couples phases that should be improvable independently.

## References

- v1's `src/eval/` Tier 1 + Tier 2 harness (Pass B will theme this)
- eval-driven development pattern (general agentic engineering practice)
