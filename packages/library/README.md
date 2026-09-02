# `@forge/library`

The **objects an operator builds a factory out of**: skills, hooks, connections, artifact templates, demo elements, instruction seeds, and the community registry they can be installed from. Authoring, scanning, the trust decisions, and the listings every Studio surface reads.

Spec §3.1 gives this package the Skill and Artifact kinds. What it does **not** own is the per-spawn runtime: `agents` dispatches hooks at spawn time and composes skill prompts. The one exception is deliberate and stated in `design.md` — the hook *execution* primitive lives here.

## The public API

These 33 values and 7 types are exported from `index.ts` and nothing else is. The list is not curated: it is the set other packages, `apps/` and the legacy tree actually import, measured across the repo. `tests/contract/contract.test.ts` parses this table and fails if the index and this file disagree, so neither can drift alone.

| symbol | kind | what it is for |
|---|---|---|
| `skillPath` | value | where a named skill's `SKILL.md` lives. Composes a layout — **not** a containment check; reads go through the guarded form |
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
| `HookRunError` | value | a named error class, so a caller can branch without parsing prose |
| `HookRunFailureReason` | type | why a hook run failed |
| `connectionById` | value | one connection from the curated catalog |
| `connectionsReadinessFor` | value | which of an agent's connections are not ready, and why |
| `UnreadyConnection` | type | one unready connection with its stated reason |
| `probeConnection` | value | the real, credential-stripped presence/version probe |
| `ProbeResult` | type | what a probe found — never a guess |
| `listDemoElements` | value | the demo elements a demo can be assembled from |
| `listInstructionSeeds` | value | the instruction seeds AGENTS.md composition draws on |
| `lintTemplateLibrary` | value | artifact templates that are malformed or unreferenced |
| `loadCatalog` | value | the curated SDK/model/guard catalog |
| `communitySkillsFromRegistry` | value | the community registry's skills, as the palette sees them |
| `lintCommunityIndex` | value | registry rows whose vendored package disagrees with the index |
| `cmdCommunity` | value | the `forge community` CLI verb |
| `libraryRoutes` | value | this package's HTTP routes, assembled by `apps/forge/routes.ts` |
| `runFinalize` | value | land an authoring session's staged package into the library |

## Two doors

`index.ts` is the public door. `@forge/library/<file>.ts` is the legacy one, and today every consumer still uses it — `package.json` maps `"./*": "./*"`, so nothing broke when this door opened and nothing was repointed. Collapsing to one door touches four other packages plus `cli/` and `orchestrator/`, which is a cross-package change beyond a repoint; it is recorded, not silently deferred.

## Where the rest lives

The route handlers, the per-kind bridge modules, install/staging internals and the lint passes' private helpers are reachable but **not** part of the promised surface. An index that exported everything would document nothing.
