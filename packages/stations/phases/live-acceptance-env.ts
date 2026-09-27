import type { AcceptanceGateConfig } from '@forge/projects';

import type { GateProfile } from '../class-profile-port.ts';

/**
 * The live-acceptance env guard's one decision (ADR 051 decision 2 as amended,
 * bead forge-mfv5.3.5). When the initiative's class `requires` the tier and
 * this WI's gate targets the project's live-acceptance suite (its `match`),
 * the gate must run with the tier's `requiresEnv` set — else the runner SKIPS
 * and the gate false-passes (the daemon ran betterado cycles without TF_ACC
 * and shipped unverified resources). The returned names are handed to the
 * gate, which ERRORS when one is unset. An `advisory` class (docs) is not
 * forced: the tier may still run, without the demand. `undefined` = no demand.
 */
export function liveAcceptanceEnvFor(
  accGate: AcceptanceGateConfig | undefined,
  acceptance: GateProfile['acceptance'],
  gateCmd: readonly string[],
): string[] | undefined {
  if (acceptance !== 'required' || !accGate?.requires_env || accGate.requires_env.length === 0) return undefined;
  return gateCmd.some((tok) => tok.includes(accGate.match)) ? accGate.requires_env : undefined;
}
