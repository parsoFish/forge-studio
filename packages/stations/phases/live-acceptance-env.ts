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

const INLINE_PROGRAM_FLAGS: ReadonlySet<string> = new Set(['-c', '-e', '--eval']);

/**
 * The same decision for a per-AC check (D-20, forge-mfv5.1.44), read from its arguments, never from the
 * text of an inline program (the operand of `-c`/`-e`/`--eval`): gitweave I3b WI-15's AC3 guard named
 * `tests/acceptance` inside its `python3 -c` program, was classed as the live suite, and its exit 0 was
 * refused for carrying no runner summary. The result is the check's inherited `requiresEnv` AND its acceptance class.
 */
export function liveAcceptanceEnvForCheck(accGate: AcceptanceGateConfig | undefined, argv: readonly string[]): string[] | undefined {
  return liveAcceptanceEnvFor(accGate, argv.filter((_, i) => i === 0 || !INLINE_PROGRAM_FLAGS.has(argv[i - 1]!)));
}
