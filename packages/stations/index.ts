/**
 * `@forge/stations` — the public door.
 *
 * Owns ONE seam: the station executor and every band it dispatches
 * (`createPhaseExecutor`, ADR 028) — the platform's execution machinery,
 * independent of any one factory's flows. `packages/factory` (the develop/plan
 * example) supplies the FlowDefs, the SKILL.mds, the artifact templates and the
 * class → gate-profile table; this package runs them. Deleting `packages/factory`
 * still leaves a station executor here that a second factory can run against
 * (operator ruling, items 81/83).
 *
 * This is the set `apps/forge` and `packages/factory` actually import from the
 * barrel — not every deep specifier the two packages reach for (those keep
 * working unchanged; `git grep '@forge/stations/'` finds them). `contract.test.ts`
 * reads the API list out of `README.md` at run time so the two cannot drift.
 */

// ---- The station executor (ADR 028) ----------------------------------------
export { createPhaseExecutor, registeredBandIds } from './phases/executor-table.ts';
export { createProjectGate, defaultRunClosure, type FlowRunnerDeps } from './phases/executor-deps.ts';

// ---- Bands the assembly binds statically (apps/forge/factory-wiring.ts) ----
export { runReflector } from './phases/reflector.ts';
export { runAdversarialReview } from './phases/adversarial-review.ts';
export { runReleaseFinalize } from './phases/release-finalize.ts';
export { reconcileReflectFeedback } from './reflect-reconcile.ts';
export { rerunReflector } from './reflector-rerun.ts';

// ---- The docs class's merge-boundary verb (apps/forge/factory-cli-wiring.ts, `forge gate docs`) ----
export { runDocsGate } from './gates/docs-gate.ts';
