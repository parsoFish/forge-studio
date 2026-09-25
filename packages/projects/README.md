# `@forge/projects`

The **6 Project** seam ([`SPEC.md`](../../SPEC.md) §6): a project earns unattended
development by satisfying a written, checkable contract. Face A is the authoring
object (config, instructions, demo, bound skills, bound knowledge); Face B is the
operational preflight (the C-clauses). This package owns both, plus create, repo
transactions, and the reset.

## The public door

`import … from '@forge/projects'`. That is this package's API and the list below is
all of it. `package.json` maps only `"."` and one documented test-only subpath
(`@forge/projects/testing`, below) — a deep path like
`@forge/projects/project-config.ts` no longer resolves. Bead `forge-8vfn.5.31`
collapsed the legacy `"./*"` door; every importer now goes through
`@forge/projects`.

`contract.test.ts` asserts this list against what the index actually exports, in
both directions, and is required to FAIL against an empty index.

### Values (36)

| area | exports |
|---|---|
| config | `loadProjectConfig` · `readAgentInstructionsFile` · `resolveProjectIdForRepo` · `PROJECT_CONFIG_REL_PATH` |
| preflight | `runPreflight` · `formatPreflightReport` · `buildVerdictEvent` · `SCRATCH_PATHS` · `TRACKED_CONFIG_PATHS` · `SCAFFOLD_BUILD_OUTPUT_IGNORES` · `runContractComplianceLoop` · `formatComplianceReport` · `clauseTarget` · `loadDeclaredSkills` |
| contract stages | `deriveContractStages` · `resolveContainedProjectDir` |
| create | `scaffoldGreenfieldProject` · `listProjectStarters` · `projectStartersDir` |
| repo transactions | `ensureStudioBranch` · `commitStudioChange` · `withStudioWrite` · `dirtyPaths` |
| the reset | `cmdProjectReset` · `computeContractDrift` · `applyContractReset` · `AppTypeUnresolvedError` |
| constraint blocks | `authorConstraintBlocks` · `loadProjectConstraintBlocks` · `selectorMatches` |
| gate recipes | `deriveGateRecipe` · `renderGateRecipeBlock` |
| onboarding & roster | `scaffoldContractArtifacts` · `demoProcessChanged` · `loadProjectsWithMeta` · `cmdProjectMigrate` |
| studio validation | `validateDiscoveredProjects` |
| HTTP routes | `projectsRoutes` |

### Types (10)

`ProjectConfig` · `AcceptanceGateConfig` · `ClauseId` · `ContractStageRow` ·
`DeriveContractStagesResult` · `ScaffoldResult` · `ConstraintBlock` ·
`ConstraintMatchContext` · `DeclaredSkill` · `ProjectsRouteDeps`

### The one test-only subpath

`@forge/projects/testing` exports `parseSkills` and `checkDemo` — each has no
production consumer outside this package, only two `scripts`/`apps/forge` tests
reach for them, so they stay off the main door (bead `forge-8vfn.5.31`: a symbol
earns the door by having a production consumer in another package; a test-only
deep import gets a named, documented subpath instead of widening `"./*"` back
open).

## What is not exported

Measured, not guessed: everything above is deep-imported by at least one module
outside this package today (repo-wide census in [`design.md`](./design.md)). Several
modules genuinely belong to this seam and export nothing here because their real
external caller uses a *different* symbol from the same file —
`project-config.ts`'s `validateProjectConfig` sits next to the
evidenced `loadProjectConfig`; `project-repo-tx.ts`'s `isGitRepo`, `defaultBranch`,
`saveProjectRepo` and `hasPendingStudioChanges`/`STUDIO_BRANCH` sit next to the
four evidenced write-path functions. `routes.ts`'s `ProjectsRouteDeps` type moved
onto the door in the same bead that added `dirtyPaths`/`PROJECT_CONFIG_REL_PATH`:
`apps/forge/dry-bridge.ts` (a route-classification probe distinct from
`apps/forge/routes.ts`'s own inline-object-literal caller) needs the type once its
deep import repoints. None of these are hidden — `design.md` names every one and
why.

## Declared skills reach the agent, not just preflight

`preflight-skills.ts`'s `loadDeclaredSkills(projectDir, forgeRoot)` is the read half of
the SKILLS clause `checkSkills` only ever checked EXISTENCE for (ADR 024 item 90):
both resolve through the same `resolveDeclaredSkillPath`, but the loader also reads
each `SKILL.md`'s content and THROWS `MissingDeclaredSkillError` on a declared id that
doesn't resolve, so `@forge/agents`'s two spawn builders can fold the text into every
agent's system prompt instead of it being a fact preflight confirms and nothing else
reads.

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
