import { basename } from 'node:path';

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

/** A non-shell interpreter (a shell's `-c` operand is a command line and stays readable) and its inline-program flags. */
const INTERPRETER = /^(?:python[\d.]*|node|nodejs|ruby|perl|php)$/;
const INLINE_FLAG = /^(?:-[A-Za-z]*[ceEp]|--eval|--print)$/;
const INLINE_JOINED = /^--(?:eval|print)=/;

/**
 * The same decision for a per-AC check (D-20, forge-mfv5.1.44): when the check runs an interpreter, the
 * text of its inline program (`python3 -c`, `node -e`/`--eval`) is code, not the suite the command
 * targets, so it is not matched. gitweave I3b WI-15's AC3 guard named `tests/acceptance` inside its
 * `python3 -c` program, was classed as the live suite, and its exit 0 was refused for carrying no runner
 * summary. The result is the check's inherited `requiresEnv` AND its acceptance class.
 */
export function liveAcceptanceEnvForCheck(accGate: AcceptanceGateConfig | undefined, argv: readonly string[]): string[] | undefined {
  if (!INTERPRETER.test(basename(argv[0] ?? ''))) return liveAcceptanceEnvFor(accGate, argv);
  return liveAcceptanceEnvFor(accGate, argv.filter((t, i) => i === 0 || (!INLINE_JOINED.test(t) && !INLINE_FLAG.test(argv[i - 1]!))));
}
