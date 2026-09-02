/**
 * @forge/projects — the public door.
 *
 * Owns the **6 Project** seam. Its contract is `SPEC.md` §6; the test that
 * holds it is `contract.test.ts` in this directory.
 *
 * WHY THIS FILE HAS CONTENT NOW. Between the M2 skeleton (`export {}`,
 * honest about an empty package) and this PR it briefly re-exported only
 * `reset.ts`'s reset entry points — a side effect of landing the reset
 * feature, not the declared-door analysis T1 ruling 31 asks for. Written
 * literally against THAT state, `contract.test.ts`'s assertion would have
 * been `[] === []` once the README caught up to it — vacuously green, the
 * exact declared-data-fails-open shape this campaign exists to remove. The
 * ruling: populate the index from evidence, let the README name it, and
 * require the contract test to FAIL against an empty index.
 *
 * WHAT IS IN IT, AND HOW IT WAS CHOSEN. Not a guess and not everything the
 * package exports: this is the set of symbols other packages ACTUALLY
 * import today, measured across the repo — 30 values and 8 types, reached
 * through 16 distinct module paths. Every one of those deep imports still
 * works (`package.json` maps `"./*": "./*"`), so nothing is repointed and no
 * importer breaks. This file makes the public surface nameable in one place
 * and gives the contract test something real to hold.
 *
 * WHAT IS DELIBERATELY LEFT OFF. A module can be genuinely part of the
 * package's seam and still contribute nothing here, when every current
 * external caller uses a DIFFERENT symbol from the same module — see
 * `project-config.ts`'s `validateProjectConfig` sits in that spot next to the
 * evidenced `loadProjectConfig`.
 *
 * `reset.ts` is the ONE deliberate exception to evidence-today, and the
 * reason is recorded so it is not read as drift: `computeContractDrift`,
 * `applyContractReset` and `AppTypeUnresolvedError` are on the door although
 * only `cmdProjectReset` is deep-imported from outside the package right now.
 * The Studio "Rebuild contract" control's route is the consumer, it lands in
 * this same milestone, and #295's security review specifically required the
 * error class be reachable from the index — a route importing it from
 * `./reset.ts` instead would lose `instanceof` narrowing on the one error it
 * exists to render. Adding them later would flip this package's public door
 * twice for a consumer already scheduled. Full accounting in `design.md` and `README.md`'s
 * "What is not exported" section.
 *
 * TWO DOORS, STATED. The index is the PUBLIC door; the
 * `@forge/projects/<file>.ts` paths are the legacy one, kept working and not
 * recommended for new code. Collapsing to one door is follow-up work, not
 * done here — it touches every current importer, a repoint beyond this PR's
 * scope.
 */

// --- config: `.forge/project.json`, the agent-instruction file ------------
export { loadProjectConfig, readAgentInstructionsFile, resolveProjectIdForRepo } from './project-config.ts';
export type { ProjectConfig, AcceptanceGateConfig } from './project-config.ts';

// --- preflight: the C-clause verdict + the bounded auto-fix loop ----------
export {
  runPreflight,
  formatPreflightReport,
  buildVerdictEvent,
  SCRATCH_PATHS,
  SCAFFOLD_BUILD_OUTPUT_IGNORES,
} from './preflight.ts';
export type { ClauseId } from './preflight.ts';
export { runContractComplianceLoop, formatComplianceReport } from './contract-compliance-loop.ts';

// --- contract stages: the studio-facing per-project checklist -------------
export { deriveContractStages, resolveContainedProjectDir } from './contract-stages.ts';
export type { ContractStageRow, DeriveContractStagesResult } from './contract-stages.ts';

// --- create: greenfield scaffold -------------------------------------------
export { scaffoldGreenfieldProject, listProjectStarters, projectStartersDir } from './project-create.ts';
export type { ScaffoldResult } from './project-create.ts';

// --- repo transactions: the `forge-studio` branch write path --------------
export { ensureStudioBranch, commitStudioChange, withStudioWrite } from './project-repo-tx.ts';

// --- the reset: `forge project reset` / studio "Rebuild contract" ---------
export { cmdProjectReset, computeContractDrift, applyContractReset, AppTypeUnresolvedError } from './reset.ts';
export type { ContractSection, DriftAction, DriftRow, SkillMove, DriftReport, ResetResult } from './reset.ts';

// --- constraint blocks: bound-skill constraints, authored and applied -----
export { authorConstraintBlocks } from './constraint-author.ts';
export { loadProjectConstraintBlocks, selectorMatches } from './constraint-blocks.ts';
export type { ConstraintBlock, ConstraintMatchContext } from './constraint-blocks.ts';

// --- gate recipes: the language-detected quality-gate command -------------
export { deriveGateRecipe, renderGateRecipeBlock } from './gate-recipes.ts';

// --- AGENTS.md composition --------------------------------------------------
export { composeAgentsMd } from './agents-md-compose.ts';

// --- contract scaffold, onboarding, roster ---------------------------------
export { scaffoldContractArtifacts } from './project-contract-scaffold.ts';
export { demoProcessChanged } from './bridge-studio-project-onboard.ts';
export { loadProjectsWithMeta } from './project-roster.ts';
export { cmdProjectMigrate } from './project-migrate.ts';

// --- the HTTP route table ---------------------------------------------------
export { projectsRoutes } from './routes.ts';
