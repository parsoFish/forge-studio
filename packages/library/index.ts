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
 * bridge modules, the install/staging internals and the lint passes' private
 * helpers. They stay reachable — `package.json` maps `"./*": "./*"`, so every
 * existing deep import still resolves and nothing is repointed by this file —
 * but they are not part of the surface this package promises to keep. The
 * distinction is the point: an index that exported everything would document
 * nothing.
 *
 * TWO DOORS, STATED PLAINLY. This index is the PUBLIC door; the
 * `@forge/library/<file>.ts` paths are the legacy one, and today every consumer
 * uses the latter. Collapsing to one door means repointing four other packages
 * plus `cli/` and `orchestrator/`, which is a cross-package change beyond a
 * `repoint:` and is not taken here. Knowledge carries the same residue; this is
 * the same shape, recorded rather than quietly left.
 */

// --- the skills tree --------------------------------------------------------
export { skillPath } from './skill-path.ts';

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
export { runHookScript, HookRunError, type HookRunFailureReason } from './studio/hook-runtime.ts';

// --- connections: the curated catalog, readiness, and the real probe ---------
export { connectionById } from './studio/connection-library.ts';
export { connectionsReadinessFor, type UnreadyConnection } from './studio/connection-readiness.ts';
export { probeConnection, type ProbeResult } from './studio/connection-probe.ts';

// --- templates, demo elements, instruction seeds, the catalog ----------------
export { listDemoElements, listInstructionSeeds } from './studio/artifact-registry.ts';
export { lintTemplateLibrary } from './studio/template-library.ts';
export { loadCatalog } from './studio/catalog-registry.ts';

// --- community: the registry, its index lint, and the CLI verb ---------------
export { communitySkillsFromRegistry } from './studio/community-registry.ts';
export { lintCommunityIndex } from './studio/community-index.ts';
export { cmdCommunity } from './community-refresh-cmd.ts';

// --- the HTTP surface: this package's routes, assembled by apps/forge --------
export { libraryRoutes } from './routes.ts';

// --- authoring: land a staged package into the library -----------------------
export { runFinalize } from './bridge-studio-authoring.ts';
