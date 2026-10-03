# @forge/kernel

The facts every other package needs and none of them owns: the JSONL event
log, config and first-run scaffolding, the path-containment guard, the id
vocabulary, the station/band ports, the route-table shape and HTTP envelope,
and the small guarded-read/bounded-log primitives everything above builds on.
Rank 1 of the allow-graph, directly above contracts:

`contracts ← kernel ← {library, knowledge, projects} ← agents ← sessions ← flows ← stations ← factory ← apps/{forge, studio}`

It may import `contracts` and nothing else — `config.ts` forwards
`DEFAULT_KICKOFF_COST_CEILING_USD` and `MAX_KICKOFF_COST_CEILING_USD` straight
from `@forge/contracts` so a caller needs one import instead of two, and that
is the only place another package's vocabulary crosses this door. Every
package above kernel — `library`, `knowledge`, `projects`, `agents`,
`sessions`, `flows`, `stations`, `factory`, and both apps — imports it
directly.

## API (150 values)

| the JSONL event log + cost accounting | `createLogger` · `bridgeCycleId` · `emitGroundFileChanges` · `writeProjectGroundFile` · `phasesWithIterationEvents` · `isAuthoritativeCostEvent` · `restatedSyntheticEventIds` · `costStreamFacts` · `countsTowardCost` · `sumAuthoritativeCostUsd` · `deriveSessionCostUsd` |
| the SDK tool-use fence | `toolFenceOptions` |
| operator config (`forge.config.json`) + project starters | `loadConfig` · `defaultConfigPath` · `resolveProjectsDir` · `PROJECT_STARTERS_MANIFEST` · `projectStartersDir` · `listProjectStarters` · `describeProjectStarters` |
| tunable caps & budgets resolved from config + env | `DEFAULT_DEV_WI_CONCURRENCY` · `DEV_WI_CONCURRENCY_CEILING` · `resolveDevWiConcurrency` · `DEFAULT_POST_MERGE_CI_TIMEOUT_MS` · `DEFAULT_POST_MERGE_CI_POLL_INTERVAL_MS` · `resolvePostMergeCiConfig` · `DEFAULT_REVIEW_MAX_SEND_BACK_ROUNDS` · `DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS` · `resolveReviewLoopCaps` · `DEFAULT_TRIGGERED_RUN_COST_BUDGET_USD` · `DEFAULT_TRIGGERED_RUN_ITERATION_BUDGET` · `resolveTriggeredRunBudgets` · `DEFAULT_KICKOFF_COST_CEILING_USD` · `MAX_KICKOFF_COST_CEILING_USD` · `resolveDefaultKickoffCeilingUsd` |
| the env-assertion boundary | `collectEnvIssues` · `assertEnv` |
| git commit identity (author, not the GitHub host identity below) | `ralphGitIdentity` · `UNIFIER_GIT_IDENTITY` · `ORCHESTRATOR_GIT_IDENTITY` · `gitIdentityEnvOverlay` · `gitIdentityConfigArgs` |
| GitHub host identity for outward gh actions | `ghTokenFor` · `assertGhOwner` · `ghRunnerFor` |
| first-run scaffolding (`forge init`) | `QUEUE_SUBDIRS` · `layoutDirs` · `defaultConfigJson` · `ghAuthed` · `ensureLayoutDirs` · `ensureDefaultConfig` · `runInit` |
| the path-containment guard + guarded fs primitives | `PathGuardContainmentError` · `isSafeSegment` · `isSafeSubPath` · `resolveGuardedPath` · `guardedFile` · `guardedReadFile` · `guardedWriteFile` · `guardedReadDir` · `guardedRename` |
| the session/project-dir realpath-guarded single-file read | `safeReadFileInSession` |
| case-folding probe (duplicate-target detection) | `CaseFoldingProbeError` · `detectVolumeCaseFolding` |
| guarded scan (bounded mtime + tail reads) | `guardedMtime` · `selectRecentEntries` · `guardedReadFileTail` |
| the studio validator Finding shape | `err` · `flag` |
| station + band ports (SPEC.md §2) | `createBandRegistry` |
| id vocabulary + the one slug guard | `SLUG_RE` · `EXACT_ID_RE` · `PROJECT_ID_RE` · `KB_ID_RE` · `MAX_EXACT_ID_LENGTH` · `SAFE_ID_RE` · `RESERVED_OBJECT_IDS` · `isReservedId` · `MAX_SKILL_ID_LENGTH` · `SLUG_RULE_TEXT` · `assertSkillSlug` · `FORGE_ROOT` |
| origin -> provenance mapping | `provenanceOfOrigin` · `AGENT_PROVENANCE` · `PROJECT_PROVENANCE` · `originOfHookOrTemplate` · `SCAFFOLD_TEMPLATE_ORIGIN` |
| project-layout SSOT (id normalisation, discovery, brain dirs) | `normalizeProjectId` · `discoverProjects` · `projectBrainDir` · `projectThemesDir` · `mintedRemotesManifestPath` · `recordMintedRemote` · `rootManagesProject` · `rootMismatchReason` |
| spawn-env allowlist (child-process env seam) | `AGENT_ENV_ALLOWLIST` · `MAX_ENV_OVERRIDE_KEYS` · `HOOK_ENV_CREDENTIAL_EXCLUSIONS` · `HOOK_ENV_BASE_ALLOWLIST` · `buildChildEnv` · `forgeBinOnPath` · `forwardChildStderr` · `sdkStderrSink` · `RESOURCE_PREFIX_ENV` · `RESOURCE_PREFIX_MAX_LENGTH` · `RESOURCE_PREFIX_RE` · `deriveResourcePrefix` |
| route-table shape + dispatcher | `dispatchRoute` |
| HTTP response envelope | `allowedOrigin` · `sendJson` · `sanitizeError` · `pathOnly` · `parseQuery` |
| dry-bridge gate + typed refusal | `DRY_BRIDGE_ENV` · `DRY_BRIDGE_LOG_BUCKET` · `isDryBridge` · `DRY_BRIDGE_ACTIONS` · `emitDryBridgeRefusal` · `refuseDryBridge` · `emitDryBridgeSkip` · `dryBridgeAgentTurnMarker` |
| log-cycle discovery + run-id charset gate | `listCycles` · `isSafeRunId` · `composeSafeRunId` · `refuseBareInitiativeRunId` |
| package-owned discovery roots (flows/skills) | `flowRoots` · `skillRoots` · `resolveIdAcrossRoots` · `listIdsAcrossRoots` |
| the FORGE_CLAUDE_CLI seam | `CLAUDE_CLI_ENV` · `ClaudeCliPathError` · `resolveClaudeCliPath` |
| studio-object frontmatter parsing | `readFrontmatter` · `loadStudioObject` |
| the shared YAML-field readers | `reqString` · `optString` · `reqNumber` · `optNumber` · `optBool` · `stringArray` · `reqObject` · `RegistryError` · `oneOf` · `loadYaml` · `loadYamlWithRaw` |
| bounded per-key JSON log | `readBoundedLog` · `appendBoundedLog` · `boundedLogSegments` · `truncateTail` |
| process liveness (`/proc` pid check) | `isProcessRunning` |
| the forge-repo-git fence (row 208) | `decideForgeRepoGit` |

### Types (46)

`BandExecutor` · `BandRegistry` · `CanUseTool` · `CaseFoldingProbe` ·
`ClauseId` · `ClauseResult` · `ConfigResult` · `CostStreamFacts` ·
`DiscoveredProject` · `DryBridgeAction` · `DryBridgeRefusalInput` ·
`DryBridgeStubAction` · `DryClassification` · `EnvAssertionMode` ·
`EventLogEntry` · `EventLogger` · `EventType` · `Finding` · `ForgeConfig` ·
`ForgeRepoGitDecision` · `ForgeRepoGitFenceInput` ·
`FrontmatterDoc` · `GhExec` · `GitIdentity` · `HookTemplateOrigin` ·
`InitReport` · `LayoutDirsResult` · `LayoutResult` · `LoggerOptions` ·
`PathGuardOk` · `PathGuardReject` · `PathGuardResult` · `Phase` ·
`PhaseExecutor` · `PreflightOptions` · `PreflightReport` · `ProjectGate` ·
`ProjectStarterDescription` · `Provenance` · `RootMatch` · `RouteContext` ·
`RouteEntry` · `RouteMethod` · `RouteTable` · `StudioContext` ·
`ToolFenceOptions`

## Crash and recovery

Every durable write kernel performs is a direct, non-atomic write — nothing under `packages/kernel` uses a temp-file-then-rename pattern (`grep` for `.tmp`/`writeFileAtomic` across the package finds nothing) except the one atomic primitive it exposes as a seam, not something it uses on itself.

- **The JSONL event log.** `createLogger`'s `emit` does one synchronous `appendFileSync(logFilePath, JSON.stringify(entry) + '\n')` per call (`logging.ts:165`) — no fsync, no write-ahead file, no atomicity claim beyond whatever the OS's single `write()` syscall gives a line that size. A hard kill mid-append can leave a torn last line. Kernel itself never reads this log back (`createLogger` is write-only), but every downstream reader tolerates a torn line: `packages/flows/cycle.ts:127-137`'s `readPriorCycleCostEvents` parses per-line inside `try { JSON.parse } catch { continue }`, commented "a truncated final line is not a reason to fail the read"; `packages/sessions/session-readability.ts:86-98`'s `parseGuardedEventsJsonl` does the same, commented "a malformed individual JSONL line is skipped, not fatal"; `packages/flows/run-model.ts` and `forge-metrics.ts` follow the identical shape. No test anywhere in the repo — including `packages/kernel/tests/unit/logging.test.ts`, which only proves well-formed round-trips — actually feeds a torn/truncated line through one of these readers, so the tolerance is real code, not a tested guarantee.
- **Config.** `config.ts` performs zero writes; `loadConfig` (`config.ts:122-133`) treats a missing file and a malformed-JSON file identically — return `{}`, never throw — proven by `packages/kernel/tests/unit/config.test.ts:45`. `init.ts`'s `ensureDefaultConfig` writes the default config with one direct `writeFileSync(path, defaultConfigJson(), 'utf8')` (`init.ts:136`) — no temp file, no rename. A kill mid-write leaves a truncated `forge.config.json` that `loadConfig` then silently reads back as `{}`: an operator's settings can be lost with no error surfaced anywhere. `packages/kernel/tests/unit/init-layout-config-split.test.ts:39-69` proves a clean write and proves an existing config is never clobbered; no test in the repo simulates a crash mid-write. `ensureLayoutDirs`'s `mkdirSync(dir, { recursive: true })` per queue dir (`init.ts:118`) is idempotent, so a kill mid-loop self-heals on the next `forge init`/`forge studio`.
- **`process-liveness.ts`.** `isProcessRunning` (`process-liveness.ts:49-63`) reads `/proc/<pid>/stat` and reports not-running only on a genuine `ENOENT` or a zombie/dead state character; any other read failure (e.g. `EACCES`) conservatively reports still-running, so a restarted daemon never wrongly concludes a live process has exited. This is the one area with a thorough purpose-built test: `packages/kernel/tests/unit/process-liveness.test.ts` covers ENOENT, EACCES, zombie/dead states, and a real live child process.
- **`bounded-log.ts`.** `appendBoundedLog` (`bounded-log.ts:28-32`) is a full read-modify-write — read the whole JSON array via `readBoundedLog`, prepend the new entry, slice to `max`, write the whole array back through `guardedWriteFile` — non-atomic, same shape as config. `readBoundedLog` (`bounded-log.ts:13-22`) degrades any failure (missing file, corrupt JSON, valid JSON that isn't an array) to `[]`, never throwing; `packages/kernel/tests/unit/bounded-log.test.ts:46-58` proves both the corrupt-JSON and wrong-shape cases read back as `[]`. No test simulates a genuinely torn trailing write, but the same single `JSON.parse` catch-all governs that case identically.
- **`packages/kernel/studio/yaml-fields.ts`.** Read-only — no write call anywhere in the file (confirmed by grep). Unlike the JSON paths above, a corrupt file is not swallowed: `loadYamlWithRaw` throws a named `"<file>: cannot read file"` or `"<file>: YAML parse error"` rather than degrading to an empty object — an intentional asymmetry against `config.ts`/`bounded-log.ts`'s silent-default behaviour.
- **`guardedWriteFile` / `guardedRename`.** `guardedWriteFile` (`path-guard.ts:618-628`) is the same direct, non-atomic `mkdirSync` + `writeFileSync` as every write above. `guardedRename` (`path-guard.ts:719-743`) resolves both endpoints through `resolveGuardedPath` with zero side effects first, and only calls `renameSync` once both pass — the move itself rides on `rename(2)`'s OS-level atomicity, which this module relies on rather than adds, and it deliberately does not add an `EXDEV` copy-then-delete fallback because "that would be a second, unguarded write path" (`path-guard.ts:705-717`). No test in `packages/kernel/tests/unit/path-guard-rename.test.ts` exercises a mid-rename kill; its cases are containment tests, not atomicity tests — the atomicity claim rests on the OS guarantee, not on anything this codebase tests.

Non-atomic writes are the norm, not the exception: kernel supplies one atomic primitive (`guardedRename`, via the OS) but does not use it to make its own config, event-log, or bounded-log writes atomic, and instead relies entirely on read-side tolerance — silent default for JSON state, a thrown error for YAML — to survive a torn file.
