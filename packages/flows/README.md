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

## API (150 values)

| run one flow — the station engine | `checkFlowTriggers` · `findFanOutViolations` · `flowPathForId` · `listFlowBandIds` · `loadFlowDefinition` · `loadStarterFlow` · `resolveNodeKind` · `runFlow` |
| the cycle the develop flow runs | `CAPTURE_NONCE_ENV` · `MAX_COMMITTED_DEMO_MEDIA_BYTES` · `MAX_COMMITTED_DEMO_WEBM_BYTES` · `REFLECTION_LOST_EVENT` · `REFLECT_MODE_FILE` · `assertNonEmptyDelivery` · `buildDemoCaptureArgv` · `commitDevLoopBoundary` · `commitOrchestratedCaptureArtifacts` · `compileWorkItemSpecs` · `demoJsonWantsCapture` · `enforceDevLoopCloseInvariant` · `enforceFinalCiGate` · `generateCaptureNonce` · `openPrInline` · `preflightDemoCaptureCommands` · `preservingForgeScratch` · `promoteMergedToDone` · `rebaseForResume` · `recordBrainGateResult` · `resolveCostCeilingOverride` · `resolveDemoCaptureTimeoutMs` · `resumeSkipsPerWiWork` · `runClosure` · `runMergeBoundaryGate` · `runOrchestratorCommand` |
| queue state machine, manifests and initiatives | `DERIVED_CEILING_MARGIN_SHARE` · `getPaths` · `initiativeTitle` · `isContainedProjectRepoPath` · `isSafeProjectName` · `isSafeCycleId` · `listInFlight` · `listPlannedInitiatives` · `manifestBlockedClauses` · `mintAndPersistManifestCycleId` · `mintTriggeredInitiative` · `parseManifest` · `persistManifestCostCeiling` · `persistManifestSpecs` · `promoteManifests` · `serializeManifest` · `CHANGE_CLASSES` · `isCanonicalInitiativeId` |
| work items and their worktrees | `DEV_WORK_ITEM_ID_PATTERN` · `WORK_ITEM_FILE_PATTERN` · `createMergeQueue` · `createWiWorktree` · `enqueueGateFixWorkItems` · `gateRequiredPaths` · `mergeAndPublish` · `mergeWiIntoCycle` · `parseWorkItem` · `readWorkItemsFromDir` · `removeWiWorktree` · `reviewCapExhaustedPath` · `runConcurrentDispatch` · `serializeWorkItem` · `topologicalOrder` · `validateWorkItem` · `validateWorkItemSet` · `wiWorktreePath` · `writeMergeGateConfigErrorMarker` · `writeReviewCapExhaustedMarker` · `writeWorkItem` · `writeWorkItemStatus` |
| triggers and staged flow runs | `PLAN_FLOW_ID` · `REPO_RE` · `TRIGGER_KIND_IDS` · `drainFlowRunRequests` · `enqueueDevelopRun` · `enqueueFlowRun` · `enqueuePlanRun` · `fireAgentCompleteTriggers` · `listFlowRunRequests` · `stageFlowRunRequest` |
| scheduler and daemon | `checkInitiativeDeps` · `clearPidFile` · `daemonPaths` · `daemonState` · `decideAutoRetry` · `isAlive` · `isPaused` · `markStopping` · `pausedFlagPath` · `readPid` · `serve` · `setPaused` · `spawnServeDetached` · `writePidFile` |
| the run model the ui reads | `_resetRunListCacheForTest` · `buildAgentSlugToNodeId` · `buildNodeMapping` · `cachedListRuns` · `eventToNodeId` · `summariseCycle` · `costByClass` |
| git and pr mechanics | `add` · `assertLocalRemoteSynced` · `checkLocalRemoteSynced` · `finalizeMergedReadyForReview` · `mergePullRequest` · `rebasePreservedBranchOntoMain` |
| artifacts, demo paths and budgets | `CostCeilingError` · `DEMO_JSON_BASENAME` · `DEMO_MD_BASENAME` · `OPERATOR_STOP_REASON` · `OperatorStopError` · `WedgeDetector` · `WedgeKillError` · `appendOperatorStopEvents` · `describeNodeAbort` · `operatorStopFilename` · `operatorStopPath` · `readOperatorStopRequest` · `reviewFindingsJsonPath` · `validateReviewFindings` · `wedgeKillRunnerError` · `worktreeDemoDir` · `worktreeDemoJsonPath` · `worktreeDemoRelDir` · `writeReleaseJson` · `writeReviewFindingsJson` |
| route factories the assembly plugs in | `applyPlanVerdict` · `applyReviewVerdict` · `handleHookRoutes` · `handleRecoveryRoutes` · `handleStudioPostRoutes` |
| the review-comments sidecar | `REVIEW_COMMENTS_MAX` · `reviewCommentsPath` · `readReviewComments` · `writeReviewComments` · `appendReviewComment` · `resolveComment` · `editComment` · `deleteComment` · `deriveVerdictFromComments` |
| studio flow surface | `deriveFlowKickoff` · `validateFlow` · `validateArtifactRef` · `listFlowIds` · `serializeFlowDefinition` |

### Types

`ClosureResult` · `CouplingPair` · `CronTriggerPayload` · `CycleInput` · `CycleOutcome` · `DispatchOutcome` · `FlowRunArgs` · `FlowRunRequest` · `LintStatus` · `MergeConflictDetail` · `MergeGateEvidence` · `MergeGateResult` · `MergeQueue` · `NodeExecContext` · `NodeKind` · `NodeRunState` · `PushResult` · `QueuePaths` · `QueueState` · `ReflectMode` · `ReflectionStatus` · `ReflectorPhaseResult` · `ReleaseFinalizeHookInput` · `ReleaseFinalizePhaseResult` · `ReviewFinding` · `ReviewFindingsRecord` · `ReviewerOutcome` · `Run` · `StudioPostContext` · `TriggerCheckOpts` · `TriggerPayload` · `WebhookPushPayload` · `WorkItem` · `PhaseWiring` · `ReviewComment` · `AcceptanceCriterion` · `ReviewCommentsSidecar` · `NewReviewComment` · `DerivedVerdict` · `CycleMetrics` · `FlowHeadShape` · `ReviewFindingsExpectation` · `CommitOrchestratedCaptureArtifactsResult` · `SkippedCaptureMedia` · `CostByClassRow` · `CostClass`

## Three things this door is not

**It is not a wildcard door any more.** `package.json` maps `"."`,
`"./testing"` and one literal production exception, `"./work-item.ts"` (bead
`forge-8vfn.5.31`) — every other deep path like `@forge/flows/manifest.ts` no
longer resolves. Every one of the 47 module paths that used to be reachable
under `@forge/flows/` was repointed to this door or, for the handful with no
production consumer outside this package (`CostTracker`,
`validateCompiledWorkItemSet`, `hasMergeGateConfigErrorMarker`,
`mergeGateConfigErrorPath`), moved behind `@forge/flows/testing` instead.
`"./work-item.ts"` is the one forced exception: `packages/agents/ralph/
runner.ts` needs `DEV_WORK_ITEM_ID_PATTERN`, but that file is also reached
from `@forge/agents/_adapters/claude/index.ts` — going through this door
there would load `flow-runner.ts`, which imports `@forge/agents` back,
closing a live cross-package cycle (`ReferenceError: Cannot access
'claudeAdapter' before initialization`, a real TDZ, not a bundler quirk).
`work-item.ts` itself only reaches `@forge/contracts`, so the deep path
breaks the cycle; same shape as `@forge/sessions`'s two forced literal paths.

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

## Crash and recovery

State lives in `_queue/` as directories, not rows (ADR 011). `claim()` renames
a manifest `pending → in-flight` with one `renameSync` — atomic, "the entire
claim mechanism" (`queue.ts:17-18,134-145`) — and drops a `.heartbeat`
sidecar (`writeHeartbeat`, `queue.ts:204-207`, a plain `writeFileSync`; only
its mtime is ever read, so a torn write is harmless). `recover()`
(`queue.ts:218-251`) sweeps `in-flight/` every scheduler tick and once,
un-guarded by try/catch, at daemon startup (`scheduler-sweeps.ts:104-124`),
renaming an item back to `pending` on a heartbeat >5 min stale or a manifest
whose `worktree_path` no longer exists. `claim`/`moveTo`
(`queue.ts:134-171`) also clear the heartbeat and any `<id>.stop`
operator-stop flag on every state transition, so a stale flag can never
outlive its halt or meet a fresh cycle of the same id
(`operator-stop.ts:30-36`).

Manifest frontmatter (`resume_from`, cost ceilings) is a plain
`writeFileSync`, not tmp+rename (`manifest.ts:518-573`) — a crash mid-write
can truncate it — and every `persistManifest*` writer except one is
best-effort. The exception, `persistManifestSendBack`
(`manifest.ts:618-623`), throws instead of swallowing: it runs under a
caller-held `proper-lockfile` lock (`bridge-studio-runs-review.ts:364`), and
a send-back the manifest doesn't durably record would leave its fix
work-items undrainable. The daemon-crash story itself is
`persistManifestResumeFromIntegrate` (`manifest.ts:564-573`): once every WI
is `complete` but the post-develop band hasn't finished, it stamps
`resume_from: integrate` on the manifest *before* a crash can happen, so the
recovery sweep's rename-to-`pending` plus that pre-set marker resumes at
`integrate` rather than re-running PM + the whole dev-loop. `resume_from`
(ADR 019, `manifest.ts:161-167`) also takes `plan | develop | pr-open`;
`inferRequeueResume` (`requeue-resume.ts`) derives it from the prior
`failure_classification` event when a WI died mid-cycle instead, and
`rebaseForResume` (`cycle-helpers.ts:80-103`) rebases the preserved branch
onto current `main` at re-entry, preserving `.forge/work-items` across the
rebase and failing closed on a conflict rather than guessing a merge. A crash
during post-merge reflection is recorded (`REFLECTION_LOST_EVENT`,
`finalize-merged.ts`) and recovered via `forge reflect --rerun`, never
auto-retried.

Tests: `packages/flows/tests/integration/queue.test.ts` (claim/heartbeat/recover/moveTo),
`packages/flows/tests/integration/reentry-rebase.test.ts` + `resume-rebase.test.ts`
(rebase at re-entry), `packages/flows/tests/integration/requeue-resume.test.ts` (resume
inference), `packages/flows/tests/unit/operator-stop.test.ts` (stop-flag lifecycle).

## What was here before

This file did not exist, and `index.ts` was `export {}` from the M2 skeleton
until M4-flows. The comment on that empty export called it "honest". It was
honest about the skeleton and dishonest about the package: 131 symbols were
already crossing the package boundary through deep specifiers, so the public
surface existed — it simply had no door, no document, and no test that could
tell the difference between a populated index and an empty one. That is what
`contract.test.ts` now makes falsifiable.
