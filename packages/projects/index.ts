/**
 * @forge/projects — The project contract: config, preflight clauses, contract stages, create, repo transactions.
 *
 * Owns the **6 Project** seam. Its contract is SPEC.md §6; the test that
 * holds it is `contract.test.ts` in this directory.
 *
 * `reset.ts` is the one new capability M4 wave 1 adds (S3, 1.0.md §3):
 * `computeContractDrift` + `applyContractReset` — reset a drifted project's
 * `.forge/project.json` back to the current contract template, preserving
 * `northStar`/`instructions`/secret NAMES. Everything else stays empty on
 * purpose: this package is created by the M2 skeleton and populated by its
 * own lane; a placeholder export for the rest would be a lie the boundary
 * lint could not see.
 */
export { computeContractDrift, applyContractReset } from './reset.ts';
export type { ContractSection, DriftAction, DriftRow, SkillMove, DriftReport, ResetResult } from './reset.ts';
