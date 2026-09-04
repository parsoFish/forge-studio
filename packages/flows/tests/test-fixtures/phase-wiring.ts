/**
 * A `PhaseWiring` for tests that never reach a phase.
 *
 * `runCycle` and `drainPendingFixWorkItems` require the installed factory's
 * wiring (ADR 048) — flows declares the ports and imports no factory. Most tests
 * here inject `runDrainCycle` or stop before the flow walk, so the wiring is
 * present only to satisfy the contract.
 *
 * Every member THROWS rather than returning a benign value. A no-op stub would
 * let a test that accidentally reaches the real path pass while executing
 * nothing, which is the failure this whole file exists to avoid: a test that
 * would look identical had the wiring never been threaded.
 */
import type { PhaseWiring } from '../../phase-wiring.ts';

const unreached = (name: string) => (): never => {
  throw new Error(`PhaseWiring.${name} was called in a test that declared it unreachable`);
};

export const UNREACHED_PHASE_WIRING: PhaseWiring = {
  executor: { run: unreached('executor.run') },
  projectGate: unreached('projectGate') as unknown as PhaseWiring['projectGate'],
  runClosure: unreached('runClosure') as unknown as PhaseWiring['runClosure'],
  runReflector: unreached('runReflector') as unknown as PhaseWiring['runReflector'],
};

/** The reflector alone, for `FinalizeDeps` in a test that never reaches reflection. */
export const UNREACHED_RUN_REFLECTOR: PhaseWiring['runReflector'] = unreached('runReflector');
