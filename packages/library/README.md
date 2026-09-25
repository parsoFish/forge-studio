# `@forge/library`

The **objects an operator builds a factory out of**: skills, hooks, connections, artifact templates, demo elements, instruction seeds, and the community registry they can be installed from. Authoring, scanning, the trust decisions, and the listings every Studio surface reads.

Spec §3.1 gives this package the Skill and Artifact kinds. What it does **not** own is the per-spawn runtime: `agents` dispatches hooks at spawn time and composes skill prompts. The one exception is deliberate and stated in `design.md` — the hook *execution* primitive lives here.

## The public API

These 54 values and 13 types are exported from `index.ts`, plus one documented test-only subpath (below), and nothing else is. The list is not curated: it is the set other packages, `apps/` and the legacy tree actually import, measured across the repo. `tests/contract/contract.test.ts` parses this table and fails if the index and this file disagree, so neither can drift alone.

| symbol | kind | what it is for |
|---|---|---|
| `skillPath` | value | where a named skill's `SKILL.md` lives. Composes a layout — **not** a containment check; reads go through the guarded form |
| `skillDir` | value | a named skill's directory (the containing dir, not the `SKILL.md` file) |
| `skillsDir` | value | the `skills/` root directory itself |
| `skillPathRelative` | value | a skill's `SKILL.md` path relative to the forge root |
| `guardedSkillMdPath` | value | a skill's `SKILL.md` path across every skill root, through the containment guard |
| `listSkillMdDirs` | value | every `SKILL.md`-bearing directory under a given directory |
| `listSkillDirs` | value | every skill directory under the skills root |
| `listPlainSkills` | value | the composable skills (a `SKILL.md` with no runtime block), as distinct from studio agents |
| `listSkillLibrary` | value | the skill library listing every Studio skill surface reads |
| `lintSkillTrust` | value | the trust lint: installed-but-edited, unapproved drafts, provenance drift |
| `lintSkillRefs` | value | agents referencing skills that do not exist |
| `lintSkillToolFence` | value | a skill's declared tools against what its frontmatter grants |
| `lintStarterAgentToolFence` | value | the same fence for the shipped starter agents |
| `removeInstallLedgerEntry` | value | drop a skill's install-ledger row when its package is removed |
| `MAX_PACKAGE_FILES` | value | the package-size ceiling install refuses past |
| `MAX_PACKAGE_BYTES` | value | the package-bytes ceiling install refuses past |
| `PackageFile` | type | one file in a skill package: relative POSIX path plus body |
| `listHookLibrary` | value | every hook definition with its derived carried-by usage |
| `listHookIds` | value | the hook ids alone, for composition checks |
| `loadHookDefinition` | value | one hook's parsed `hook.yaml` |
| `parseHookMatcher` | value | a hook matcher expression, parsed and reported honestly |
| `checkHookComposition` | value | whether an agent may carry a given hook |
| `lintHookDefinitions` | value | malformed, unreachable or over-permissioned hook packages |
| `lintHookComposition` | value | agents composing hooks they may not carry |
| `HookLifecycleEvent` | type | the closed vocabulary of lifecycle events a hook binds to |
| `HookMatcherParse` | type | a parsed matcher, including why an unparseable one failed |
| `HookPermissionManifest` | type | the permissions a hook declares |
| `approveHook` | value | record an operator's approval in the hook ledger |
| `readHookApprovalLedger` | value | the live approvals — the runtime authority for "may this run" |
| `runHookScript` | value | execute a hook's script under the env-stripped bounded spawn |
| `runHookScriptAsync` | value | the async form of `runHookScript` |
| `HookRunResult` | type | what a hook run produced — stdout/stderr/exit, never a guess |
| `HookRunError` | value | a named error class, so a caller can branch without parsing prose |
| `HookRunFailureReason` | type | why a hook run failed |
| `connectionById` | value | one connection from the curated catalog |
| `catalogConnectionById` | value | the same lookup, scoped to one forge root |
| `connectionsReadinessFor` | value | which of an agent's connections are not ready, and why |
| `UnreadyConnection` | type | one unready connection with its stated reason |
| `probeConnection` | value | the real, credential-stripped presence/version probe |
| `ProbeResult` | type | what a probe found — never a guess |
| `listDemoElements` | value | the demo elements a demo can be assembled from |
| `listInstructionSeeds` | value | the instruction seeds AGENTS.md composition draws on |
| `detectProjectTags` | value | which instruction-seed tags a project's on-disk shape matches |
| `matchInstructionSeeds` | value | the seeds that match a project's detected tags |
| `renderSeedPromptSection` | value | the composed instruction-seeds section of an agent's prompt |
| `composedSeedsFooter` | value | the footer marker a composed seeds section is wrapped in |
| `stripComposedSeedsFooter` | value | remove a previously composed seeds section before recomposing |
| `lintTemplateLibrary` | value | artifact templates that are malformed or unreferenced |
| `loadArtifactTemplate` | value | one artifact template, parsed from its markdown |
| `listArtifactTemplates` | value | every artifact template under a studio root |
| `FlowSource` | type | the flow-lookup shape template listing needs (list ids, load one) |
| `loadCatalog` | value | the curated SDK/model/guard catalog |
| `validateLibraryFlag` | value | studio-lint's validation entry for the catalog's `library` flag section |
| `lintArtifactTemplates` | value | studio-lint pass: malformed or unreferenced artifact templates |
| `lintDemoElements` | value | studio-lint pass: malformed or unreferenced demo elements |
| `lintInstructionSeeds` | value | studio-lint pass: malformed or unreferenced instruction seeds |
| `lintCatalogSection` | value | studio-lint pass over the catalog section |
| `lintCommunitySection` | value | studio-lint pass over the community-registry section |
| `communitySkillsFromRegistry` | value | the community registry's skills, as the palette sees them |
| `lintCommunityIndex` | value | registry rows whose vendored package disagrees with the index |
| `cmdCommunity` | value | the `forge community` CLI verb |
| `libraryRoutes` | value | this package's HTTP routes, assembled by `apps/forge/routes.ts` |
| `LibraryRouteDeps` | type | the injected deps `libraryRoutes` needs to build its table |
| `runFinalize` | value | land an authoring session's staged package into the library |
| `AuthoringSessionPort` | type | the authoring-session shape sessions injects and library consumes |
| `AgentFacts` | type | what a composing agent's materials look like, for prompt assembly |
| `ComposingAgent` | type | one agent in the middle of composing skills/hooks/connections |

## One door, plus one test-only subpath

`index.ts` is the public door. `package.json` maps only `"."` and `"./testing"` — a deep path like `@forge/library/skill-path.ts` no longer resolves. Bead `forge-8vfn.5.31` repointed every consumer that had been using the legacy `@forge/library/<file>.ts` paths (`"./*"` is gone).

`@forge/library/testing` exports `installSkillPackage`, `approveSkillDraft`, `validateCatalog`, `ComposableKind`, `fixtureFlowSource`, `loadDemoElement`, `loadInstructionSeed`, `loadCommunityRegistry`, `serializeCommunityRegistry`, `resolveCommunitySource`, `communityRegistryPath` and `COMMUNITY_REGISTRY_SCHEMA_VERSION` — each has no production consumer outside this package, only `apps/forge` tests reach for them, so they stay off the main door rather than widening it on a test's convenience.

## Where the rest lives

The route handlers, the per-kind bridge modules, and the install/staging internals with no external consumer are reachable only from inside this package (or via `./testing`, for the ones a test needs). An index that exported everything would document nothing.
