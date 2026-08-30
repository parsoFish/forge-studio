/**
 * ArchitectPlanGate approval-reset logic, extracted pure so the critic-block
 * state transition is unit-testable (vitest) without mounting the component.
 *
 * The completeness critic (architect FINALIZE gate) can bounce a session
 * straight from `finalizing` back to `awaiting-verdict` — same round, findings
 * persisted on `status.completenessCritic`. The gate component's optimistic
 * `approved` flag must be cleared on that round-trip even when the poll never
 * observes the short-lived `finalizing` phase, otherwise a false
 * "Approved — building it now" payoff renders next to a re-armed gate.
 */
import type { CompletenessCriticStatus } from './bridge-client';

/** True when the session sits at the PLAN gate because the completeness critic
 *  blocked promotion with findings the operator has not yet re-approved. */
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
 *   - a critic block round-trip: back at `awaiting-verdict` WITH findings.
 */
export function shouldResetApproval(
  phase: string,
  critic: CompletenessCriticStatus | null | undefined,
): boolean {
  // W7-A3 (artifact-plan-10): `finalizing` is the POST-approve phase (approve
  // → finalizing → committed). Resetting on it blanked the payoff ~2s after a
  // successful 200 and re-armed a dead gate bar. The critic-block round-trip
  // (finalizing → awaiting-verdict WITH findings) is still caught below.
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
