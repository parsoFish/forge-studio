/**
 * dev-cost-bound.ts — the cycle's cost ceiling reaching INTO a work item's
 * Ralph loop, not just to the WI-to-WI dispatch boundary.
 *
 * Before this module, `developer-loop.ts` passed `Number.POSITIVE_INFINITY`
 * for both the per-WI Ralph's `initiativeBudget.usd` and the prompt's
 * displayed "cost budget remaining" — unconditionally, whether or not the
 * cycle actually had a ceiling configured. The comments at those sites cited
 * "CONTRACTS.md C19" as the reason; that document was deleted from the repo
 * 2026-06-07 (commit d5d947c3) and ADR 015 disclaims it, so the citation was
 * stale as well as the number being wrong. Measured consequence: a work item
 * declared at $12 spent $84 inside its own Ralph loop, because nothing
 * inside that loop could ever see the cycle running out of budget.
 *
 * This module supplies the real number (`resolveWiCostBudgetUsd`) and the
 * live, per-iteration predicate (`makeCostCeilingCheck`) that closes the
 * gap — both read the SAME `CostTracker` the flow runner already uses for
 * its WI-boundary check (`CycleInput.shouldStopBeforeWorkItem`) and its
 * node-boundary check (`CostTracker.checkCeiling`), via the sibling
 * `CycleInput.remainingCostBudgetUsd` accessor (flow-runner.ts). Never a
 * second copy of the cost rule.
 *
 * Kept out of `developer-loop.ts` itself (baselined at the 800-line hard cap
 * — `scripts/baselines/file-size.json`) per the roadmap's file-size ratchet.
 */

import type { CycleInput } from '@forge/flows/cycle-context.ts';
import type { LoopResult } from '@forge/agents';

/**
 * The real remaining cycle budget in USD, read live from
 * `CycleInput.remainingCostBudgetUsd`. `Infinity` only when the cycle
 * genuinely has no ceiling configured (the accessor is absent, or the
 * underlying tracker isn't enforcing) — a TRUE "no cap" reading, unlike the
 * `Number.POSITIVE_INFINITY` this replaces, which claimed "no cap"
 * regardless of whether a ceiling was actually set.
 *
 * Used both for the ONE-TIME figure stamped into a WI's PROMPT.md header
 * (a snapshot at that WI's start — see `renderDevUserPrompt`'s
 * `costBudgetUsd`) and as the starting `initiativeBudget.usd` handed to
 * `runRalph`, which feeds the runner's own static per-iteration
 * `cost-budget` stop condition (a same-WI backstop). Neither of those two
 * call sites re-reads this per iteration — that is what
 * `makeCostCeilingCheck` below is for.
 */
export function resolveWiCostBudgetUsd(input: CycleInput): number {
  return input.remainingCostBudgetUsd ? input.remainingCostBudgetUsd() : Infinity;
}

/**
 * Build the dynamic, per-iteration predicate `runRalph`
 * (`packages/agents/ralph/runner.ts`) consults via `LoopInput.costCeilingCheck`
 * — checked at the SAME point as `gateErrored`/`loopCapExhausted`: after the
 * current iteration's gate result is in, BEFORE the next agent invocation
 * starts. Re-reads `input.remainingCostBudgetUsd()` on every call (never
 * memoized), so a SIBLING work item's concurrent spend against the shared
 * cycle ceiling — not just this WI's own accumulated cost — can trip it
 * (AC4: two work items each individually under budget can still jointly
 * cross the cycle ceiling under concurrent dispatch).
 *
 * Because the check runs BEFORE the next iteration starts, the halt lands at
 * the next iteration boundary, not mid-iteration and not only at the end of
 * the WI: at most the iteration already in flight when the ceiling was
 * crossed completes (AC1, AC2).
 */
export function makeCostCeilingCheck(input: CycleInput): () => boolean {
  return () => resolveWiCostBudgetUsd(input) <= 0;
}

/**
 * True iff this work item's Ralph loop stopped because the cost ceiling
 * fired — either the dynamic cross-WI predicate above, or the runner's own
 * static per-iteration `cost-budget` stop condition (now reachable because
 * `initiativeBudget.usd` carries a real number instead of Infinity). Both
 * surface through the SAME `stop_reason: 'cost-budget'` (existing
 * vocabulary, per AC3 — no new event name), so the caller does not need to
 * know which layer fired.
 *
 * `developer-loop.ts` uses this to shape the halted WI's outcome the same
 * resumable way it already shapes a WI-boundary cost skip
 * (`shouldStopBeforeWorkItem`): status `pending`, not `failed` — the halt is
 * an orchestrator decision, not a quality verdict on the WI's work, so a
 * later cycle with more budget (or a resume) can re-attempt it from
 * scratch rather than carrying a permanent failure.
 */
export function isCostCeilingHalt(result: LoopResult | null): boolean {
  return result?.stop_reason === 'cost-budget';
}
