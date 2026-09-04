# `@forge/projects`

The **6 Project** seam ([`SPEC.md`](../../SPEC.md) §6): a project earns unattended
development by satisfying a written, checkable contract. Face A is the authoring
object (config, instructions, demo, bound skills, bound knowledge); Face B is the
operational preflight (the C-clauses). This package owns both, plus create, repo
transactions, and the reset.

## The public door

`import … from '@forge/projects'`. That is this package's API and the list below is
all of it. Deep paths (`@forge/projects/project-config.ts`) still resolve —
`package.json` maps `"./*": "./*"` — and every existing importer uses one, so they
are the **legacy** door, kept working and not recommended for new code.

`contract.test.ts` asserts this list against what the index actually exports, in
both directions, and is required to FAIL against an empty index.

### Values (30)

| area | exports |
|---|---|
| config | `loadProjectConfig` · `readAgentInstructionsFile` · `resolveProjectIdForRepo` |
| preflight | `runPreflight` · `formatPreflightReport` · `buildVerdictEvent` · `SCRATCH_PATHS` · `SCAFFOLD_BUILD_OUTPUT_IGNORES` · `runContractComplianceLoop` · `formatComplianceReport` |
| contract stages | `deriveContractStages` · `resolveContainedProjectDir` |
| create | `scaffoldGreenfieldProject` · `listProjectStarters` · `projectStartersDir` |
| repo transactions | `ensureStudioBranch` · `commitStudioChange` · `withStudioWrite` |
| the reset | `cmdProjectReset` · `computeContractDrift` · `applyContractReset` · `AppTypeUnresolvedError` |
| constraint blocks | `authorConstraintBlocks` · `loadProjectConstraintBlocks` · `selectorMatches` |
| gate recipes | `deriveGateRecipe` · `renderGateRecipeBlock` |
| onboarding & roster | `scaffoldContractArtifacts` · `demoProcessChanged` · `loadProjectsWithMeta` · `cmdProjectMigrate` |
| HTTP routes | `projectsRoutes` |

### Types (8)

`ProjectConfig` · `AcceptanceGateConfig` · `ClauseId` · `ContractStageRow` ·
`DeriveContractStagesResult` · `ScaffoldResult` · `ConstraintBlock` ·
`ConstraintMatchContext`

## What is not exported

Measured, not guessed: everything above is deep-imported by at least one module
outside this package today (repo-wide census in [`design.md`](./design.md)). Several
modules genuinely belong to this seam and export nothing here because their real
external caller uses a *different* symbol from the same file —
`project-config.ts`'s `validateProjectConfig` sits next to the
evidenced `loadProjectConfig`; `project-repo-tx.ts`'s `isGitRepo`, `defaultBranch`,
`saveProjectRepo`, `hasPendingStudioChanges` and `STUDIO_BRANCH` sit next to the
three evidenced write-path functions. `routes.ts`'s `ProjectsRouteDeps` type is used
only by this package's own contract test, not by its one real caller
(`apps/forge/routes.ts` supplies the deps as an inline object literal). None of
these are hidden — `design.md` names every one and why.

## What it owns

`routes.ts` is the package's HTTP surface: sixteen carved routes as an ordered,
first-match-wins table `apps/forge/routes.ts` assembles, matching
[`@forge/knowledge`](../knowledge/README.md)'s pattern. The reset row — `cmdProjectReset` ·
`computeContractDrift` · `applyContractReset` · `AppTypeUnresolvedError` — is the same
capability behind two of those routes, `POST .../contract-reset` (dry-run) and
`POST .../contract-reset/apply` (S3, 1.0.md §3, "Rebuild contract").

## What it does not own

Two routes that would belong here read `@forge/flows` (a strictly higher rank) and
stay in `apps/forge/bridge-studio.ts` rather than mint an unbaselinable boundary violation.
`preflight-fix-runner.ts`'s interactive half is a **sessions** kind and lives in
`packages/sessions`; this package owns only the deterministic auto-fix loop it
calls into. See [`design.md`](./design.md) for both, and for why a rank-2 package
cannot simply import its way to owning them.

## Layout

`tests/{unit,integration,contract,regression}/` — no test file sits at the package
root except `contract.test.ts` itself. Production files stay under the 800-line cap;
the package as a whole is capped in `QUARRY.md`.
