/**
 * DERIVING a wait bound from what the story funds — `forge-8vfn.7.6.118`,
 * T1 ruling 1089, §15.559.
 *
 * §15.559'S SENTENCE: **S10 beat 8's window funded 25% less than the cycle it
 * was watching.** Run 17 measured the cycle at $3.99 over 476 s; the beat's
 * declared 360000 ms afforded $3.02, and the cycle finished 116 seconds after
 * the beat gave up with `expected "ready-for-review", got "in-flight"`. The
 * product had succeeded. The number was chosen when no S10 run had ever
 * completed a cycle, so it was derived from nothing — the third distinct
 * beat-8 blocker in three runs, after the ADR 037 quarantine and the unwired
 * wait anchor.
 *
 * WHY A BIGGER LITERAL IS NOT THE REPAIR. A cycle entitled to its own declared
 * budget and iteration count may legitimately run longer than any figure picked
 * in advance, so the next literal buys the fourth blocker at the same beat.
 * What bounds the wait honestly is the MONEY: a cycle cannot outlive the funds
 * the story gave it.
 *
 * WHAT THIS IS UNDER RULING 1089(c), AND WHAT IT IS NOT. The wait now ENDS on
 * the cycle's own terminal event (`makeCycleTerminalDoor`), so this bound
 * decides nothing for a healthy cycle — it is the OUTER BACKSTOP for a cycle
 * that never terminates at all, with the channel door still redding a dead one
 * at the stall ceiling long before it. It is deliberately generous for that
 * reason, and generosity is only safe BECAUSE the terminal read is the real
 * exit.
 *
 * THE CLAMP IS NEVER HIDDEN. $35 derives 69.6 minutes and `MAX_DECLARED_WAIT_MS`
 * is 30, so the cap binds. A silent `Math.min` would "read as protection and
 * provide none" — story-file.mjs:308's own words about a bound that can never
 * fire — so both figures travel in the label and the label names WHICH
 * constraint bound it. If a cycle ever legitimately needs past 30 minutes, the
 * follow-up is raising that cap with A's and D's stories in the room, not
 * quietly widening this.
 *
 * THE RATE IS CARRIED AS ITS TWO MEASUREMENTS, not as a derived constant, so
 * the next run that measures a different burn amends an observation rather than
 * tuning a magic number.
 */
import { MAX_DECLARED_WAIT_MS } from './story-file.mjs';

/** Run 17's cycle: $3.99 spent (`report.md` total cost). */
export const MEASURED_CYCLE_USD = 3.99;
/** Run 17's cycle: 7m 56s wall clock (`report.md` duration), in ms. */
export const MEASURED_CYCLE_MS = 476_000;

/**
 * @param {{budget_usd?: number}} ground the story's own `ground` block
 * @returns {{ms: number, derivedMs: number, capMs: number, boundBy: string, label: string}}
 */
export function deriveWaitBoundMs(ground) {
  if (ground === null || typeof ground !== 'object') {
    throw new TypeError('deriveWaitBoundMs: expected the story\'s ground object');
  }
  const funded = ground.budget_usd;
  // An ABSENT budget is not a zero one (§15.504). Defaulting here would produce
  // a confident bound out of a ground that declared no funding at all.
  if (typeof funded !== 'number' || !Number.isFinite(funded) || funded <= 0) {
    throw new TypeError(
      `deriveWaitBoundMs: ground.budget_usd must be a finite number > 0 to derive a bound from, got ${JSON.stringify(funded)}`,
    );
  }
  const msPerUsd = MEASURED_CYCLE_MS / MEASURED_CYCLE_USD;
  // Rounded to an integer because `upTo` is validated as one; floored at 1 so a
  // vanishingly small budget still yields a parseable story rather than a zero.
  const derivedMs = Math.max(1, Math.round(funded * msPerUsd));
  const capped = derivedMs > MAX_DECLARED_WAIT_MS;
  const ms = capped ? MAX_DECLARED_WAIT_MS : derivedMs;
  const perMin = (MEASURED_CYCLE_USD / MEASURED_CYCLE_MS) * 60_000;
  const basis =
    `ground.budget_usd $${funded} at the measured $${perMin.toFixed(4)}/min would afford ${derivedMs} ms`;
  return Object.freeze({
    ms,
    derivedMs,
    capMs: MAX_DECLARED_WAIT_MS,
    boundBy: capped ? 'MAX_DECLARED_WAIT_MS' : 'ground.budget_usd',
    label: capped
      ? `MAX_DECLARED_WAIT_MS binding at ${MAX_DECLARED_WAIT_MS} ms; ${basis}`
      : `derived from ${basis}`,
  });
}
