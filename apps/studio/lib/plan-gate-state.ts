/**
 * ArchitectPlanGate approval-reset logic, extracted pure so the critic-block
 * state transition is unit-testable (vitest) without mounting the component.
 *
 * Ruling 380 moved the completeness critic BEFORE the ask: it runs at the end
 * of the drafting turn, so it can no longer bounce a session from `finalizing`
 * back to `awaiting-verdict` behind an approval the operator already gave. What
 * survives here is the other half — findings can still be OUTSTANDING when the
 * operator is asked, at the critic's round ceiling — so the gate must render
 * them and stay approvable, and its React key must change when a re-drafted
 * plan lands a new critic result. The `approved` reset is kept for the same
 * reason it was written: a false "Approved — building it now" payoff must never
 * render next to an armed gate.
 */
import type { CompletenessCriticStatus } from './bridge-client';

/** True when the operator is being asked with critic findings OUTSTANDING —
 *  since ruling 380 that means the critic hit its round ceiling and the plan is
 *  put to the operator with the gaps shown, not that promotion was blocked. */
export function isCriticBlocked(
  phase: string,
  critic: CompletenessCriticStatus | null | undefined,
): boolean {
  return phase === 'awaiting-verdict' && (critic?.findings.length ?? 0) > 0;
}

/**
 * True when the gate's optimistic local `approved` flag must be cleared:
 *   - any working/terminal phase outside the gate + payoff set
 *     (send-back → redraft, rejected) — pre-existing behavior; `finalizing`
 *     and `committed` are the post-approve states and keep the payoff
 *     visible (W7-A3);
 *   - `awaiting-verdict` WITH outstanding findings (the ceiling case).
 */
export function shouldResetApproval(
  phase: string,
  critic: CompletenessCriticStatus | null | undefined,
): boolean {
  // W7-A3 (artifact-plan-10): `finalizing` is the POST-approve phase (approve
  // → finalizing → committed). Resetting on it blanked the payoff ~2s after a
  // successful 200 and re-armed a dead gate bar.
  if (phase !== 'awaiting-verdict' && phase !== 'finalizing' && phase !== 'committed') return true;
  return isCriticBlocked(phase, critic);
}

/** React key for the mounted PlanGate. Changes per revision round (existing
 *  behavior) AND when the critic result lands, so a gate already in its
 *  `submitted` state remounts fresh and the operator can re-approve. */
export function planGateKey(
  round: number,
  critic: CompletenessCriticStatus | null | undefined,
): string {
  return `plan-gate-r${round}-${critic?.ranAt ?? 'pre-critic'}`;
}
