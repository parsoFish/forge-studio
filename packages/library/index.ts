/**
 * `@forge/library` — the public door. Skills, hooks, connections, templates,
 * instruction seeds and the community registry: author, scan, approve, list.
 *
 * WHY THIS FILE HAS CONTENT NOW. It was `export {}` by design, and its old
 * header was right to say so: the M2 skeleton created the package, and an index
 * re-exporting nothing was more honest than a placeholder export the boundary
 * lint could not see through. But exit row 5 asks `contract.test.ts` to assert
 * that the index exports exactly the README's API, and against an empty index
 * that assertion is `[] === []` — a contract every implementation satisfies,
 * which is the precise shape this campaign exists to remove. T1 ruling 31
 * settled it for every wave-1 lane: populate the index, let the README name it,
 * and require the test to FAIL against an empty one. It was proven failing
 * before this file was written.
 *
 * WHAT IS IN IT, AND HOW IT WAS CHOSEN. Not a guess, and not everything the
 * package exports — this is the set of symbols other packages, `apps/` and the
 * legacy tree ACTUALLY import today, measured across the repo rather than
 * curated by taste: 40 symbols reached through 20 module paths. A door derived
 * from real consumption cannot flatter itself; a hand-picked one always does.
 *
 * WHAT IS DELIBERATELY NOT IN IT. The route table's handlers, the per-kind
 * bridge modules, and the install/staging internals with no production
 * consumer outside this package — those stay behind the documented test-only
 * subpath (`@forge/library/testing`) instead of the main door, per bead
 * `forge-8vfn.5.31`. The lint PASSES themselves (`studio-lint-library-passes.ts`)
 * moved INTO the door in that same bead: `apps/forge/studio-lint.ts` is a real
 * production consumer, and "measured, not curated by taste" cuts the same way
 * whether the consumer is a package or the assembly.
 *
 * ONE DOOR, NOW. `package.json` maps only `"."` and `"./testing"` — a deep
 * path like `@forge/library/skill-path.ts` no longer resolves. Bead
 * `forge-8vfn.5.31` repointed every consumer; knowledge carried the same
 * residue and was collapsed in the same bead.
 */

// --- the skills tree --------------------------------------------------------
// Full-module `export *`, not a curated symbol list: `@forge/agents/skill-path.ts`
// re-exports this ENTIRE module (`export * from '@forge/library'`) as part of its
// own public door (agents/README.md's "skill packages" row), so a curated subset
// here would silently narrow what agents can re-export — M7-C OD found this the
// hard way when repointing agents' deep import broke `listSkillMdDirs` et al.
export * from './skill-path.ts';

// --- skill library: listing, trust, install ledger, package primitives -------
export { listPlainSkills } from './studio/skill-registry.ts';
export { listSkillLibrary, lintSkillRefs, lintSkillTrust } from './studio/skill-trust.ts';
export { removeInstallLedgerEntry } from './studio/skill-install-ledger.ts';
export { MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES, type PackageFile } from './studio/skill-package.ts';
export { lintSkillToolFence, lintStarterAgentToolFence } from './studio-lint-tool-fence.ts';

// --- hooks: definitions, composition, the approval ledger, the run primitive -
export {
  checkHookComposition,
  lintHookComposition,
  lintHookDefinitions,
  listHookIds,
  listHookLibrary,
  loadHookDefinition,
  parseHookMatcher,
  type HookLifecycleEvent,
  type HookMatcherParse,
  type HookPermissionManifest,
} from './studio/hook-library.ts';
export { approveHook, readHookApprovalLedger } from './studio/hook-approval-ledger.ts';
// The execution primitive stays HERE, not in `agents`: spec §0 names untrusted
// community-hook execution in `library` as the only future candidate for
// process isolation, and `agents` owns the per-spawn DISPATCH that calls this.
export {
  runHookScript,
  runHookScriptAsync,
  HookRunError,
  type HookRunFailureReason,
  type HookRunResult,
} from './studio/hook-runtime.ts';

// --- connections: the curated catalog, readiness, and the real probe ---------
export { connectionById, catalogConnectionById } from './studio/connection-library.ts';
export { connectionsReadinessFor, type UnreadyConnection } from './studio/connection-readiness.ts';
export { probeConnection, type ProbeResult } from './studio/connection-probe.ts';

// --- templates, demo elements, instruction seeds, the catalog ----------------
export { listDemoElements, listInstructionSeeds, loadArtifactTemplate, listArtifactTemplates } from './studio/artifact-registry.ts';
export { lintTemplateLibrary, type FlowSource } from './studio/template-library.ts';
export { loadCatalog } from './studio/catalog-registry.ts';
export {
  detectProjectTags,
  matchInstructionSeeds,
  renderSeedPromptSection,
  composedSeedsFooter,
  stripComposedSeedsFooter,
} from './instruction-seed-match.ts';
export {
  lintArtifactTemplates,
  lintDemoElements,
  lintInstructionSeeds,
  lintCatalogSection,
  lintCommunitySection,
} from './studio-lint-library-passes.ts';
export { validateLibraryFlag } from './studio/library-validate.ts';

// --- community: the registry, its index lint, and the CLI verb ---------------
export { communitySkillsFromRegistry } from './studio/community-registry.ts';
export { lintCommunityIndex } from './studio/community-index.ts';
export { cmdCommunity } from './community-refresh-cmd.ts';

// --- the HTTP surface: this package's routes, assembled by apps/forge --------
export { libraryRoutes, type LibraryRouteDeps } from './routes.ts';

// --- authoring: land a staged package into the library -----------------------
export { runFinalize } from './bridge-studio-authoring.ts';
export type { AuthoringSessionPort } from './studio/authoring-session.ts';

// --- agent-facing facts: what a composing agent's materials look like --------
export type { AgentFacts, ComposingAgent } from './studio/agent-facts.ts';
