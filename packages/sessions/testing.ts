/**
 * `@forge/sessions/testing` — the test-only subpath (bead forge-8vfn.5.31).
 *
 * Every symbol here has no production consumer outside this package today —
 * only test files reach for them. Folding them into the main door
 * (`index.ts`) would widen the package's PRODUCTION public API on the
 * strength of a test's convenience; a dedicated subpath keeps the
 * distinction the brief asks for.
 */
export { stubArchitectManifestPorts } from './tests/architect-ports-stub.ts';
export {
  COMPLETENESS_CRITIC_MODEL,
  completenessCriticAgentSpec,
  CRITIC_MAX_TOTAL_PROMPT_CHARS,
} from './kinds/architect-critic.ts';
export { emitTurnCostRow, emitTurnEndedUnpricedRow, EMIT_FAILED_STDERR_MARKER } from './turn-cost-rows.ts';
