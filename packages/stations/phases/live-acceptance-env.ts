import type { AcceptanceGateConfig } from '@forge/projects';

/**
 * The live-acceptance env guard's one decision (D-34,
 * bead forge-mfv5.3.5). When this WI's gate targets the project's
 * live-acceptance suite (its `match`), the gate must run with the tier's
 * `requiresEnv` set — else the runner SKIPS and the gate false-passes (the
 * daemon ran betterado cycles without TF_ACC and shipped unverified
 * resources). The returned names are handed to the gate, which ERRORS when one
 * is unset. The guard deliberately takes NO change class: the class's
 * `acceptance` column decides only whether the project manager must plan a
 * live-acceptance work item, and a live gate that runs is guarded whatever the
 * class says, so a mis-declared `docs` class cannot turn the guard off.
 * `undefined` = no demand.
 */
export function liveAcceptanceEnvFor(
  accGate: AcceptanceGateConfig | undefined,
  gateCmd: readonly string[],
): string[] | undefined {
  if (!accGate?.requires_env || accGate.requires_env.length === 0) return undefined;
  return gateCmd.some((tok) => tok.includes(accGate.match)) ? accGate.requires_env : undefined;
}
