/**
 * `@forge/sessions` — the public door.
 * Owns ONE seam (`SPEC.md` §5): run one interactive session. Everything below
 * is either that seam or something another package genuinely needs to reach it;
 * the test that holds this file honest is `contract.test.ts` beside it, which
 * reads the API list out of `README.md` at run time and fails against an empty
 * index (T1 ruling 31).
 *
 * This file was `export {}` for the whole campaign. That was honest when the
 * package was an M2 skeleton and stopped being honest the moment eighteen
 * modules had external importers: every claim about "the public API of this
 * package" was unfalsifiable, an importer following the README got `undefined`,
 * and no test could tell.
 *
 * WHAT IS DELIBERATELY NOT HERE. The bridge host's body helpers (policy is the
 * host's — a route arm uses `ctx.readBody()`), kernel's id vocabulary (those are
 * kernel's names), and the manifest functions (they are `packages/flows`', taken
 * through `ArchitectManifestPorts`).
 */
export { DEFAULT_STALL_CEILING_MS, extractErrorMessage, isTurnAlive, killTrackedRun, sessionLogDirName } from './bridge-studio-lifecycle.ts';
export type { SpawnTurnOutcome } from './bridge-studio-session-helpers.ts';
export { InteractiveFinalizerError } from './interactive-finalizers.ts';
export { runInteractiveTurn } from './interactive-runner.ts';
export type { InteractiveTurnStatus, RunInteractiveTurnResult } from './interactive-runner.ts';
export { REDACTED_THINKING_MARKER, readSessionStatus, writeSessionStatus } from './interactive-session.ts';
export type { QueryFn } from './interactive-session.ts';
export type { ArchitectManifestPorts } from './kinds/architect-ports.ts';
export { ARCHITECT_MODEL, architectAgentSpec, buildManifest, listArchitectSessions, readArchitectSessionStats, runArchitectTurn } from './kinds/architect.ts';
// `QueryFn` is DEFINED in `interactive-session.ts` and re-exported by
// `kinds/architect.ts` as a convenience for its own importers. The door
// takes it from the module that defines it — exporting both would be a
// duplicate identifier, and a door should not have two names for one type.
export type { ArchitectStatus, DraftInitiative } from './kinds/architect.ts';
export { runBrainFixTurn } from './kinds/brain-fix.ts';
export { DEMO_HTML_REL_PATH, demoSessionDir, demoTaskLines } from './kinds/demo-builder.ts';
export type { DemoBuilderStatus } from './kinds/demo-builder.ts';
export { instructionsSessionDir, runInstructionsTurn } from './kinds/instructions.ts';
export type { InstructionsStatus } from './kinds/instructions.ts';
export { SESSION_KIND_RUNNERS } from './kinds/registry.ts';
export { sessionsRoutes } from './routes.ts';
export type { SessionsRouteDeps } from './routes.ts';
export { parseGuardedEventsJsonl } from './session-readability.ts';
export { invalidProjectReason, sessionIsReadable } from './session-resolution.ts';
export { guardedReadSessionStatus, guardedWriteSessionStatus } from './session-status-io.ts';
export { validateSessionKinds } from './studio/session-kinds-validate.ts';
export { SESSION_STAGES, loadSessionKinds } from './studio/session-kinds.ts';
export type { SessionKindDescriptor } from './studio/session-kinds.ts';
export { deriveSessionArtifact, safeReadFileInSession } from './studio/session-transcript.ts';
export type { ContractStage, ContractStageRow, ContractStageStatus, ParseManifestPort } from './studio/session-transcript.ts';
