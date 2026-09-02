/**
 * `@forge/knowledge` — the public door.
 *
 * WHY THIS FILE HAS CONTENT NOW. It was `export {}` by design: the M2 skeleton
 * created the package and an index re-exporting nothing was more honest than a
 * placeholder. But exit row 5 asks `contract.test.ts` to assert that
 * `Object.keys(await import('@forge/knowledge'))` equals the README's API list,
 * and against an empty index that assertion is `[] === []` — a contract whose
 * enforcer any implementation satisfies, which is the exact shape this campaign
 * exists to remove. T1 ruling 31 settled it for every wave-1 lane: populate the
 * index, let the README name it, and require the test to FAIL against an empty
 * one.
 *
 * WHAT IS IN IT, AND HOW IT WAS CHOSEN. Not a guess and not everything the
 * package exports: this is the set of symbols other packages ACTUALLY import
 * today, measured across the repo — 35 values and 7 types, reached through 13
 * distinct module paths. Every one of those deep imports still works
 * (`package.json` maps `"./*": "./*"`), so nothing is repointed and no importer
 * breaks. This file makes the public surface nameable in one place and gives
 * the contract test something real to hold.
 *
 * TWO DOORS, STATED. The index is the PUBLIC door; the `@forge/knowledge/<file>.ts`
 * paths are the legacy one. Collapsing to one door is bead `forge-8vfn.5.31`
 * and is deliberately NOT done here — it touches four other packages, which is
 * a cross-package change beyond a repoint.
 */

// --- brain paths: where a brain, a KB and a cycle archive live --------------
export {
  cycleArchivePath,
  cycleArchiveRelPath,
  cyclesRawDir,
  cyclesThemesDir,
  projectBrainDir,
  projectThemesDir,
  readArtifactRoot,
  resolveKbBrainDir,
} from './brain-paths.ts';

// --- the brain index --------------------------------------------------------
export { loadBrainIndex, regenerateBrainIndex } from './brain-index.ts';

// --- brain lint -------------------------------------------------------------
export { CHECK_NAMES, classify, classifyFinding, lintThemeFiles, runBrainLint } from './brain-lint.ts';
export type { Finding, RunBrainLintResult, Scope } from './brain-lint.ts';

// --- KB descriptors, sites and read policy ----------------------------------
export { loadKbDescriptor, serializeKbDescriptor } from './studio/kb-descriptor.ts';
export { projectKbBindings, unroutableKbReason } from './kb-sites.ts';
export type { UnroutableKb } from './kb-sites.ts';
export { kbReadPolicyViolation } from './kb-read-policy.ts';

// --- the KB surface ---------------------------------------------------------
export {
  KB_SEEDING_ANCHOR_PREFIX,
  approveKbCleanup,
  computeAgentCleanupFindings,
  loadKbDescriptors,
} from './bridge-studio-kbs.ts';
export { activeJobReason, deriveKbActiveJob } from './kb-job-state.ts';
export { runPostReflectionKbHealth } from './kb-health.ts';
export { guardAgentKbEdits, snapshotBrainTree } from './kb-drain-edit-soundness.ts';
export type { KbEditGateResult } from './kb-drain-edit-soundness.ts';

// --- project brain seeding --------------------------------------------------
export { checkProjectBrainSeedContainment, seedProjectBrain } from './project-brain-seed.ts';

// --- cycle retention --------------------------------------------------------
export { assignRetention, collectCitedBy, patchArchiveFrontmatter } from './cycle-retention.ts';
export type { RetentionTag, ThemeMeta } from './cycle-retention.ts';

// --- the HTTP route table ---------------------------------------------------
export { knowledgeRoutes } from './routes.ts';
