/**
 * `@forge/stations/testing` — the test-only subpath (bead forge-8vfn.5.31).
 *
 * Every symbol here has no production consumer outside this package today —
 * only `apps/forge` and `packages/flows` tests reach for them (the
 * production seams, `apps/forge/factory-wiring.ts` and
 * `apps/forge/factory-cli-wiring.ts`, use a smaller, different set — see
 * `README.md` and `index.ts`). Folding them into the main door would widen
 * the package's PRODUCTION public API on the strength of a test's
 * convenience; a dedicated subpath keeps the distinction the brief asks for.
 */
export { settleWiOutcome, assertOutcomesSettled, type WiOutcome } from './phases/developer-loop.ts';
export { runProjectManager, type PmQueryFn } from './phases/project-manager.ts';
export { type NodeExecutor, integrateDeliveryFailure } from './phases/executor-table.ts';
export { deriveDemoModel } from './phases/derive-demo-model.ts';
