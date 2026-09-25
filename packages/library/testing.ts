/**
 * `@forge/library/testing` — the test-only subpath (bead forge-8vfn.5.31).
 *
 * Every symbol here has no production consumer outside this package today —
 * only test files reach for them. Folding them into the main door
 * (`index.ts`) would widen the package's PRODUCTION public API on the
 * strength of a test's convenience; a dedicated subpath keeps the
 * distinction the brief asks for: a deep `.ts` path a test happened to reach
 * for is still visible and named here, not silently re-legalised by a
 * wildcard `./*`.
 */
export { installSkillPackage, approveSkillDraft } from './studio/skill-install.ts';
export { validateCatalog } from './studio/library-validate.ts';
export type { ComposableKind } from './studio/agent-facts.ts';
export { fixtureFlowSource } from './tests/test-fixtures/flow-fixture.ts';
export { loadDemoElement, loadInstructionSeed } from './studio/artifact-registry.ts';
export {
  loadCommunityRegistry,
  serializeCommunityRegistry,
  resolveCommunitySource,
  communityRegistryPath,
  COMMUNITY_REGISTRY_SCHEMA_VERSION,
} from './studio/community-registry.ts';
