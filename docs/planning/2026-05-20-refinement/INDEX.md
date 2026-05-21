---
batch: 2026-05-20-refinement
date_drafted: 2026-05-20
date_councilled: 2026-05-21
date_contracts_locked: 2026-05-21
plans: 8                       # 7 → 8 after plan 07 split into 07a+07b per C18d
councils: 7                    # combined 07 council kept; covers both halves
contracts: 19
---

# Forge holistic refinement — 2026-05-20 batch

Refinement plans drafted by parallel planning agents, each councilled by
the 4-critic chain (CEO / engineering / design / DX), then synthesised
into a stage-by-stage execution plan with contract decisions ratified
by the operator.

## Start here

1. **[CONTRACTS.md](./CONTRACTS.md)** — the 19 ratified cross-plan
   contracts (C1–C19). Source of truth. Where any plan and CONTRACTS.md
   disagree, CONTRACTS.md wins.
2. **[EXECUTION-PLAN.md](./EXECUTION-PLAN.md)** — the stage-by-stage
   execution doc. S0 (this contract lock) → S7 (logging UX). Daily-driver.
3. Each plan + its council review below.

## Plans

| # | Area | Plan | Council | Flags | Esc. | Ships in stage |
|---|---|---|---|---|---|---|
| 01 | Brain | [01-brain.md](./01-brain.md) | [01-brain.council.md](./01-brain.council.md) | 7 | 4 | 01a → S1.2 / 01b → S5 (split per C18a) |
| 02 | Architect | [02-architect.md](./02-architect.md) | [02-architect.council.md](./02-architect.council.md) | 4 | 4 | S2A then S2B (split per C18b) |
| 03 | Project Manager | [03-project-manager.md](./03-project-manager.md) | [03-project-manager.council.md](./03-project-manager.council.md) | 6 | 4 | S3 |
| 04 | Dev-loop | [04-dev-loop.md](./04-dev-loop.md) | [04-dev-loop.council.md](./04-dev-loop.council.md) | 9 | 5 | S1.3 (`assertLocalRemoteSynced` pre-cursor) + S4 (unifier, atomic with 05) |
| 05 | Review | [05-review.md](./05-review.md) | [05-review.council.md](./05-review.council.md) | 7 | 3 | S4 (atomic with 04) |
| 06 | Reflect | [06-reflect.md](./06-reflect.md) | [06-reflect.council.md](./06-reflect.council.md) | 6 | 3 | S6A then S6B (split per C18c) |
| 07a | Logging UX | [07a-logging-ux.md](./07a-logging-ux.md) | [07-general-logging-ids.council.md](./07-general-logging-ids.council.md) (combined) | covered | covered | S7 |
| 07b | Init IDs | [07b-init-ids.md](./07b-init-ids.md) | [07-general-logging-ids.council.md](./07-general-logging-ids.council.md) (combined) | covered | covered | S1.1 |

**Totals:** 48 mechanical flags + 27 operator-taste escalations across
the batch. All councils ground claims in cited paths.

## Master execution plan

**The orchestrating doc is [EXECUTION-PLAN.md](./EXECUTION-PLAN.md)** —
it catalogues all 28 cross-plan inconsistencies the councils surfaced,
folds them into 19 contract decisions ([CONTRACTS.md](./CONTRACTS.md))
the operator has ratified, and lays out the 8-stage execution order
(S0 contract lock → S1 foundations parallel → S2 architect →
S3 PM → S4 dev-loop+review atomic → S5 brain bench → S6 reflect →
S7 logging). Use it as the daily-driver.

## Cross-plan dependency map (after contract lock)

```
07b (IDs, S1.1)
   ↓ (slash commands across all plans benefit from friendly handles)
02 (architect, S2A→S2B) ──┐
                           ├──→ 03 (PM contract, S3) ──→ 04 (dev-loop, S4) ─┐
                           │                                                 │ (atomic)
                           │                                          05 (review, S4)
                           ↓                                                 ↓
                       01a (brain hygiene, S1.2)         01b (bench growth, S5) ← 06 (reflect, S6)

07a (logging, S7) — orthogonal; ships after S4 lands the unifier's new
                    phase events so the pretty-printer's colour map can
                    be finalised.
```

## Status

- **S0 contract lock** in flight (this branch — `docs/planning-s0-contract-lock`).
- **S1 foundations** unblocked once S0 merges.

## Known issues with the batch itself (resolved into stages)

- **`scripts/council-refinement-plans.ts` failed end-to-end** (I-23) →
  bundled into S2A (architect refinement) as the council infrastructure
  robustness fix.
- **Cross-plan artefact-name drift** (`pr-feedback.md`, `.forge/project.json`,
  `user-feedback.md`, etc.) → resolved by C1–C19 in
  [CONTRACTS.md](./CONTRACTS.md). All plans updated to reference the
  locked names.

## How to pick a stage up (post-S0)

1. Open [EXECUTION-PLAN.md](./EXECUTION-PLAN.md) and find the next stage.
2. Confirm the previous stage's **join step** verifies (acceptance
   criteria met in code).
3. Run `/forge-architect forge` with the stage's brief copy-pasted as
   the user prompt.
4. Let the cycle run.
5. Don't skip the join step — the council found at least one hard
   coupling per pair of adjacent stages.

> If, mid-stage, you find a need to change a C-decision, **stop the
> stage** and follow CONTRACTS.md §"Change control".
