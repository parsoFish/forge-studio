/**
 * `@forge/agents/testing` — the test-only subpath (bead forge-8vfn.5.31).
 *
 * `studio/materials.ts`'s exports have no production consumer outside this
 * package today — only two `apps/forge` tests reach for them. Folding them
 * into the main door (`index.ts`) would widen the package's PRODUCTION public
 * API on the strength of a test's convenience; a dedicated subpath keeps the
 * distinction the brief asks for.
 */
export { MATERIAL_KINDS, MAX_MATERIALS_COUNT, MAX_MATERIAL_BYTES, MAX_MATERIALS_TOTAL_BYTES } from './studio/materials.ts';
export { DEFAULT_IDLE_DEADLINE_MS } from './stream-deadline.ts';
export { registeredSdkIds } from './_adapters/registry.ts';
export type { DispatchAgentRunOpts, DispatchAgentRunResult } from './agent-dispatch.ts';
