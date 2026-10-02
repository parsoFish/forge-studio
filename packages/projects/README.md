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

### Values (42)

| area | exports |
|---|---|
| config | `loadProjectConfig` · `readAgentInstructionsFile` · `resolveProjectIdForRepo` · `PROJECT_CONFIG_REL_PATH` · `writeProjectConfigPatch` · `validateDemoDeclaration` · `WI_GATE_PACKAGE_PLACEHOLDER` |
| preflight | `runPreflight` · `formatPreflightReport` · `buildVerdictEvent` · `SCRATCH_PATHS` · `TRACKED_CONFIG_PATHS` · `SCAFFOLD_BUILD_OUTPUT_IGNORES` · `runContractComplianceLoop` · `formatComplianceReport` · `clauseTarget` · `loadDeclaredSkills` |
| contract stages | `deriveContractStages` · `resolveContainedProjectDir` |
| create | `scaffoldGreenfieldProject` · `listProjectStarters` · `projectStartersDir` |
| repo transactions | `ensureStudioBranch` · `commitStudioChange` · `withStudioWrite` · `dirtyPaths` · `isGitRepo` |
| the reset | `cmdProjectReset` · `computeContractDrift` · `applyContractReset` · `AppTypeUnresolvedError` |
| constraint blocks | `authorConstraintBlocks` · `globToRegExp` · `loadProjectConstraintBlocks` · `selectorMatches` |
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

`contract-stages.ts` reaches `@forge/sessions/studio/session-kinds.ts` and
`@forge/sessions/studio/session-transcript.ts` DEEP rather than through
`@forge/sessions`'s door (bead `forge-8vfn.5.31`): going through the door pulls
in sessions' whole module graph, and something reachable from it cycles back
here before `session-kinds.ts` finishes initializing — a real
`ReferenceError: Cannot access 'SESSION_STAGES' before initialization`, not a
theoretical risk. `@forge/sessions/package.json` legalises exactly those two
paths for this reason; see that package's README for the sessions-side note.

## Crash and recovery

- **Greenfield create** (`scaffoldGreenfieldProject`, `project-create.ts`) stages the project and its brain stub in sibling `.staging-<id>-*` dirs on the same filesystem as their destinations, then `renameSync`s each into place only once scaffolding, `git init`, the first commit, brain seeding and preflight all succeed; any failure `rmSync`s both staging trees before rethrowing, so an identical retry lands clean instead of hitting "already exists" — see the AT-4on-* cases in `packages/projects/tests/regression/project-create-atomicity.test.ts`.
- **The two renames are not one transaction** (`projects/` and `brain/projects/` are separate roots), so the brain is renamed first and the project last: a crash between them leaves a brain with no project. The next create for that id repairs it — the injected brain seeder's `isUntouchedStub` confirms the brain is exactly the stub this function seeds (`kb.yaml`, `profile.md`, `themes/README.md`, no symlinks, nothing else) before it is removed; a brain holding anything else still refuses — see `packages/projects/tests/regression/project-create-brain-repair.test.ts`.
- **`.forge/project.json` writes** (`writeProjectConfigPatch` in `project-config-write.ts`, `applyContractReset` in `reset.ts`) validate the merged config before writing, then `writeFileSync` the real path directly — not tmp-then-rename. Every write commits through `withStudioWrite` (`project-repo-tx.ts`) to the project's own `forge-studio` branch, scoped to only the paths it touched (never a bare `add -A`), so a crash before or after the write leaves at worst a visible, uncommitted diff in `git status` — never a silent loss and never an unrelated file swept in — see `packages/projects/tests/regression/project-repo-tx.test.ts` and `packages/projects/tests/unit/project-config-write.test.ts`.
- **Contract reset**'s skill relocations run first through the kernel's `guardedRename`, fail-closed on the first rejection with no rollback of moves already made; a partial reset is left as ordinary uncommitted working-tree changes for the operator to inspect, not a silent half-reset — see `packages/projects/tests/integration/reset-drift-report.test.ts` and `packages/projects/tests/integration/reset-tracked-commit.test.ts`.
- **Contract migration** (`project-migrate.ts`) validates the migrated shape before writing and writes nothing on a failed validation; a repeat run against an already-migrated file reports nothing-to-migrate and leaves it byte-unchanged, so re-running after a crash is always safe — see `packages/projects/tests/regression/project-migrate.test.ts` (AT-B6-8, AT-B6-10).
- **Onboarding an existing repo** (`bridge-studio-project-onboard.ts`) checks containment up front, then writes in sequence: `mkdirSync(projectRoot)`, contract scaffolding, brain seeding, and `.forge/project.json` last. A directory is a managed project only once that file exists, and it is written as a temp file in `.forge/` renamed onto the guard-verified path, so a crash at any earlier step leaves a directory discovery does not pick up, and a re-run onboards over it — see `packages/projects/tests/regression/onboard-project-json-atomicity.test.ts`.

## Layout

`tests/{unit,integration,contract,regression}/` — no test file sits at the package
root except `contract.test.ts` itself. Production files stay under the 800-line cap;
the package as a whole is capped in `QUARRY.md`.
