---
title: Reviewer wrote missing implementation files the dev loop did not produce
description: WI-3 (FEAT-2 batch.ts) ended with empty output_refs; the reviewer's second iteration created src/batch.ts and tests/batch.test.ts from scratch. Reviewer acting as implementer inflates review cost and masks dev-loop incompleteness.
category: antipattern
keywords: [reviewer, missing-files, output-refs, dev-loop, batch, implementation-gap, cost-inflation]
created_at: 2026-05-17T02:41:01Z
updated_at: 2026-05-17T02:41:01Z
related_themes: [quality-gates-orchestrator-verified, tdd-with-agents, review-fix-loop-spinning]
---

# Reviewer wrote missing implementation files the dev loop did not produce

## What happened

In cycle `chained-INIT-2025-05-17-slugifier-package-1778984667230`, WI-3 (FEAT-2: batch helpers in `src/batch.ts`) completed with `output_refs: []` — no files were tracked as written. The dev loop's quality gate passed (exit code 0), but `batch.ts` was absent from the project tree. The review loop's first iteration detected the missing file; iteration 2 wrote both `src/batch.ts` and `tests/batch.test.ts` from scratch, adding $0.61 in review cost for work that should have been dev-loop output.

## Why it matters

1. **Masked dev failure.** The quality gate passed despite `batch.ts` not existing, because the gate script (likely the smoke test in `tests/placeholder.test.ts`) did not import or exercise `batch.ts`. A passing gate + empty output_refs is a silent failure mode.
2. **Review cost inflation.** Reviewer iteration 2 cost $0.61 — the most expensive single iteration in the cycle — partly because it had to implement feature code, not just review it.
3. **Breaks phase separation.** The reviewer's job is holistic intent verification and PR preparation, not implementation. When it writes production code, phase separation collapses.

## Root cause hypothesis

WI-3's gate command (`npm test --silent`) ran the smoke test that only imports `src/slugify.ts`. Since `batch.ts` did not exist yet, and the test did not import it, the gate trivially passed. The agent may have committed only minimal changes or none at all.

## Pattern to prefer

- Dev loop exit gate for implementation WIs should verify that declared output files exist (non-empty `output_refs` check).
- Alternatively, the PM should ensure that the test WI for FEAT-2 imports `batch.ts` in the *test stub* so the smoke test would fail if `batch.ts` is absent.

## Sources

- `_logs/chained-INIT-2025-05-17-slugifier-package-1778984667230/events.jsonl` — event `EV_mp95t1ht_i10z6dmy` (WI-3 end, `output_refs: []`); event `EV_mp964bvx_vw3ut7je` (review iter 2, output_refs include `src/batch.ts` and `tests/batch.test.ts`)
- `/home/parso/forge/brain/_raw/cycles/chained-INIT-2025-05-17-slugifier-package-1778984667230.md`
