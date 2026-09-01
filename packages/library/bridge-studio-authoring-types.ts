/**
 * Shared contract types/constants for the studio-authoring finalize route.
 * Split out of `bridge-studio-authoring.ts` (M4-library PR 4b). No imports —
 * this is the DAG's base node: the skill/hook/template install-strategy
 * files and the retained route file all import from here, never the
 * reverse.
 */

/** The dedicated, non-scanned landing root `runInteractiveTurn`'s
 *  `copyStagingToLibrary` finalizer writes into (`orchestrator/
 *  interactive-runner.ts`'s own `INTERACTIVE_LIBRARY_DIRNAME` constant,
 *  mirrored here since that one is module-private). */
export const INTERACTIVE_LIBRARY_DIRNAME = '_interactive-library';

// ---------------------------------------------------------------------------
// Finding 1/2 fix — the two install-step functions below return an OUTCOME
// instead of writing the HTTP response themselves. `runFinalize` is the ONE
// place that decides what a failed outcome means (revert phase:'committing'
// back to "awaiting-review", THEN respond) so every failure path — a bad
// package, a hook validation refusal, or an id collision — reverts
// identically, never a bespoke per-branch call.
// ---------------------------------------------------------------------------

export type InstallOutcome = { ok: true } | { ok: false; status: number; error: string };
