# `@forge/flows`

Runs **one flow**: walk a `FlowDefinition` node by node against a
`PhaseExecutor` port, keep the queue and the manifests that describe the work,
and carry a cycle from a staged run request to a merged PR. `SPEC.md` §2 is the
contract; `contract.test.ts` enforces it against this file.

Rank 5 in the allow-graph — the highest package. It may import `contracts`,
`kernel`, `library`, `knowledge`, `projects`, `sessions` and `agents`. What it
may **never** import is `factory`, and that single rule shapes the whole
package: the phase executors that actually run an agent live in
`orchestrator/phases/*`, so this package declares the **port** they satisfy and
takes them by injection at `apps/forge`. `runFlow` never names an executor.

Five baselined violations of that rule survive in `cycle.ts`,
`finalize-merged.ts` and two tests — owned by M5-A, listed in `design.md`. The
rule is the target, not a description of today.

## API (121 values)

| run one flow — the station engine | `checkFlowTriggers` · `findFanOutViolations` · `flowPathForId` · `listFlowBandIds` · `loadFlowDefinition` · `loadStarterFlow` · `resolveNodeKind` · `runFlow` |
| the cycle the develop flow runs | `CAPTURE_NONCE_ENV` · `REFLECTION_LOST_EVENT` · `REFLECT_MODE_FILE` · `assertNonEmptyDelivery` · `buildDemoCaptureArgv` · `commitDevLoopBoundary` · `commitOrchestratedCaptureArtifacts` · `compileWorkItemSpecs` · `demoJsonWantsCapture` · `enforceDevLoopCloseInvariant` · `enforceFinalCiGate` · `generateCaptureNonce` · `openPrInline` · `preflightDemoCaptureCommands` · `preservingForgeScratch` · `promoteMergedToDone` · `recordBrainGateResult` · `resolveCostCeilingOverride` · `resolveDemoCaptureTimeoutMs` · `runClosure` · `runMergeBoundaryGate` · `runOrchestratorCommand` |
| queue state machine, manifests and initiatives | `DERIVED_CEILING_MARGIN_USD` · `getPaths` · `initiativeTitle` · `isContainedProjectRepoPath` · `isSafeProjectName` · `listInFlight` · `listPlannedInitiatives` · `mintAndPersistManifestCycleId` · `mintTriggeredInitiative` · `parseManifest` · `persistManifestCostCeiling` · `persistManifestSpecs` · `promoteManifests` · `serializeManifest` |
| work items and their worktrees | `DEV_WORK_ITEM_ID_PATTERN` · `WORK_ITEM_FILE_PATTERN` · `createMergeQueue` · `createWiWorktree` · `enqueueGateFixWorkItems` · `gateRequiredPaths` · `mergeAndPublish` · `mergeWiIntoCycle` · `parseWorkItem` · `readWorkItemsFromDir` · `removeWiWorktree` · `reviewCapExhaustedPath` · `runConcurrentDispatch` · `serializeWorkItem` · `topologicalOrder` · `validateWorkItemSet` · `wiWorktreePath` · `writeMergeGateConfigErrorMarker` · `writeReviewCapExhaustedMarker` · `writeWorkItem` · `writeWorkItemStatus` |
| triggers and staged flow runs | `PLAN_FLOW_ID` · `REPO_RE` · `TRIGGER_KIND_IDS` · `drainFlowRunRequests` · `enqueueDevelopRun` · `enqueueFlowRun` · `enqueuePlanRun` · `fireAgentCompleteTriggers` · `listFlowRunRequests` · `stageFlowRunRequest` |
| scheduler and daemon | `checkInitiativeDeps` · `clearPidFile` · `daemonPaths` · `daemonState` · `decideAutoRetry` · `isAlive` · `isPaused` · `markStopping` · `pausedFlagPath` · `readPid` · `serve` · `setPaused` · `spawnServeDetached` · `writePidFile` |
| the run model the ui reads | `_resetRunListCacheForTest` · `buildAgentSlugToNodeId` · `buildNodeMapping` · `cachedListRuns` · `eventToNodeId` |
| git and pr mechanics | `add` · `assertLocalRemoteSynced` · `checkLocalRemoteSynced` · `finalizeMergedReadyForReview` · `mergePullRequest` · `rebasePreservedBranchOntoMain` |
| artifacts, demo paths and budgets | `CostCeilingError` · `DEMO_JSON_BASENAME` · `DEMO_MD_BASENAME` · `WedgeDetector` · `WedgeKillError` · `reviewFindingsJsonPath` · `validateReviewFindings` · `worktreeDemoDir` · `worktreeDemoJsonPath` · `worktreeDemoRelDir` · `writeReleaseJson` · `writeReviewFindingsJson` |
| route factories the assembly plugs in | `applyPlanVerdict` · `applyReviewVerdict` · `handleHookRoutes` · `handleRecoveryRoutes` · `handleStudioPostRoutes` |

### Types

`ClosureResult` · `CouplingPair` · `CronTriggerPayload` · `CycleInput` · `CycleOutcome` · `DispatchOutcome` · `FlowRunArgs` · `FlowRunRequest` · `LintStatus` · `MergeConflictDetail` · `MergeGateEvidence` · `MergeGateResult` · `MergeQueue` · `NodeExecContext` · `NodeKind` · `PushResult` · `QueuePaths` · `QueueState` · `ReflectMode` · `ReflectionStatus` · `ReflectorPhaseResult` · `ReleaseFinalizeHookInput` · `ReleaseFinalizePhaseResult` · `ReviewFinding` · `ReviewFindingsRecord` · `ReviewerOutcome` · `Run` · `StudioPostContext` · `TriggerCheckOpts` · `TriggerPayload` · `WebhookPushPayload` · `WorkItem`

## Three things this door is not

**It is not the deep-import list.** 47 module paths under `@forge/flows/` are
imported across the repo and they keep working; this door is the set a consumer
should be able to reach without knowing the file layout. The two agree by
construction — the list above was measured from the real imports, not chosen.

**It does not re-export other packages' vocabulary.** `InitiativeManifest` and
its two unions live in `@forge/contracts` (ruling 81) and `manifest.ts`
re-exports them for its own callers, but they are not on this door: a package's
public API should not claim ownership of another package's types, the same
reason `@forge/agents` declines to re-export kernel's id rules. An importer that
wants the manifest type takes it from `@forge/contracts`.

**It does not rename anything to look tidier.** `add` (from `worktree.ts`) is a
meaningless name on a package door — `import { add } from '@forge/flows'` tells
a reader nothing. It is exported here **unaliased anyway**, because a door whose
names disagree with the modules behind it is worse than a bad name: the fix is
to rename `add` in `worktree.ts` and let the door follow. **Recorded as an M5
finding, not silently papered over here.**

## What was here before

This file did not exist, and `index.ts` was `export {}` from the M2 skeleton
until M4-flows. The comment on that empty export called it "honest". It was
honest about the skeleton and dishonest about the package: 131 symbols were
already crossing the package boundary through deep specifiers, so the public
surface existed — it simply had no door, no document, and no test that could
tell the difference between a populated index and an empty one. That is what
`contract.test.ts` now makes falsifiable.
