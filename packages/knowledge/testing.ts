/**
 * `@forge/knowledge/testing` — the ONE test-only subpath (bead forge-8vfn.5.31).
 *
 * `resolveKbProcesses` has no production consumer outside this package today
 * — only `apps/forge/tests/unit/registry.test.ts` and
 * `apps/forge/tests/unit/studio-lint.test.ts` reach for it. Folding it into
 * the main door (`index.ts`) would widen the package's PRODUCTION public API
 * on the strength of a test's convenience; a dedicated subpath keeps the
 * distinction the brief asks for — a deep `.ts` path a test happened to reach
 * for is still visible and named here, not silently re-legalised by a
 * wildcard `./*`.
 */
export { resolveKbProcesses } from './studio/kb-descriptor.ts';
