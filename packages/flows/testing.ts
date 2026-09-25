/**
 * `@forge/flows/testing` — the test-only subpath (bead forge-8vfn.5.31).
 *
 * `hasMergeGateConfigErrorMarker` and `mergeGateConfigErrorPath` have no
 * production consumer outside this package today — only
 * `apps/forge/tests/integration/cycle-helpers.merge-gate-config.test.ts`
 * reaches for them. Folding them into the main door (`index.ts`) would widen
 * the package's PRODUCTION public API on the strength of a test's
 * convenience; a dedicated subpath keeps the distinction the brief asks for.
 */
export { hasMergeGateConfigErrorMarker, mergeGateConfigErrorPath } from './fix-work-items.ts';
export { CostTracker } from './flow-budgets.ts';
export { validateCompiledWorkItemSet } from './phases/wi-spec-compile.ts';
