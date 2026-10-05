# Post-1.0 — spend governance and the one brake

> **Status:** intent capture, not a plan. Written 2026-10-03 from operator ruling R4 (campaign handoff) so the idea survives the 1.0 tag. It carries no deadline, no milestone and no hard calls; the first session that picks it up turns it into initiatives under the roadmap that governs then. [`1.0.md`](./1.0.md) stays the only roadmap until the 1.0 tag.

## Why this exists

A factory built on forge picks up claimable work the moment it is claimable, `forge studio` starts and supervises `forge serve`, and the only way to stop the factory is **one emergency halt** — user-triggered, no new claims, active jobs run to completion, no progress lost. Four questions about stopping a factory are open on purpose. They are recorded here, in the operator's intent, so nobody re-derives them from scratch.

## (c) A user-settable global spend budget that pulls the brake

- One number the operator sets for the whole factory (not per initiative — initiative budgets size the planner and halt nothing, [SPEC §1](../../SPEC.md) lineage). When cumulative spend **approaches** it, the halt fires: no new claims, running jobs finish.
- "Approaches" means a threshold below the number, chosen from (e) below, so the drain itself does not overshoot the budget.
- The number is visible where spend is visible (the Studio cost surfaces already price every priced turn; unpriced turns carry their upper bound since row 193b).
- Open: whether the budget is per calendar window, per campaign, or lifetime; whether reaching it is an error state or a normal end.

## (d) A usage hook for personal plans

- Operators on a Max-style plan have session and weekly usage limits that the API does not expose as a budget. The intent: a hook that reads the plan's usage signal and halts at **95 %**, **conservative on burn rate** — if the current rate would cross the limit before the next check, halt early.
- The halt is the same brake as (c); this is a second trigger, not a second mechanism.
- Open: where the usage signal comes from (the CLI's own `rate_limit_event` stream was seen in row 193's capture; whether it is reliable enough to drive a brake is unmeasured).

## (e) Shutdown and drain-spend estimation

- Both triggers need to know what a halt costs: the spend between "no new claims" and "every active job finished". That is the drain cost, and the thresholds in (c) and (d) must sit above it.
- Intent: measure it from the event log of real runs (every turn is priced or bounded), keep a running estimate per agent kind, and base the "approaching" margin on the worst recent drain plus a factor the operator can see.
- Open: whether a job may be asked to stop at its next checkpoint rather than run to completion when the margin is thin.

## (f) CLI versus UI

- The operator's standing view: having both a UI and a CLI that can run all functionality is weight. Studio is the one product ([D-12](../../DECISIONS.md)); `forge serve` runs under Studio's supervision.
- Intent: a keep/remove inventory of every `forge` subcommand, each tagged with the Studio surface that replaces it or the reason it stays (operator-less environments, CI, the stranger's first run). Removal lands as its own initiative after the inventory is agreed.
- Open: which subcommands the stories and the stranger run still depend on.

## What is already decided (so this doc does not reopen it)

- One brake, user-triggered or budget-triggered. No automatic halt on any other system condition.
- Refusing a second start for a run id is pre-1.0 work and is not described here.
- The factory never pauses itself between gates its flow does not declare ([`CLAUDE.md`](../../CLAUDE.md), unattended operation).
