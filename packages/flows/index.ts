/**
 * `@forge/flows` — the public door.
 *
 * Owns ONE seam (`SPEC.md` §2): the **Station** — run a flow, node by node,
 * against a `PhaseExecutor` port. Everything below is either that seam or
 * something another package genuinely needs to reach it. The test that holds
 * this file honest is `contract.test.ts` beside it, which reads the API list
 * out of `README.md` at run time and fails against an empty index
 * (T1 ruling 31).
 *
 * This door was `export {}` from the M2 skeleton until M4-flows populated it,
 * and the comment that stood here called that "honest". It was honest about
 * the skeleton and dishonest about the package: 47 module paths and 131
 * symbols were already being imported across the repo through deep specifiers,
 * so the public surface existed — it simply had no door, no document and no
 * test. The list below is that measured surface, not a wish.
 *
 * WHAT IS DELIBERATELY NOT HERE. The phase executors themselves
 * (`packages/factory/phases/*`) are factory's, not flows'; this package declares
 * the PORT they satisfy and never names one. `InitiativeManifest` and its two
 * unions live in `@forge/contracts` (ruling 81) and are re-exported by
 * `manifest.ts` for its own callers — the manifest TYPE is shared vocabulary
 * and this door does not claim it, exactly as `@forge/agents` declines to
 * re-export kernel's id rules.
 */


// ---- Run one flow — the Station engine (SPEC.md §2, ADR 028) ---------------
export { type FlowRunArgs, flowPathForId, resolveNodeKind, runFlow } from './flow-runner.ts';
export { type NodeExecContext } from './flow-node-context.ts';
export { type NodeKind } from './flow-node-kind.ts';
export { findFanOutViolations } from './flow-fanout.ts';
export { listFlowBandIds } from './flow-band-vocab.ts';
export { loadFlowDefinition, loadStarterFlow } from './studio/flow-registry.ts';
export { type TriggerCheckOpts, checkFlowTriggers } from './studio/validate-triggers.ts';

// ---- The cycle the develop flow runs ---------------------------------------
export { resolveCostCeilingOverride } from './cycle.ts';
export { type ClosureResult, type CycleInput, type CycleOutcome, type LintStatus, REFLECTION_LOST_EVENT, REFLECT_MODE_FILE, type ReflectMode, type ReflectionStatus, type ReflectorPhaseResult, type ReleaseFinalizePhaseResult, type ReviewerOutcome, recordBrainGateResult } from './cycle-context.ts';
export { type MergeGateResult, type MergeGateEvidence, assertNonEmptyDelivery, commitDevLoopBoundary, enforceDevLoopCloseInvariant, enforceFinalCiGate, openPrInline, preservingForgeScratch, runMergeBoundaryGate } from './cycle-helpers.ts';
export { promoteMergedToDone, runClosure } from './phases/closure.ts';
export { CAPTURE_NONCE_ENV, buildDemoCaptureArgv, commitOrchestratedCaptureArtifacts, demoJsonWantsCapture, generateCaptureNonce, preflightDemoCaptureCommands, resolveDemoCaptureTimeoutMs, runOrchestratorCommand } from './phases/orchestrated-capture.ts';
export { compileWorkItemSpecs } from './phases/wi-spec-compile.ts';

// ---- Queue state machine, manifests and initiatives ------------------------
export { type QueuePaths, type QueueState, getPaths, listInFlight } from './queue.ts';
export { DERIVED_CEILING_MARGIN_SHARE, initiativeTitle, mintAndPersistManifestCycleId, parseManifest, persistManifestCostCeiling, persistManifestSpecs, serializeManifest } from './manifest.ts';
export { isContainedProjectRepoPath, isSafeProjectName } from './manifest-path-guard.ts';
export { promoteManifests } from './promote-manifests.ts';
export { listPlannedInitiatives } from './planned-initiatives.ts';
export { mintTriggeredInitiative } from './mint-triggered-initiative.ts';

// ---- Work items and their worktrees ----------------------------------------
export { type CouplingPair, DEV_WORK_ITEM_ID_PATTERN, WORK_ITEM_FILE_PATTERN, type WorkItem, type RequiredPathsSource, gateRequiredPaths, parseWorkItem, readWorkItemsFromDir, serializeWorkItem, topologicalOrder, validateWorkItemSet, writeWorkItem, writeWorkItemStatus } from './work-item.ts';
export { createWiWorktree, removeWiWorktree, wiWorktreePath } from './wi-worktree.ts';
export { type MergeConflictDetail, type MergeQueue, createMergeQueue, mergeAndPublish, mergeWiIntoCycle } from './wi-merge-back.ts';
export { type DispatchOutcome, runConcurrentDispatch } from './wi-dispatch-scheduler.ts';
export { reviewCapExhaustedPath, writeMergeGateConfigErrorMarker, writeReviewCapExhaustedMarker } from './fix-work-items.ts';
export { enqueueGateFixWorkItems } from './gate-fix-loop.ts';

// ---- Triggers and staged flow runs -----------------------------------------
export { TRIGGER_KIND_IDS, fireAgentCompleteTriggers } from './flow-trigger.ts';
export { type CronTriggerPayload, REPO_RE, type TriggerPayload, type WebhookPushPayload } from './trigger-payload.ts';
export { type FlowRunRequest, drainFlowRunRequests, listFlowRunRequests, stageFlowRunRequest } from './flow-run-requests.ts';
export { enqueueDevelopRun } from './enqueue-develop-run.ts';
export { enqueueFlowRun } from './enqueue-flow-run.ts';
export { PLAN_FLOW_ID, enqueuePlanRun } from './enqueue-plan-run.ts';

// ---- Scheduler and daemon --------------------------------------------------
export { checkInitiativeDeps, serve } from './scheduler.ts';
export { decideAutoRetry } from './scheduler-dispatch.ts';
export { clearPidFile, daemonPaths, daemonState, isAlive, isPaused, markStopping, pausedFlagPath, readPid, setPaused, spawnServeDetached, writePidFile } from './daemon.ts';

// ---- The run model the UI reads --------------------------------------------
export { type Run, buildAgentSlugToNodeId, buildNodeMapping } from './run-model.ts';
export { eventToNodeId } from './run-model-derive.ts';
export { _resetRunListCacheForTest, cachedListRuns } from './run-list-cache.ts';

// ---- Git and PR mechanics --------------------------------------------------
export { type PushResult, assertLocalRemoteSynced, checkLocalRemoteSynced, mergePullRequest, rebasePreservedBranchOntoMain } from './pr.ts';
export { add } from './worktree.ts';
export { finalizeMergedReadyForReview } from './finalize-merged.ts';

// ---- Artifacts, demo paths and budgets -------------------------------------
export { type ReviewFinding, type ReviewFindingsRecord, reviewFindingsJsonPath, validateReviewFindings, writeReleaseJson, writeReviewFindingsJson } from './flow-artifacts.ts';
export { DEMO_JSON_BASENAME, DEMO_MD_BASENAME, worktreeDemoDir, worktreeDemoJsonPath, worktreeDemoRelDir } from './demo-paths.ts';
export { CostCeilingError, WedgeDetector, WedgeKillError } from './flow-budgets.ts';

// ---- Route factories the assembly plugs in (ruling 59) ---------------------
export { handleHookRoutes } from './bridge-hooks.ts';
export { handleRecoveryRoutes } from './bridge-recovery.ts';
export { type ReleaseFinalizeHookInput, type StudioPostContext, applyPlanVerdict, applyReviewVerdict, handleStudioPostRoutes } from './bridge-studio-runs.ts';
