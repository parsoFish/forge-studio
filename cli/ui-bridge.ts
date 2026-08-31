/**
 * forge-ui-bridge — small Node process that surfaces forge's durable
 * artefacts (events.jsonl + queue dirs) to the browser-side forge-ui
 * over a single WebSocket connection.
 *
 * Started by `forge watch`; outlives no individual cycle. On client
 * connect it sends a snapshot of the current cycle list + recent events,
 * then keeps a tail open on every in-flight cycle's events.jsonl and
 * pushes new lines as they arrive.
 *
 * Stage M2-A scope (read-only):
 *   - GET  /api/health           → 'ok'
 *   - GET  /api/cycles           → { live: Cycle[], recent: Cycle[] }
 *   - GET  /api/events/<cycleId> → full events.jsonl as JSON array
 *   - WS   /ws                   → { type: 'snapshot', ... } once;
 *                                  then { type: 'event', cycleId, event } per new log line;
 *                                  then { type: 'cycle-list-changed' } on queue changes.
 *
 * M2-C adds POST handlers for verdicts (file writes guarded by proper-lockfile).
 */

import { createServer, type IncomingMessage, type ServerResponse, type OutgoingHttpHeaders } from 'node:http';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  watch as fsWatch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve, sep, basename, dirname } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import { getPaths, listInFlight } from '@forge/flows/queue.ts';
import { parseManifest, persistManifestCostCeiling } from '@forge/flows/manifest.ts';
import { enqueueDevelopRun } from '@forge/flows/enqueue-develop-run.ts';
import { enqueuePlanRun } from '@forge/flows/enqueue-plan-run.ts';
import { enqueueFlowRun } from '@forge/flows/enqueue-flow-run.ts';
import {
  readReviewComments,
  writeReviewComments,
  appendReviewComment,
  resolveComment,
  editComment,
  deleteComment,
  deriveVerdictFromComments,
  reviewCommentsPath,
  isSafeCycleId,
  REVIEW_COMMENTS_MAX,
} from '@forge/factory/review-comments.ts';
import lockfile from 'proper-lockfile';
import {
  handleStudioRoutes,
  handleStudioWriteRoutes,
  sanitizeError,
  sendJson,
  allowedOrigin,
  CSRF_HEADER,
  SAFE_ID_RE,
  LEGACY_SESSION_TERMINAL_PHASES,
  pathOnly,
  parseQuery,
} from './bridge-studio.ts';
import { KB_ID_RE, PROJECT_ID_RE, MAX_EXACT_ID_LENGTH } from '../orchestrator/studio/validate.ts';
import {
  handleStudioKbRoutes,
  loadKbDescriptors,
  computeAgentCleanupFindings,
  KB_SEEDING_ANCHOR_PREFIX,
} from '@forge/knowledge/bridge-studio-kbs.ts';
import { handleStudioKbDrainRoutes } from '@forge/knowledge/bridge-studio-kb-drain.ts';
import { deriveKbActiveJob, activeJobReason } from '@forge/knowledge/kb-job-state.ts';
import { handleStudioSkillsRoutes } from '@forge/library/bridge-studio-skills.ts';
import { handleStudioHooksRoutes } from '@forge/library/bridge-studio-hooks.ts';
import { handleStudioAuthoringRoutes } from '@forge/library/bridge-studio-authoring.ts';
import { handleStudioTemplatesRoutes } from '@forge/library/bridge-studio-templates.ts';
import { handleStudioSessionsRoutes, isTerminalPhase, sessionIsReadable, sessionShellHref } from '@forge/sessions/bridge-studio-sessions.ts';
import { parseGuardedEventsJsonl } from '@forge/sessions/session-readability.ts';
import { handleStudioAffordanceRoutes, MAX_ANSWER_FIELD_BYTES, type SpawnTurnOutcome } from './bridge-studio-affordances.ts';
import { handleSessionCancelRoute } from '@forge/sessions/bridge-studio-session-cancel.ts';
import {
  deriveSessionLifecycleFor, sessionLogDirName, sessionHeartbeatMtimeMs, killTrackedRun,
  type SessionLifecycleState, type SessionLifecycle,
  // W8-A2 (ON-7 defect 4) — reused for the standalone-run stalled
  // derivation (`readStandaloneLivenessFacts`/`applyStandaloneStaleness`
  // below): the SAME stall ceiling, ownership-proof liveness check, and
  // crash-message extraction sessions already use — never a second,
  // independently-invented staleness rule.
  DEFAULT_STALL_CEILING_MS, isTurnAlive, extractErrorMessage,
} from '@forge/sessions/bridge-studio-lifecycle.ts';
import { handleStudioInstructionsRoutes } from '@forge/library/bridge-studio-instructions.ts';
import { handleStudioAgentCapabilityRoute } from '@forge/sessions/bridge-studio-agent-capability.ts';
import { handleStudioConnectionsRoutes } from '@forge/library/bridge-studio-connections.ts';
import { handleStudioCommunityRoutes } from '@forge/library/bridge-studio-community.ts';
import { handleRecoveryRoutes } from '@forge/flows/bridge-recovery.ts';
import { handleHookRoutes } from '@forge/flows/bridge-hooks.ts';
import {
  handleStudioPostRoutes,
  applyReviewVerdict,
  applyPlanVerdict,
  type StudioPostContext,
  type ReleaseFinalizeHookInput,
} from '@forge/flows/bridge-studio-runs.ts';
import { runReleaseFinalize } from '@forge/factory/phases/release-finalize.ts';
import { isDryBridge, refuseDryBridge, emitDryBridgeRefusal, dryBridgeAgentTurnMarker } from './dry-bridge.ts';
import { parseWorkItem, DEV_WORK_ITEM_ID_PATTERN } from '@forge/flows/work-item.ts';
import { daemonState, setPaused, readPid, isAlive, clearPidFile, daemonPaths, spawnServeDetached, markStopping } from '@forge/flows/daemon.ts';
import { mergePullRequest } from '@forge/flows/pr.ts';
import type { BridgeIdentity } from '../apps/forge/forge-watch.ts';
import { finalizeMergedReadyForReview } from '@forge/flows/finalize-merged.ts';
import { createLogger, type EventLogEntry } from '@forge/kernel';
import { reconcileReflectFeedback, type RerunReflectorFn } from '@forge/factory/reflect-reconcile.ts';
import {
  listArchitectSessions,
  guardedReadStatus,
  guardedWriteStatus,
  type ArchitectStatus,
  type ArchitectQuestion,
} from '@forge/sessions/architect-runner.ts';
import {
  DRAFT_FILENAME,
  type InstructionsStatus,
} from '@forge/sessions/instructions-runner.ts';
import {
  DEMO_HTML_REL_PATH,
  GENERATIONS_DIRNAME,
  type DemoBuilderStatus,
} from '@forge/sessions/demo-builder-runner.ts';
import { safeReadFileInSession } from '@forge/sessions/studio/session-transcript.ts';
import { resolveContainedProjectDir } from '@forge/projects/contract-stages.ts';
import {
  type ProjectBrainStatus,
} from '../orchestrator/project-brain-builder-runner.ts';
import { isSafeRunId } from '@forge/agents/run-agent.ts';
import { resolveDispatchableAgent } from '@forge/agents/agent-dispatch.ts';
import { listAgentDefinitions, loadFlowDefinition, discoverProjects } from '../orchestrator/studio/registry.ts';
import {
  agentAcceptsMaterial,
  materialKindForFilename,
  MAX_MATERIALS_COUNT,
  MAX_MATERIAL_BYTES,
  MAX_MATERIALS_TOTAL_BYTES,
} from '@forge/agents/studio/materials.ts';
import { stageMaterials, MaterialsStagingError } from '@forge/agents/materials-staging.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import { skillsDir, MAX_SKILL_ID_LENGTH, skillPathRelative } from '@forge/agents/skill-path.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { resolveSessionModel, type ModelTier } from '@forge/agents/phase-agent.ts';
import { unreadyConnectionsFor, formatUnreadyConnections } from '@forge/agents/studio/connection-run-gate.ts';
import {
  guardedReadSessionStatus,
  guardedWriteSessionStatus,
  type InterviewQuestion,
} from '@forge/sessions/interactive-session.ts';
import { readAgentInstructionsFile } from '@forge/projects/project-config.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir, MAX_KICKOFF_COST_CEILING_USD } from '@forge/kernel';
import { isContainedProjectRepoPath } from '@forge/flows/manifest-path-guard.ts';
import { buildAgentSlugToNodeId, type Run } from '@forge/flows/run-model.ts';
import { cachedListRuns } from '@forge/flows/run-list-cache.ts';
import { loadSessionKinds, type SessionKindDescriptor } from '@forge/sessions/studio/session-kinds.ts';
import { resolveGuardedPath, guardedFile, guardedReadFile, guardedWriteFile, guardedReadDir, isSafeSegment, isSafeSubPath } from '@forge/kernel';
import { fixedTierForSessionKind } from '@forge/sessions/session-model-tier.ts';


/** W7-D1: the ONE artifact `deriveArtifacts` also resolves from the cycle-log
 *  root, for frozen cycles written before the mirror-into-`artifacts/` change.
 *  Kept as a named constant so the route and the deriver's own comment name the
 *  same single file, and so widening it is a deliberate edit rather than a
 *  string that quietly grows. */
const LEGACY_ROOT_ARTIFACT = 'pr-description.md';

const TAIL_POLL_MS = 200;
const RECENT_CYCLES_MAX = 20;
// R6-04 WI-4 — GET /api/agents/runs/<runId>'s `lines` field cap. A fixed
// cap (not a proportion of the log size) so a runaway log is never served
// whole; the TAIL (most-recently-written lines) is preserved when capping,
// so a long-running run's log view never looks frozen at dispatch.
const RUN_LOG_LINES_MAX = 500;
// Feature #8 — daemon-stall liveness. Mirrors orchestrator/scheduler.ts's
// staleHeartbeatMs default (5min). The UI flips to `daemon-stalled` only at a
// GENEROUS multiple of that so a slow-but-alive cycle never false-alarms — the
// stall surface is for "the daemon process is wedged / dead", not slowness.
const DEFAULT_STALE_HEARTBEAT_MS = 5 * 60_000;
const STALL_MULTIPLE = 6;

type Cycle = {
  cycleId: string;
  initiativeId: string;
  project?: string;
  // R4-11-F1: `merged` is the transient pass-through state a confirmed-merge
  // manifest briefly occupies between closure's two terminal moves (→merged,
  // then merged→done in the same sweep) — distinct from the unrelated
  // `CycleOutcome`/`CycleResult.status` `'merged'` VALUE (an event outcome).
  status: 'in-flight' | 'ready-for-review' | 'merged' | 'done' | 'failed' | 'pending';
  startedAt?: string;
  endedAt?: string;
  /** Feature #10: cross-initiative dependency edges (manifest
   *  `depends_on_initiatives`) — drives the UI's per-project roadmap spine. */
  dependsOnInitiatives?: string[];
};

type WsOutbound =
  | { type: 'snapshot'; cycles: { live: Cycle[]; recent: Cycle[] } }
  | { type: 'event'; cycleId: string; event: EventLogEntry }
  | { type: 'cycle-list-changed' }
  // ADR 020 — an architect session changed (started, new questions, plan ready,
  // committed). The UI re-fetches `/api/architect/sessions`.
  | { type: 'architect-list-changed' }
  // Stage A — an instructions-creator session changed (started, new questions,
  // draft ready, committed). The UI re-fetches `/api/instructions/sessions`.
  | { type: 'instructions-list-changed' }
  // Stage B — a demo-builder session changed (started, regenerated, awaiting
  // review, locked, abandoned). The UI re-fetches `/api/demo-builder/sessions`.
  | { type: 'demo-list-changed' }
  | { type: 'project-brain-list-changed' };

export type BridgeOptions = {
  forgeRoot: string;
  port?: number;
  /** Pre-existing snapshot of cycles — defaults to filesystem scan. */
  scanCycles?: () => { live: Cycle[]; recent: Cycle[] };
  /**
   * Injectable for tests — defaults to the real `mergePullRequest` from
   * orchestrator/pr.ts. Called by the POST /api/verdict 'approve' handler.
   */
  mergePr?: (worktreePath: string) => boolean;
  /**
   * Injectable for tests — defaults to the real `finalizeMergedReadyForReview`
   * from orchestrator/finalize-merged.ts. Fired (void, non-blocking) on approve.
   */
  finalizeAfterMerge?: (deps: { queueRoot: string; logsRoot: string }) => Promise<unknown>;
  /**
   * WS-A (release) — injectable for tests; defaults to a wrapper around the real
   * `runReleaseFinalize` phase. Called on approve, AWAITED immediately BEFORE
   * mergePr. Opt-in (skips when the project has no `releaseProcess`) and
   * log-and-continue (a failure never blocks the merge).
   */
  runReleaseFinalize?: (input: ReleaseFinalizeHookInput) => Promise<{ release_status: string }>;
  /**
   * D — injectable for tests; defaults to the real `rerunReflector` from
   * orchestrator/reflector-rerun.ts. Fired (non-blocking) when operator
   * reflection feedback is submitted, and at startup for any cycle whose
   * feedback out-dates its last reflector.end.
   */
  rerunReflector?: RerunReflectorFn;
};

type TailState = {
  cycleId: string;
  filePath: string;
  offset: number;
  timer?: NodeJS.Timeout;
};

export async function startBridge(opts: BridgeOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const { forgeRoot } = opts;
  // F1: a stable identity for this bridge process, captured once at startup
  // and served from GET /api/health, so a second `forge studio` can recognise
  // a healthy forge bridge and ATTACH read-only instead of killing it.
  const identity: BridgeIdentity = {
    service: 'forge-bridge',
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  const port = opts.port ?? 0; // 0 = OS-assigned
  // getPaths takes the QUEUE ROOT, not the forge root — _queue/ is a
  // child of forgeRoot.
  const queuePaths = getPaths(resolve(forgeRoot, '_queue'));
  const logsRoot = resolve(forgeRoot, '_logs');
  // R4-17 round-2 BLOCKER: this was a hardcoded `resolve(forgeRoot,'projects')`
  // — the ONE module of eight that never consulted config, while 23 sites
  // elsewhere resolve through `resolveProjectsDir` (which honours
  // `FORGE_PROJECTS_DIR` and `forge.config.json`'s documented `projectsDir`,
  // orchestrator/config.ts). With that config set, this producer and
  // `writeSessionTerminalPhase`'s containment guard resolved DIFFERENT roots, so
  // a legitimately-created session dir failed the guard and the terminal phase
  // was silently never written — a finished run reading `running` forever. A
  // guard that resolves its root differently from the producer of the thing it
  // guards is a false-rejection generator; the fix is one value, not two
  // independent resolutions that happen to coincide in the default config.
  //
  // R4-17 round-3 BLOCKER (pin 5, item 2): `loadConfig()`'s no-arg default is
  // cwd-relative (`resolve('forge.config.json')` against `process.cwd()`),
  // not `forgeRoot`-relative — a caller started from a different cwd would
  // silently fall back to `{}` even with a real `forge.config.json` sitting
  // in `forgeRoot`. `defaultConfigPath(forgeRoot)` removes that dependence.
  const projectsRoot = resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot)));
  const mergePrFn = opts.mergePr ?? mergePullRequest;
  const finalizeAfterMergeFn = opts.finalizeAfterMerge ?? finalizeMergedReadyForReview;
  // WS-A (release): the default release-finalize hook constructs a per-cycle
  // logger and delegates to the real phase. Opt-in + log-and-continue live
  // inside `runReleaseFinalize` itself; this wrapper only wires the logger.
  const runReleaseFinalizeFn =
    opts.runReleaseFinalize ??
    (async (input: ReleaseFinalizeHookInput): Promise<{ release_status: string }> => {
      const logger = createLogger(input.cycleId, logsRoot);
      return runReleaseFinalize(input, logger);
    });
  // D — auto-rerun the reflector on operator feedback. Default delegates to the
  // real helper; the POST handler + startup reconcile both call this.
  const rerunReflectorFn: RerunReflectorFn =
    opts.rerunReflector ??
    ((input) => import('@forge/factory/reflector-rerun.ts').then((m) => m.rerunReflector(input)));
  // Recover feedback that landed while the bridge was down (or whose live rerun
  // was lost to a restart): re-run the reflector for any cycle whose RECENT
  // user-feedback.md out-dates its last reflector.end. Fire-and-continue — never
  // blocks the server coming up. Skipped in no-spawn mode (seeded e2e/journey
  // runs set FORGE_ARCHITECT_NO_SPAWN=1; the reconcile spawns reflectors, so it
  // honours the same guard as spawnAgentTurn — no surprise agent runs there).
  // R5-01-F1: dry-bridge suppresses this startup spawn path independently too —
  // there is no HTTP response at boot, so the JSONL event IS the typed refusal.
  if (isDryBridge()) {
    emitDryBridgeRefusal({ route: 'startup:reflect-reconcile', method: 'BOOT', action: 'spawn-agent', logsRoot });
  } else if (process.env.FORGE_ARCHITECT_NO_SPAWN !== '1') {
    void reconcileReflectFeedback({
      logsRoot,
      queueRoot: queuePaths.root,
      rerunReflector: rerunReflectorFn,
      log: (msg) => console.error(`[bridge] ${msg}`),
    }).catch((err) => console.error(`[bridge] reflect reconcile failed: ${String(err)}`));
  }

  const clients = new Set<WebSocket>();
  const tails = new Map<string, TailState>();
  const queueWatchers: FSWatcher[] = [];
  const architectWatchers: FSWatcher[] = [];
  const instructionsWatchers: FSWatcher[] = [];
  const demoWatchers: FSWatcher[] = [];

  const broadcast = (msg: WsOutbound): void => {
    const payload = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(payload); } catch { /* dropped client */ }
      }
    }
  };

  const scanCycles = opts.scanCycles ?? ((): { live: Cycle[]; recent: Cycle[] } => {
    // The cycle ID is the _logs/<dir> name (timestamp + initiative ID); the
    // queue dirs only carry status. This scan walks _logs/ first to build
    // a list of cycles (most-recent per initiative), then cross-references
    // queue dirs to label each with its current status.
    const live: Cycle[] = [];
    const recent: Cycle[] = [];

    type LogDirInfo = { cycleId: string; initiativeId: string; mtime: number };
    const latestPerInit = new Map<string, LogDirInfo>();
    if (existsSync(logsRoot)) {
      for (const name of readdirSync(logsRoot)) {
        const dir = join(logsRoot, name);
        let mtime = 0;
        try {
          if (!statSync(dir).isDirectory()) continue;
          mtime = statSync(dir).mtimeMs;
        } catch { continue; }
        // Cycle ID format: `<ISO-ish-timestamp>_<INIT-…>`.
        const m = name.match(/_(INIT-.+)$/);
        if (!m) continue;
        const initId = m[1];
        const cur = latestPerInit.get(initId);
        if (!cur || cur.mtime < mtime) {
          latestPerInit.set(initId, { cycleId: name, initiativeId: initId, mtime });
        }
      }
    }

    const queueStatusFor = (initId: string): { status: Cycle['status']; project?: string; dependsOnInitiatives?: string[] } | null => {
      const fn = `${initId}.md`;
      const lookups: Array<[string, Cycle['status']]> = [
        [queuePaths.inFlight, 'in-flight'],
        [queuePaths.readyForReview, 'ready-for-review'],
        // R4-11-F1: `merged` — the brief pass-through window between a
        // confirmed merge and its promotion to `done/` in the same sweep.
        [queuePaths.merged, 'merged'],
        [queuePaths.done, 'done'],
        [queuePaths.failed, 'failed'],
        [queuePaths.pending, 'pending'],
      ];
      for (const [dir, status] of lookups) {
        const fp = join(dir, fn);
        if (existsSync(fp)) {
          let project: string | undefined;
          let dependsOnInitiatives: string[] | undefined;
          try {
            const m = parseManifest(readFileSync(fp, 'utf8'));
            project = m.project;
            dependsOnInitiatives = m.depends_on_initiatives;
          } catch { /* ignore */ }
          return { status, project, dependsOnInitiatives };
        }
      }
      return null;
    };

    const candidates: Array<{ cycle: Cycle; mtime: number }> = [];
    for (const info of latestPerInit.values()) {
      const q = queueStatusFor(info.initiativeId);
      if (!q) continue; // log dir exists but the queue manifest is gone — orphan, skip
      candidates.push({
        cycle: {
          cycleId: info.cycleId,
          initiativeId: info.initiativeId,
          project: q.project,
          status: q.status,
          dependsOnInitiatives: q.dependsOnInitiatives,
        },
        mtime: info.mtime,
      });
    }
    // Also surface in-flight / ready-for-review manifests that don't yet
    // have a log dir (just-claimed, pre-first-event).
    const seenInits = new Set([...candidates.map((c) => c.cycle.initiativeId)]);
    for (const name of listInFlight(queuePaths)) {
      const id = name.replace(/\.md$/, '');
      if (seenInits.has(id)) continue;
      let project: string | undefined;
      let dependsOnInitiatives: string[] | undefined;
      try {
        const m = parseManifest(readFileSync(join(queuePaths.inFlight, name), 'utf8'));
        project = m.project;
        dependsOnInitiatives = m.depends_on_initiatives;
      } catch { /* */ }
      candidates.push({
        cycle: { cycleId: id, initiativeId: id, project, status: 'in-flight', dependsOnInitiatives },
        mtime: Date.now(),
      });
    }

    candidates.sort((a, b) => b.mtime - a.mtime);
    for (const { cycle } of candidates) {
      // R4-11-F1: `merged` deliberately classifies as RECENT, not live — it's
      // the tail end of a finished cycle finalizing (merged → done, same
      // finalize sweep), not an actively-running one. That sweep spans the
      // post-merge CI watch plus the reflector run, so a manifest legitimately
      // sits in `merged/` for minutes on every normal finalize, not
      // instantaneously.
      if (cycle.status === 'in-flight' || cycle.status === 'ready-for-review') {
        live.push(cycle);
      } else if (recent.length < RECENT_CYCLES_MAX) {
        recent.push(cycle);
      }
    }
    return { live, recent };
  });

  // Feature #8 — max heartbeat age across in-flight cycles, from the
  // `.heartbeat` file (mtime = last beat) the scheduler writes alongside each
  // in-flight manifest. Authoritative liveness signal; cheaper than scanning
  // every cycle's events. Never throws — a stat error skips that cycle.
  const computeLiveness = (): LivenessReport => {
    const staleHeartbeatMs = DEFAULT_STALE_HEARTBEAT_MS;
    const stallThresholdMs = staleHeartbeatMs * STALL_MULTIPLE;
    let maxAge = 0;
    let count = 0;
    const now = Date.now();
    for (const filename of listInFlight(queuePaths)) {
      const hbPath = join(queuePaths.inFlight, filename + '.heartbeat');
      if (!existsSync(hbPath)) continue;
      try {
        const age = now - statSync(hbPath).mtimeMs;
        count += 1;
        if (age > maxAge) maxAge = age;
      } catch { /* skip unreadable heartbeat */ }
    }
    return {
      inFlightCount: count,
      maxHeartbeatAgeMs: count > 0 ? maxAge : 0,
      staleHeartbeatMs,
      stallThresholdMs,
      stalled: count > 0 && maxAge > stallThresholdMs,
    };
  };

  const ensureTailFor = (cycleId: string): void => {
    if (tails.has(cycleId)) return;
    // Review round 1 (W7-B5): no client, no tail — the SAME rule
    // `startTailsForLive` states just below ("with no client there is nobody
    // to stream to"), applied at the one choke point every caller goes
    // through. Standalone agent runs made this load-bearing: a dispatch
    // arms a tail directly, so a run started with no browser attached used
    // to register a `setInterval` that `stopAllTails` — which only fires on
    // the LAST client disconnecting — would never be triggered to clear.
    // Self-healing: every caller (the status poll, session-detail routes,
    // startTailsForLive on connect) re-arms, and those only run while a UI
    // is open.
    if (clients.size === 0) return;
    const filePath = join(logsRoot, cycleId, 'events.jsonl');
    if (!existsSync(filePath)) return;
    const state: TailState = { cycleId, filePath, offset: 0 };
    state.timer = setInterval(() => pumpTail(state, (event) => broadcast({ type: 'event', cycleId, event })), TAIL_POLL_MS);
    tails.set(cycleId, state);
  };

  /** Release ONE tail (review round 1). A terminal run's `events.jsonl` is
   *  immutable and served on demand by `/api/events`, so a poller on it is
   *  pure waste — and `stopAllTails` is far too coarse to be the only
   *  release: it needs every WS client to disconnect, so a long Studio
   *  session that dispatched N agents carried N permanent pollers. */
  const stopTailFor = (cycleId: string): void => {
    const t = tails.get(cycleId);
    if (t === undefined) return;
    if (t.timer) clearInterval(t.timer);
    tails.delete(cycleId);
  };

  // W6-B2 — the ONE generalized session-tail activator, replacing the four
  // hand-enumerated `ensure<Kind>Tail` closures that used to live here
  // (ensureArchitectTail/ensureInstructionsTail/ensureDemoTail/
  // ensureProjectBrainTail — each an identical one-line wrapper around
  // `ensureTailFor(`_${prefix}-${sessionId}`)`, differing only in `prefix`).
  // `kind` is the session-kind id — session-kinds.yaml's own `descriptor.id`
  // for the generic `/api/studio/sessions/:kind/:id` route, or, for the four
  // legacy per-kind list routes below, `SPAWN_AGENT_SPECS[agentId].logPrefix`
  // (the SAME string: SPAWN_AGENT_SPECS's `logPrefix` values and the
  // session-kinds.yaml `id` values coincide for every spawnable kind —
  // 'demo-builder''s SPAWN_AGENT_SPECS KEY differs from its `logPrefix`
  // ('demo'), but that `logPrefix` is exactly the 'demo' session-kind id).
  // This is also the literal convention forge-ui's session-shell page
  // derives independently (`apps/studio/app/sessions/[kind]/[sessionId]/
  // page.tsx`: `` const cycleId = `_${kind}-${sessionId}` ``) — one naming
  // rule, three call sites, no second hand-kept mapping anywhere.
  //
  // No terminal-phase filter here (unlike the legacy per-kind list routes,
  // which skip already-terminal sessions before calling this): terminal
  // phases are a DIFFERENT closed vocabulary per kind (committed/rejected
  // for architect, locked/abandoned for demo, applied for kb-cleanup, ...) —
  // hardcoding that set here would be exactly the "second hand-kept mapping"
  // this generalization exists to remove. `ensureTailFor` is idempotent and
  // no-ops for a log dir that doesn't exist (never started) or is already
  // tailed; the only cost of tailing a terminal session is a bounded, cheap
  // poll that stops the moment every WS client disconnects (`stopAllTails`).
  const ensureSessionTail = (kind: string, sessionId: string): void => {
    ensureTailFor(`_${kind}-${sessionId}`);
  };

  // Tail only LIVE cycles (in-flight / ready-for-review), and only while at
  // least one browser is connected: a terminal cycle's log is immutable and
  // served on demand via /api/events, and with no client there is nobody to
  // stream to. This drops the idle cost from ~RECENT_CYCLES_MAX statSync polls
  // every TAIL_POLL_MS to zero when no UI is open, and to just the live set
  // otherwise. (Session tails — architect/instructions/demo-builder/
  // project-brain/authoring/kb-cleanup — are driven separately by
  // ensureSessionTail when the corresponding session-detail screen is open.)
  const startTailsForLive = (): void => {
    if (clients.size === 0) return;
    for (const c of scanCycles().live) ensureTailFor(c.cycleId);
  };

  const stopAllTails = (): void => {
    for (const t of tails.values()) if (t.timer) clearInterval(t.timer);
    tails.clear();
  };

  const watchQueue = (): void => {
    const dirs = [queuePaths.pending, queuePaths.inFlight, queuePaths.readyForReview, queuePaths.merged, queuePaths.done, queuePaths.failed];
    for (const d of dirs) {
      if (!existsSync(d)) continue;
      try {
        const w = fsWatch(d, { persistent: false }, () => {
          broadcast({ type: 'cycle-list-changed' });
          // A new cycle may have appeared; pick up its log if so.
          startTailsForLive();
        });
        queueWatchers.push(w);
      } catch { /* fs.watch unavailable */ }
    }
  };

  // ADR 020 — watch each project's `_architect/` dir (recursively where the
  // platform supports it) so the runner's file-checkpoint writes (questions,
  // PLAN, status) push a re-fetch signal to the UI. Mirrors `watchQueue`.
  const watchArchitect = (): void => {
    if (!existsSync(projectsRoot)) return;
    let projects: string[];
    try { projects = readdirSync(projectsRoot); } catch { return; }
    for (const name of projects) {
      const archDir = join(projectsRoot, name, '_architect');
      if (!existsSync(archDir)) continue;
      try {
        const w = fsWatch(archDir, { persistent: false, recursive: true }, () => {
          broadcast({ type: 'architect-list-changed' });
        });
        architectWatchers.push(w);
      } catch {
        // recursive watch unsupported — fall back to a non-recursive watch on
        // the _architect dir (catches new sessions; the UI re-fetches anyway).
        try {
          const w = fsWatch(archDir, { persistent: false }, () => {
            broadcast({ type: 'architect-list-changed' });
          });
          architectWatchers.push(w);
        } catch { /* fs.watch unavailable */ }
      }
    }
  };

  // Stage A — watch each project's `_instructions/` dir so the runner's
  // file-checkpoint writes (questions, AGENTS.draft.md, status) push a re-fetch
  // signal to the UI. Mirrors `watchArchitect`.
  const watchInstructions = (): void => {
    if (!existsSync(projectsRoot)) return;
    let projects: string[];
    try { projects = readdirSync(projectsRoot); } catch { return; }
    for (const name of projects) {
      const instrDir = join(projectsRoot, name, '_instructions');
      if (!existsSync(instrDir)) continue;
      try {
        const w = fsWatch(instrDir, { persistent: false, recursive: true }, () => {
          broadcast({ type: 'instructions-list-changed' });
        });
        instructionsWatchers.push(w);
      } catch {
        // recursive watch unsupported — fall back to a non-recursive watch on
        // the _instructions dir (catches new sessions; the UI re-fetches anyway).
        try {
          const w = fsWatch(instrDir, { persistent: false }, () => {
            broadcast({ type: 'instructions-list-changed' });
          });
          instructionsWatchers.push(w);
        } catch { /* fs.watch unavailable */ }
      }
    }
  };

  // Stage B — watch each project's `_demo/` dir so the runner's file-checkpoint
  // writes (status, DEMO.html generation) push a re-fetch signal to the UI.
  // Mirrors `watchInstructions`.
  const watchDemo = (): void => {
    if (!existsSync(projectsRoot)) return;
    let projects: string[];
    try { projects = readdirSync(projectsRoot); } catch { return; }
    for (const name of projects) {
      const demoDir = join(projectsRoot, name, '_demo');
      if (!existsSync(demoDir)) continue;
      try {
        const w = fsWatch(demoDir, { persistent: false, recursive: true }, () => {
          broadcast({ type: 'demo-list-changed' });
        });
        demoWatchers.push(w);
      } catch {
        // recursive watch unsupported — fall back to a non-recursive watch on
        // the _demo dir (catches new sessions; the UI re-fetches anyway).
        try {
          const w = fsWatch(demoDir, { persistent: false }, () => {
            broadcast({ type: 'demo-list-changed' });
          });
          demoWatchers.push(w);
        } catch { /* fs.watch unavailable */ }
      }
    }
  };

  const http = createServer((req, res) => {
    void handleHttp(req, res, {
      identity,
      scanCycles,
      liveness: computeLiveness,
      logsRoot,
      forgeRoot,
      queueRoot: queuePaths.root,
      projectsRoot,
      broadcastArchitectChanged: () => broadcast({ type: 'architect-list-changed' }),
      broadcastInstructionsChanged: () => broadcast({ type: 'instructions-list-changed' }),
      broadcastDemoChanged: () => broadcast({ type: 'demo-list-changed' }),
      broadcastProjectBrainChanged: () => broadcast({ type: 'project-brain-list-changed' }),
      // W6-B2 — the ONE generalized session tail, replacing
      // ensureArchitectTail/ensureInstructionsTail/ensureDemoTail/
      // ensureProjectBrainTail (see ensureSessionTail's own doc comment
      // above for the shared cycle-id derivation). Every kind's
      // session-detail GET activates it: the four legacy per-kind list
      // routes below (architect/instructions/demo-builder/project-brain),
      // plus the generic `/api/studio/sessions/:kind/:id` route
      // (bridge-studio-sessions.ts) for authoring and kb-cleanup, which have
      // no per-kind list route of their own.
      ensureSessionTail,
      // W7-B5 (agents-20) — the standalone-run tail activator. The runId is
      // its own `_logs/` directory name, so this is `ensureTailFor` direct.
      ensureAgentRunTail: ensureTailFor,
      releaseAgentRunTail: stopTailFor,
      mergePr: mergePrFn,
      finalizeAfterMerge: finalizeAfterMergeFn,
      runReleaseFinalize: runReleaseFinalizeFn,
      rerunReflector: rerunReflectorFn,
    });
  });
  const wss = new WebSocketServer({ server: http, path: '/ws' });

  const debugWs = process.env.FORGE_BRIDGE_DEBUG === '1';
  let connectionSeq = 0;
  wss.on('connection', (ws, req) => {
    clients.add(ws);
    const id = ++connectionSeq;
    if (debugWs) console.error(`[bridge] ws#${id} connect from ${req.socket.remoteAddress} clients=${clients.size}`);
    // A watcher is now connected — begin streaming the live cycles.
    startTailsForLive();
    ws.on('close', (code, reason) => {
      clients.delete(ws);
      if (clients.size === 0) stopAllTails();
      if (debugWs) console.error(`[bridge] ws#${id} close code=${code} reason="${reason.toString()}" remaining=${clients.size}`);
    });
    ws.on('error', (err) => {
      clients.delete(ws);
      if (clients.size === 0) stopAllTails();
      if (debugWs) console.error(`[bridge] ws#${id} error: ${err.message}`);
    });
    // Initial snapshot.
    try {
      ws.send(JSON.stringify({ type: 'snapshot', cycles: scanCycles() } satisfies WsOutbound));
    } catch { /* socket closed mid-send */ }
  });

  // Bind to all interfaces (0.0.0.0) — required for WSL2 port-forwarding
  // to pick the port up and expose it on Windows localhost. Wait for the
  // 'listening' event before calling address() — listen() is async and
  // server.address() returns null until the bind completes (which would
  // leave us reporting `port: 0` to callers).
  await new Promise<void>((resolveListen, rejectListen) => {
    http.once('error', rejectListen);
    http.once('listening', () => resolveListen());
    http.listen(port, '0.0.0.0');
  });
  // Live tails start lazily when the first browser connects (see the wss
  // 'connection' handler); at startup we only wire the cheap fs.watch signals.
  watchQueue();
  watchArchitect();
  watchInstructions();
  watchDemo();

  const close = async (): Promise<void> => {
    for (const w of queueWatchers) { try { w.close(); } catch { /* ignore */ } }
    for (const w of architectWatchers) { try { w.close(); } catch { /* ignore */ } }
    for (const w of instructionsWatchers) { try { w.close(); } catch { /* ignore */ } }
    for (const w of demoWatchers) { try { w.close(); } catch { /* ignore */ } }
    for (const t of tails.values()) { if (t.timer) clearInterval(t.timer); }
    tails.clear();
    for (const ws of clients) { try { ws.close(); } catch { /* ignore */ } }
    clients.clear();
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => http.close(() => r()));
  };

  const address = http.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return { url: `http://127.0.0.1:${actualPort}`, close };
}

// ---- HTTP handlers ---------------------------------------------------------

type LivenessReport = {
  /** in-flight cycles considered (those with a `.heartbeat` file). */
  inFlightCount: number;
  /** max heartbeat age across in-flight cycles, ms (0 when none in flight). */
  maxHeartbeatAgeMs: number;
  /** the project's stale threshold (default 5min). */
  staleHeartbeatMs: number;
  /** the generous stall threshold (6× stale) the UI flips state at. */
  stallThresholdMs: number;
  /** true when maxHeartbeatAgeMs > stallThresholdMs AND a cycle is in flight. */
  stalled: boolean;
};

type HttpContext = {
  /** F1 — this bridge process's identity, served from GET /api/health. */
  identity: BridgeIdentity;
  scanCycles: () => { live: Cycle[]; recent: Cycle[] };
  /** Feature #8 — daemon-stall liveness across in-flight cycles. */
  liveness: () => LivenessReport;
  logsRoot: string;
  forgeRoot: string;
  queueRoot: string;
  /** ADR 020 — `<forgeRoot>/projects`, the root the architect routes walk. */
  projectsRoot: string;
  /** Broadcast an `architect-list-changed` WS message (fsWatch may miss
   *  same-tick writes; the routes call this after they mutate session state). */
  broadcastArchitectChanged: () => void;
  /** Broadcast an `instructions-list-changed` WS message (fsWatch may miss
   *  same-tick writes; the routes call this after they mutate session state). */
  broadcastInstructionsChanged: () => void;
  /** Broadcast a `demo-list-changed` WS message (fsWatch may miss same-tick
   *  writes; the routes call this after they mutate session state). */
  broadcastDemoChanged: () => void;
  /** R1-3b — broadcast a `project-brain-list-changed` WS message. */
  broadcastProjectBrainChanged: () => void;
  /** W6-B2 — start (idempotently) live-tailing ANY session kind's event log
   *  (architect/instructions/demo/project-brain/authoring/kb-cleanup — every
   *  kind whose runner writes to `_logs/_<kind>-<sid>/events.jsonl`), keyed
   *  on the session-kind id (== `SPAWN_AGENT_SPECS[agentId].logPrefix`).
   *  Replaces the four former per-kind `ensure<Kind>Tail` fields. */
  ensureSessionTail: (kind: string, sessionId: string) => void;
  /** W7-B5 (agents-20) — start (idempotently) live-tailing a STANDALONE
   *  agent-dispatch run's event log (`_logs/<runId>/events.jsonl`, runId
   *  minted `_agent-<slug>-<stamp>`) — the third tailable category next to
   *  session logs and live flow cycles. Called at dispatch time and re-armed
   *  by the run-status route while the run is live (a WS reconnect resets
   *  every tail; the panel/run-page poll recovers it). */
  ensureAgentRunTail: (runId: string) => void;
  /** Release a standalone run's tail once the run is terminal (review round
   *  1) — its log is immutable from then on, and `stopAllTails` alone only
   *  fires when the LAST WS client disconnects. */
  releaseAgentRunTail: (runId: string) => void;
  /** Merge the remote PR. Injectable for tests; defaults to mergePullRequest. */
  mergePr: (worktreePath: string) => boolean;
  /** Fire finalization after merge. Injectable for tests; defaults to finalizeMergedReadyForReview. */
  finalizeAfterMerge: (deps: { queueRoot: string; logsRoot: string }) => Promise<unknown>;
  /** WS-A — finalise the release on the PR branch before merge (opt-in; log-and-continue). */
  runReleaseFinalize: (input: ReleaseFinalizeHookInput) => Promise<{ release_status: string }>;
  /** D — re-run the reflector on operator feedback. Injectable; defaults to the real helper. */
  rerunReflector: RerunReflectorFn;
};

/** Content-type by extension for served artifacts. `.html` → `text/html` so the
 *  PLAN/DEMO pages render in the operator's browser (ADR 020 + Phase E); all
 *  else stays `text/plain`. Module-private and, by convention enforced in
 *  `cli/ui-bridge-served-file-headers.test.ts` (a source-level ratchet over
 *  this file), callable ONLY from `servedFileHeaders` below — every route
 *  that serves a file on the bridge origin must go through the hardened
 *  helper, never this alone. */
function contentTypeFor(filename: string): string {
  return filename.toLowerCase().endsWith('.html')
    ? 'text/html; charset=utf-8'
    : 'text/plain; charset=utf-8';
}

/** Reduce a filename to a header-safe charset before it rides inside
 *  `content-disposition: inline; filename="..."`. Strips anything outside
 *  `[A-Za-z0-9._-]` — a bare `"`, CR, LF or any other byte that could break
 *  out of the quoted string or smuggle a second header is gone — and falls
 *  back to a fixed placeholder if that empties the name entirely.
 *  `basename()` runs first so a `filename` that still carries `/`-joined
 *  path segments contributes only its leaf.
 *
 *  This is genuinely load-bearing, not decorative, for SOME of the seven
 *  call sites and NOT others — checked per route, not assumed: `isSafeSegment`
 *  (cli/studio-path-guard.ts, backing `isSafeSubPath`/`resolveGuardedPath`,
 *  which gate the `/api/artifact/`, `/api/architect/file/` and
 *  `/api/instructions/file/` routes) denies control characters (so CR/LF
 *  header-injection is ALREADY refused before this ever runs on those three
 *  routes — a 400, not a sanitised 200) but has no opinion on a bare `"`, so
 *  THIS function is what stops a quote breaking out of the quoted-string on
 *  those routes and on `/api/demo-builder/fragment/` (whose `element`
 *  component is checked only by a lexical `startsWith(base)`, same gap).
 *  `/api/demo-builder/generation/`'s `GENERATION_FILENAME_RE` is a strict
 *  `[A-Za-z0-9._-]+` allowlist that already excludes `"` and control
 *  characters — this function is unreachable-but-harmless for that route.
 *  `/api/demo-builder/demo/` and `/api/demo-builder/history/<project>/<id>`
 *  always pass the fixed literal `'DEMO.html'`, never request-derived
 *  input. */
function sanitizeHeaderFilename(filename: string): string {
  const leaf = basename(filename);
  const cleaned = leaf.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'file';
}

/** WI-3 (regate row `artifact-plan-45`, bead forge-6gv.3.2) — the COMPLETE
 *  header set for a route serving an AGENT-AUTHORED file on the bridge's own
 *  origin (artifact / PLAN / DEMO / instructions-draft / fragment /
 *  generation-snapshot). Before this helper, `contentTypeFor` alone reached
 *  `res.writeHead` at seven call sites with no `content-security-policy`, no
 *  `x-content-type-options` and no `content-disposition` — script inside such
 *  a file would run AS the bridge origin (localhost:4123) and could drive
 *  every mutating route the CSRF check only guards with a header a
 *  same-origin fetch can add just as easily (approve-and-merge, scheduler
 *  start, plan verdicts). No live exploit exists today: a survey of every
 *  HTML file these routes can actually serve on this host — 109
 *  `_logs/**\/artifacts/*.html` files plus every `.forge/demo/**.html`,
 *  `_demo/**\/DEMO.html` and `_architect/**\/PLAN.html` — found zero
 *  `<script>`, zero inline `onclick=`/`onload=`, zero external `<link>`
 *  stylesheets (the only `src=` values are `data:image/png;base64,…`
 *  screenshots). A script-blocking CSP therefore breaks nothing that exists
 *  today and closes the class before an agent-authored file changes that.
 *
 *  Deliberately STRUCTURAL, not per-site: this is the only function in the
 *  file allowed to call `contentTypeFor` (enforced by the source-level
 *  ratchet in `cli/ui-bridge-served-file-headers.test.ts`), so a content-type
 *  can never be obtained here without the hardening headers riding along —
 *  the eighth route someone adds next year gets this for free by using the
 *  helper, and the ratchet fails loudly if they reach for `contentTypeFor`
 *  directly instead.
 *
 *  Two INDEPENDENT script defences, on purpose: `sandbox` with no
 *  `allow-scripts` (the document gets an opaque origin — cannot run script,
 *  cannot reach the bridge, cannot read its own cookies/storage) AND
 *  `default-src 'none'` (a CSP script-src belt for a UA that ignores or only
 *  partially applies the sandbox directive). `style-src 'unsafe-inline'` +
 *  `img-src data:` + `font-src data:` are exactly what the surveyed files
 *  use (inlined CSS, base64 screenshots) — nothing wider is opened.
 *  `content-type` stays `text/html` for `.html` (never `text/plain`):
 *  `apps/studio/app/artifact/page.tsx`, `apps/studio/components/PlanGate.tsx` and
 *  `apps/studio/components/studio/artifact/ArchitectPlanGate.tsx` all render
 *  these files in a `sandbox=""` iframe and expect the browser to actually
 *  RENDER the markup — `text/plain` would show raw source, a user-visible
 *  regression. `content-disposition: inline` (never `attachment`) for the
 *  same reason: `attachment` forces a download instead of an iframe render.
 *  See `sanitizeHeaderFilename` for which routes it is actually load-bearing
 *  on versus redundant-with-an-already-strict-guard. */
function servedFileHeaders(filename: string, origin: string): OutgoingHttpHeaders {
  return {
    'content-type': contentTypeFor(filename),
    'x-content-type-options': 'nosniff',
    'content-security-policy':
      "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'",
    'content-disposition': `inline; filename="${sanitizeHeaderFilename(filename)}"`,
    'access-control-allow-origin': origin,
    'vary': 'origin',
  };
}

/** True when `v` is a `{given, when, then}` shape (all string fields present). */
function isAcShape(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.given === 'string' && typeof o.when === 'string' && typeof o.then === 'string';
}

/**
 * Atomically read-modify-write the review-comment sidecar for a cycle under a
 * proper-lockfile guard (mirrors applyReviewVerdict). The sidecar file is
 * created empty first so the lock has a target even on the first comment.
 * `mutate` is a pure transform; the write persists its result.
 */
async function withReviewCommentLock(
  logsRoot: string,
  cycleId: string,
  mutate: (sidecar: ReturnType<typeof readReviewComments>) => ReturnType<typeof readReviewComments>,
): Promise<ReturnType<typeof readReviewComments>> {
  // Ensure the sidecar exists so proper-lockfile has a target (writeReviewComments
  // throws on a traversal cycleId — that propagates as a 500, never a write).
  if (!existsSync(reviewCommentsPath(logsRoot, cycleId))) {
    writeReviewComments(logsRoot, cycleId, { cycleId, comments: [] });
  }
  const release = await lockfile.lock(reviewCommentsPath(logsRoot, cycleId), { retries: { retries: 5, minTimeout: 50 } });
  try {
    const next = mutate(readReviewComments(logsRoot, cycleId));
    writeReviewComments(logsRoot, cycleId, next);
    return next;
  } finally {
    try { await release(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// R6-06 WI-1 — agent run-history ledger (GET /api/agents/:slug/history) +
// the shared standalone-run status/cost derivation it reuses from the
// pre-existing GET /api/agents/runs/<runId> route (D3.5/shared-derivation:
// ONE function, never two independently-written copies that can drift).
// ---------------------------------------------------------------------------

/**
 * One row of an agent's run-history ledger — a flow-node run, a standalone
 * dispatch, or an interactive session, each carrying its OWN status/cost
 * (D3: never a run-level or cross-run aggregate) verbatim in its own native
 * vocabulary (D12: no cross-vocabulary status mapping).
 *
 * R6-06 ROUND 8/9 fix: `id`/`status`/`costUsd`/`href`/`linkKind` are the
 * PRE-EXISTING fields (kept byte-identical — every node test written
 * against Task 1's original acceptance battery, `cli/ui-bridge-agent-
 * history.test.ts`, still reads them directly and must keep passing). The
 * defect this round fixes is that the CLIENT (`apps/studio/lib/agent-ledger.ts`)
 * never received the raw per-path FACTS it needs to derive `when`/`what`/
 * `narrative` itself — so each variant now ALSO carries exactly what its own
 * client-side entry type (`AgentFlowNodeRunEntry`/`AgentStandaloneRunEntry`/
 * `AgentSessionRunEntry`, agent-ledger.ts) declares: the full `run`+`nodeId`
 * for a flow-node row (the client derives status/cost/narrative from THAT,
 * never from this row's own `status`/`costUsd` — those two stay here only
 * because deleting them would break the pre-existing acceptance battery,
 * not because the client reads them), or `when`+`what` for standalone/
 * session rows. Purely ADDITIVE — no existing consumer of the original five
 * fields observes any change.
 */
type AgentHistoryRow =
  | { id: string; linkKind: 'flow-node'; href: string; status: string; costUsd: number | null; run: Run; nodeId: string }
  | { id: string; linkKind: 'standalone'; href: string; status: string; costUsd: number | null; when: string; what: string }
  | { id: string; linkKind: 'session'; href: string; status: string; costUsd: number | null; when: string; what: string };

type StandaloneRunState = {
  /**
   * W8-A2 (ON-7 defect 4) — 'stalled' added. Every OTHER member is derived
   * from a TERMINAL MARKER the run's own events.jsonl recorded (an `end`
   * event, a `agent-dispatch.{failed,cancelled}` log, a suppression
   * message) — there was no time-based signal at all, so a process
   * SIGKILLed with no terminal marker read byte-identical to one that
   * started two seconds ago: 'running' forever. 'stalled' is the ONLY
   * member derived from silence rather than a marker — see
   * `applyStandaloneStaleness`'s doc comment for the exact rule (reusing
   * the session lifecycle's own stall ceiling / liveness proof, never a
   * second invented one).
   */
  state: 'running' | 'done' | 'failed' | 'suppressed' | 'budget-exceeded' | 'cancelled' | 'stalled';
  costUsd: number | null;
  events: number;
  lines: Record<string, unknown>[];
  /** W7-B5 (agents-19): the dispatch failure's own recorded reason
   *  (`agent-dispatch.failed` metadata.error) — absent when the run never
   *  failed. Served verbatim; never summarised into the bare word "failed". */
  errorText?: string;
  /** W7-B5 (agents-06 / forge-75j): the terminal end event's own
   *  `output_refs` — what the run actually produced. `[]` until an end
   *  event exists. */
  outputRefs: string[];
  /** W7-B5 (agents-31): the ceiling in force, read from ANY event carrying
   *  `metadata.kickoff_ceiling_usd` (the t0 `agent-run.dispatched` marker,
   *  the `start` event, or the terminal `end`) — latest wins. Absent when
   *  no ceiling was ever recorded. */
  ceilingUsd?: number;
};

/**
 * Guarded parse of `<root>/<entryName>/events.jsonl` (R6-06 round 6,
 * adversarial-containment-review — replaces the former unguarded
 * `parseEventsJsonl(eventsPath: string)`, which called plain
 * `existsSync`/`readFileSync` on a path built from an ENTRY NAME the caller
 * read off disk via `readdirSync` — a directory symlink at `entryName`, a
 * file symlink at the `events.jsonl` leaf, or a hardlinked leaf were all
 * silently followed and served. `entryName` is a SINGLE directory-entry name
 * (never a multi-segment path — every caller below passes one literal
 * `readdirSync`-sourced or registry-derived name), so `resolveGuardedPath`'s
 * per-segment identity walk plus its `nlink===1` leaf check close all three
 * shapes (symlinked entry dir, symlinked leaf, hardlinked leaf) in one choke
 * point. `root` MUST be a fixed, config-derived constant (logsRoot) per
 * `resolveGuardedPath`'s own contract — see its module docstring's
 * root-folding warning; NEVER fold `entryName` into `root` before calling
 * this.
 *
 * `null` covers BOTH "the file doesn't exist yet" (a legitimate no-events-
 * yet run) AND "the guard rejected this entry" (a poisoned symlink/hardlink)
 * — collapsed into the exact same outcome so a poisoned entry is never
 * distinguishable from an absent one to any caller (the no-oracle rule).
 * A malformed individual JSONL line is skipped, not fatal — unchanged from
 * the prior behaviour. */
// W8-F6 (bead forge-6gv.27): the implementation MOVED, verbatim, to
// cli/session-readability.ts so the legacy-session read path and these four
// call sites share ONE guarded parse instead of two copies. Imported at the
// top of this file; the doc comment above travelled with it.


/**
 * The SHARED standalone status/cost derivation — extracted verbatim from
 * what was previously inlined in `GET /api/agents/runs/<runId>` (the
 * suppressed/failed/ceiling-stopped/done/running vocabulary), with ONE
 * honesty fix (Amendment 2): a run with no `end` event reports `costUsd:
 * null` (nothing has been spent AND FINISHED yet is not the same claim as
 * "spent exactly $0.00") rather than a fabricated `0`. Operates on an
 * ALREADY-PARSED events array so both call sites below (a run resolved by
 * id, and a run discovered by directory-enumeration in
 * `collectStandaloneRows`) share this exact evaluation — never a second,
 * independently-written copy (D3.5).
 */
function deriveStandaloneStateFromEvents(parsed: readonly Record<string, unknown>[]): StandaloneRunState {
  const suppressed = parsed.some((e) => e['message'] === 'run-agent.spawn-suppressed');
  // `runAgent` emits `end` only on success; a crashed dispatch writes a
  // terminal 'agent-dispatch.failed' marker (cli/agent-run.ts) instead —
  // without it the run would read 'running' forever.
  const failedMarker = [...parsed].reverse().find((e) => e['message'] === 'agent-dispatch.failed');
  // W7-B5 (agents-30): an operator cancel writes a durable
  // 'agent-dispatch.cancelled' marker (the cancel route). STICKY — it wins
  // over every other terminal fact, including an `end` event that lands
  // after the cancel (a SIGTERM'd agent finishing anyway must never
  // resurrect the run as 'done' — the same sticky-cancel rule W7-A2
  // established for sessions).
  const cancelled = parsed.some((e) => e['message'] === 'agent-dispatch.cancelled');
  const endEvent = parsed.find((e) => e['event_type'] === 'end');
  // R6-04 (WI-2): a ceiling-stop (SDK `result_subtype: 'error_max_budget_usd'`,
  // recorded into the end event's metadata by runAgent) is a DISTINCT
  // terminal state, never collapsed into an ordinary successful 'done'.
  const endMetadata = endEvent?.['metadata'] as Record<string, unknown> | undefined;
  const ceilingStopped = endMetadata?.['result_subtype'] === 'error_max_budget_usd';
  const state: StandaloneRunState['state'] =
    cancelled ? 'cancelled'
      : failedMarker ? 'failed'
        : suppressed ? 'suppressed'
          : ceilingStopped ? 'budget-exceeded'
            : endEvent ? 'done'
              : 'running';
  const costUsd = typeof endEvent?.['cost_usd'] === 'number' ? (endEvent['cost_usd'] as number) : null;
  const failedMeta = failedMarker?.['metadata'] as Record<string, unknown> | undefined;
  const errorText = typeof failedMeta?.['error'] === 'string' ? (failedMeta['error'] as string) : undefined;
  const outputRefs = Array.isArray(endEvent?.['output_refs'])
    ? (endEvent!['output_refs'] as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];
  // Latest recorded ceiling across ALL events (dispatched marker → start
  // → end); a run that never recorded one stays honestly absent. TWO keys,
  // in precedence order (review round 1): `kickoff_ceiling_usd` is the
  // OPERATOR's explicit ceiling, `effective_ceiling_usd` is whatever cap the
  // run actually executed under — the agent's own declared
  // `budgets.maxBudgetUsd` when no operator ceiling was given. Reading only
  // the first meant every dispatch that relied on a declared default (the
  // whole onboarding route, and any agent run without an explicit ceiling)
  // reported "no ceiling was recorded" for a cap that was genuinely in
  // force. Same event may carry both; the operator's wins.
  let ceilingUsd: number | undefined;
  for (const e of parsed) {
    const meta = e['metadata'] as Record<string, unknown> | undefined;
    const recorded = typeof meta?.['kickoff_ceiling_usd'] === 'number'
      ? (meta['kickoff_ceiling_usd'] as number)
      : typeof meta?.['effective_ceiling_usd'] === 'number'
        ? (meta['effective_ceiling_usd'] as number)
        : undefined;
    if (recorded !== undefined) ceilingUsd = recorded;
  }
  // `events` stays the COUNT (uncapped); `lines` is the tail slice served for
  // rendering — a fixed cap regardless of log size, TAIL-preserving.
  const lines = parsed.slice(-RUN_LOG_LINES_MAX);
  return {
    state,
    costUsd,
    events: parsed.length,
    lines,
    outputRefs,
    ...(errorText !== undefined ? { errorText } : {}),
    ...(ceilingUsd !== undefined ? { ceilingUsd } : {}),
  };
}

/**
 * W8-A2 (ON-7 defect 4) — a standalone run's OWN on-disk liveness facts.
 * `spawnAgentDispatch` (this file) writes `events.jsonl`, `stderr.log` AND
 * `turn.pid` into the SAME `_logs/<runId>/` directory — unlike a
 * SESSION-bound dispatch (onboarding etc.), whose tracked `turn.pid` lives
 * in the session's OWN log dir while its events/stderr live in a DIFFERENT
 * one (`_logs/<runId>/`; see `readSessionLifecycleFacts`'s doc comment in
 * bridge-studio-lifecycle.ts). Because a standalone run never splits those
 * facts across two directories, `lastActivityMs`/`turnAlive` are read the
 * same guarded way `readSessionLifecycleFacts` reads them, just against one
 * flat directory instead of a per-kind session template.
 */
function readStandaloneLivenessFacts(logsRoot: string, runEntryName: string): {
  idleMs: number | null;
  turnAlive: boolean;
  stderr: { text: string; mtimeMs: number } | null;
} {
  const guardedMtime = (segments: readonly string[]): number | null => {
    const guarded = resolveGuardedPath(logsRoot, segments);
    if (!guarded.ok || !guarded.exists) return null;
    try {
      return statSync(guarded.realPath).mtimeMs; // guard-terminal: `guarded.realPath` IS the guard's own output.
    } catch {
      return null;
    }
  };
  const eventsMtimeMs = guardedMtime([runEntryName, 'events.jsonl']);
  const stderrMtimeMs = guardedMtime([runEntryName, 'stderr.log']);
  const pidMtimeMs = guardedMtime([runEntryName, 'turn.pid']);
  const candidates = [eventsMtimeMs, stderrMtimeMs, pidMtimeMs].filter((m): m is number => m !== null);
  const lastActivityMs = candidates.length > 0 ? Math.max(...candidates) : null;

  const pidRaw = guardedReadFile(logsRoot, [runEntryName, 'turn.pid']);
  const turnPid = pidRaw !== null && /^\d+\s*$/.test(pidRaw.trim()) ? Number.parseInt(pidRaw.trim(), 10) : null;
  // Ownership mark = the runId itself, a whole argv element — the SAME
  // contract `killTrackedRun` already trusts for the cancel route
  // (`--run-id <runId>`, buildAgentDispatchArgs).
  const turnAlive = turnPid !== null && isTurnAlive(turnPid, runEntryName);

  const stderrText = stderrMtimeMs !== null ? guardedReadFile(logsRoot, [runEntryName, 'stderr.log']) : null;
  const stderr = stderrText !== null && stderrText.trim().length > 0 && stderrMtimeMs !== null ? { text: stderrText, mtimeMs: stderrMtimeMs } : null;

  return {
    idleMs: lastActivityMs !== null ? Math.max(0, Date.now() - lastActivityMs) : null,
    turnAlive,
    stderr,
  };
}

/**
 * W8-A2 (ON-7 defect 4) — narrows a 'running' verdict to 'stalled' using the
 * run's own liveness facts. Every OTHER state is a terminal marker and is
 * NEVER overridden (a `done`/`failed`/`cancelled` run cannot un-happen
 * because a later poll finds an old mtime). `idleMs === null` (no log dir
 * at all — no liveness signal to be silent on) stays 'running': an honest
 * "unknown", never a guess — the SAME rule `deriveSessionLifecycle` applies
 * to a session with no log dir.
 *
 * Reuses `DEFAULT_STALL_CEILING_MS` (bridge-studio-lifecycle.ts) — ONE
 * ceiling across the product, not a second invented one for standalone
 * runs — and `isTurnAlive`, the SAME ownership-proof liveness check the
 * cancel route already trusts.
 *
 * NO `turnAlive && !hasChannel` exemption (the sibling rule
 * `deriveSessionLifecycle:159` applies for SESSION-bound dispatches, whose
 * tracked turn.pid can live in a directory with no heartbeat/events channel
 * at all). A standalone run's `turn.pid`, `events.jsonl` and `stderr.log`
 * are ALL written into this SAME directory by `spawnAgentDispatch` — so a
 * live pid always shares its directory with a real events channel once
 * anything has landed, and a live-but-silent-past-ceiling standalone run (a
 * wedged tool call, a hung SDK turn) is exactly the zombie shape this
 * exists to catch, not exempt from. Applying the session's exemption here
 * would mean a standalone run could NEVER be caught stalled while its
 * process happens to still be alive — the real leaked dirs on disk today
 * (`_agent-onboarding-agent-*`, `_agent-w7-throwaway-agent-*`) are dead
 * processes with no live pid at all, where the exemption is moot anyway;
 * a live-but-wedged one is the case it would wrongly protect.
 */
function applyStandaloneStaleness(
  state: StandaloneRunState['state'],
  liveness: { idleMs: number | null },
): StandaloneRunState['state'] {
  if (state !== 'running') return state;
  if (liveness.idleMs === null) return 'running';
  return liveness.idleMs > DEFAULT_STALL_CEILING_MS ? 'stalled' : 'running';
}

/** The ONE seam every caller of `deriveStandaloneStateFromEvents` routes a
 *  result through before using it — so a future caller cannot forget the
 *  staleness override, mirroring `deriveRowLifecycle`'s same role for
 *  sessions. When the override promotes 'running' to 'stalled' AND a real
 *  stderr.log exists, `errorText` carries the runner's own last words
 *  (`extractErrorMessage` — the SAME crash-message extraction sessions use)
 *  rather than the bare word "stalled"; a stalled run with an empty/absent
 *  stderr stays honestly errorText-less, same as a stalled SESSION's
 *  `error: null`. */
function withStandaloneLiveness(logsRoot: string, runEntryName: string, base: StandaloneRunState): StandaloneRunState {
  const liveness = readStandaloneLivenessFacts(logsRoot, runEntryName);
  const state = applyStandaloneStaleness(base.state, liveness);
  if (state === base.state) return base;
  return {
    ...base,
    state,
    ...(liveness.stderr !== null ? { errorText: extractErrorMessage(liveness.stderr.text) } : {}),
  };
}

/** Full derivation for a standalone run directory: handles the "dispatched,
 *  no event has landed yet" state (no `events.jsonl` at all, OR a poisoned
 *  entry the guard rejected — both collapse to the same honest "no events
 *  observed" outcome, never a leak) honestly — `running`/`costUsd: null` —
 *  then delegates to the shared per-event derivation above, then the
 *  staleness override (ON-7 defect 4). Used by BOTH `GET /api/agents/runs/
 *  <runId>` and the history route's standalone-path rows. Takes `logsRoot`
 *  + the run's own directory NAME (never a pre-joined path) so the guarded
 *  parse below can identity-check that name as its own path segment (R6-06
 *  round 6). */
function deriveStandaloneRunState(logsRoot: string, runEntryName: string): StandaloneRunState {
  const parsed = parseGuardedEventsJsonl(logsRoot, runEntryName);
  const base: StandaloneRunState = parsed === null
    ? { state: 'running', costUsd: null, events: 0, lines: [], outputRefs: [] }
    : deriveStandaloneStateFromEvents(parsed);
  return withStandaloneLiveness(logsRoot, runEntryName, base);
}

/** D4 (amended, round 3): standalone identity is EXACT EQUALITY against the
 *  run's OWN events, on EITHER `metadata.agent_slug` (the shape `runAgent`'s
 *  real start/end events carry) OR top-level `skill` (the shape a
 *  materials-staged-only run carries, no `metadata.agent_slug` key at all —
 *  see `POST /api/agents/:slug/run`'s own 'agent-run.materials-staged' log
 *  event). NEVER a runId prefix/substring match — `_agent-probe-x-…` must
 *  never satisfy a query for `probe` just because the string starts with
 *  `_agent-probe-`. */
function standaloneRunMatchesSlug(events: readonly Record<string, unknown>[], slug: string): boolean {
  return events.some((e) => {
    const metadata = e['metadata'] as Record<string, unknown> | undefined;
    return metadata?.['agent_slug'] === slug || e['skill'] === slug;
  });
}

/** The literal prefix `runId = _agent-<slug>-<stamp>` mints (POST
 *  /api/agents/:slug/run). Used ONLY to narrow which `_logs/` entries are
 *  even candidate standalone-dispatch directories, before parsing their
 *  events — a coarse, slug-INDEPENDENT structural filter (distinguishing
 *  standalone dirs from flow-cycle dirs and `_<kind>-<sessionId>` session-log
 *  dirs), never used as an identity check (that stays exact-match on the
 *  run's own events, per D4 above — this constant plays no role in deciding
 *  whether a given candidate BELONGS to the queried slug). */
const STANDALONE_RUN_DIR_PREFIX = '_agent-';

/**
 * Path 1 — flow-node rows. `buildAgentSlugToNodeId` (run-model.ts) resolves
 * the slug straight to the flow node id that declares it, from the union of
 * every seed flow's `flow.yaml` under `studio/flows/` (no fallback table — an unresolvable slug
 * simply yields no flow-node rows, never a crash). For every run whose
 * `phases` map actually reached that node, the row's status/cost come from
 * THAT NODE's own `phases[nodeId]`/`phaseMeta[nodeId]` — never
 * `run.status`/`run.costUsd` (the run-level aggregate over every phase in the
 * cycle) — D9/D3.
 */
function collectFlowNodeRows(forgeRoot: string, slug: string): AgentHistoryRow[] {
  const nodeId = buildAgentSlugToNodeId(forgeRoot).get(slug);
  if (!nodeId) return [];
  const rows: AgentHistoryRow[] = [];
  // ADR-044 P1: cached per-manifest derivation — see cli/run-list-cache.ts.
  for (const run of cachedListRuns(forgeRoot, Date.now())) {
    const status = run.phases[nodeId];
    if (status === undefined) continue; // this run's flow never reached the node — no row, never fabricated
    rows.push({
      id: run.id,
      linkKind: 'flow-node',
      href: `/flows/${encodeURIComponent(run.flowId)}/run/${encodeURIComponent(run.id)}`,
      status,
      costUsd: run.phaseMeta[nodeId]?.costUsd ?? null,
      // R6-06 ROUND 8/9: the client's `AgentFlowNodeRunEntry` derives its own
      // when/what/narrative from the FULL run + which node — the same `run`
      // GET /api/runs already ships verbatim (D2 reuse), never a second,
      // independently-trimmed copy.
      run,
      nodeId,
    });
  }
  return rows;
}

/**
 * Path 2 — standalone-dispatch rows. D5: `logsRoot` is enumerated via
 * `readdirSync`; the caller-supplied `slug` is a FILTER applied to each
 * ENUMERATED entry's own on-disk content, never joined into a path. Identity
 * is exact-match on the run's own events (`standaloneRunMatchesSlug`, D4) —
 * a directory whose name merely starts with a similar-looking prefix is
 * never enough on its own (the alias trap).
 *
 * R6-06 round 6: the actual READ of each enumerated entry's `events.jsonl`
 * goes through `parseGuardedEventsJsonl` — `entry` is an untrusted NAME read
 * off disk (`readdirSync`'s result, not chosen by this function), and a
 * symlinked entry dir / symlinked `events.jsonl` / hardlinked `events.jsonl`
 * were all previously followed by a plain `statSync`+`existsSync`+
 * `readFileSync` chain with zero identity or nlink check. The guard's
 * "absent" collapse also subsumes the old explicit `isDirectory()` check —
 * a non-directory `entry` simply has no valid `events.jsonl` path beneath
 * it, so the guarded parse returns `null` for it exactly as it does for "no
 * events yet", with no separate check needed.
 */
function collectStandaloneRows(logsRoot: string, slug: string): AgentHistoryRow[] {
  let entries: string[];
  try {
    entries = existsSync(logsRoot) ? readdirSync(logsRoot) : [];
  } catch {
    entries = [];
  }
  const rows: AgentHistoryRow[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(STANDALONE_RUN_DIR_PREFIX)) continue;
    const parsed = parseGuardedEventsJsonl(logsRoot, entry); // `entry` came from readdir, never from `slug`
    // No events at all (or a poisoned/rejected entry — indistinguishable by
    // design) -> nothing to prove identity against; honestly unattributable
    // to any slug, so it produces no row (never a guess, never a leak).
    if (parsed === null || !standaloneRunMatchesSlug(parsed, slug)) continue;
    // W8-A2 (ON-7 defect 4) — routed through the SAME staleness seam
    // `deriveStandaloneRunState` uses, so a zombie run shows 'stalled' here
    // too, not just on its own detail route.
    const derived = withStandaloneLiveness(logsRoot, entry, deriveStandaloneStateFromEvents(parsed));
    // R6-06 ROUND 9 MEASUREMENT: `when` is this run's own FIRST event's
    // `started_at` — the same `parsed` array already in hand, no second
    // read. `what` is honestly absent server-side (run-agent.ts's own
    // events carry only the agent's own identity, never a project/task
    // description — a measured NEGATIVE RESULT, not a design choice), so
    // the agent's own slug is the smallest non-fabricated string available.
    const firstStartedAt = parsed[0]?.['started_at'];
    rows.push({
      id: entry,
      linkKind: 'standalone',
      href: `/agents/${encodeURIComponent(slug)}/run/${encodeURIComponent(entry)}`,
      status: derived.state,
      costUsd: derived.costUsd,
      when: typeof firstStartedAt === 'string' ? firstStartedAt : '',
      what: slug,
    });
  }
  return rows;
}

/**
 * W7-B5 (agents-03 / agents-04 / agents-39) — ONE row of the aggregate
 * `GET /api/agents/runs/recent` route. Two shapes:
 *   - `linkKind: 'flow'` — one row per FLOW RUN, carrying the RUN-level
 *     status/cost (never one node's slice attributed to the whole run — the
 *     exact defect the pre-B5 client-side merge shipped) plus `agents`, the
 *     slugs of every agent whose node this run actually reached.
 *   - `linkKind: 'standalone'` — one row per standalone dispatch, its OWN
 *     state/cost, attributed to its own slug (exact-match identity off the
 *     run's own events — D4, never a runId-prefix guess).
 * Sessions are deliberately NOT joined here: they have their own pillar
 * (`/sessions`) and their own per-agent history rows; "recent agent runs"
 * is the flow + standalone execution record.
 */
type RecentAgentRunRow = {
  id: string;
  when: string;
  what: string;
  agents: string[];
  status: string;
  costUsd: number | null;
  href: string;
  linkKind: 'flow' | 'standalone';
  errorText?: string;
};

/** Default + hard cap for `GET /api/agents/runs/recent?limit=` — named, not
 *  scattered literals. */
const RECENT_AGENT_RUNS_DEFAULT_LIMIT = 20;
const RECENT_AGENT_RUNS_MAX_LIMIT = 100;

/** The slug a standalone run's own events attribute it to (D4's exact-match
 *  identity: `metadata.agent_slug` or top-level `skill` — first event that
 *  carries either wins). `null` = honestly unattributable (no row). */
function standaloneRunSlug(events: readonly Record<string, unknown>[]): string | null {
  for (const e of events) {
    const metadata = e['metadata'] as Record<string, unknown> | undefined;
    if (typeof metadata?.['agent_slug'] === 'string') return metadata['agent_slug'] as string;
    if (typeof e['skill'] === 'string' && (e['skill'] as string).length > 0) return e['skill'] as string;
  }
  return null;
}

/**
 * node id → agent slug, PER FLOW (review round 1). The first draft inverted
 * the GLOBAL `buildAgentSlugToNodeId` map, which is flat across every flow —
 * so two flows sharing a node id (`review`, `dev`, `demo`: entirely ordinary
 * once an operator authors a flow) collapsed onto ONE arbitrary agent, and
 * runs of the second flow were labelled with the first flow's agent. That is
 * precisely the wrong-agent attribution this route exists to fix; the OOTB
 * four just happen not to collide today, so it would have stayed silent
 * until a user authored a flow. Node ids are only unique WITHIN a flow, so
 * the map has to be keyed that way too.
 */
function buildFlowNodeToSlug(forgeRoot: string): Map<string, Map<string, string>> {
  const byFlow = new Map<string, Map<string, string>>();
  try {
    const flowsDir = join(resolve(forgeRoot), 'studio', 'flows');
    if (!existsSync(flowsDir)) return byFlow;
    for (const entry of readdirSync(flowsDir).sort()) {
      const flowPath = join(flowsDir, entry, 'flow.yaml');
      if (!existsSync(flowPath)) continue;
      let flow;
      try {
        flow = loadFlowDefinition(flowPath);
      } catch {
        continue; // one malformed flow must never sink the whole mapping
      }
      const nodes = new Map<string, string>();
      for (const node of flow.nodes) {
        if (!node.agent) continue; // gate-only nodes have no agent
        if (!nodes.has(node.id)) nodes.set(node.id, node.agent);
      }
      byFlow.set(flow.id, nodes);
    }
  } catch {
    // Registry unavailable — an empty map means rows carry no `agents`
    // attribution, which is honest; it never fabricates one.
  }
  return byFlow;
}

function collectRecentAgentRuns(
  forgeRoot: string,
  logsRoot: string,
  limit: number,
  kind: 'flow' | 'standalone' | 'all' = 'all',
): RecentAgentRunRow[] {
  // Flow runs — run-level facts, plus which agents participated, resolved
  // through the run's OWN flow (node ids are unique per flow, not globally).
  const flowNodeToSlug = buildFlowNodeToSlug(forgeRoot);
  const rows: RecentAgentRunRow[] = [];
  // Review round 1: dedupe by `id`. `HistoryLedger` keys each rendered row on
  // `row.id` (`key={row.id}`) — an implicit contract every consumer of that
  // shared component must uphold, and the reason the client-side join this
  // route replaced documented its own dedupe as "REQUIRED, not cosmetic".
  // Two manifests resolving to the SAME cycle id (a threaded architect →
  // develop hand-off, a requeued initiative whose manifest exists in two
  // queue states) otherwise emit two rows with identical ids: a duplicate
  // React key and a double-listed run. First-seen wins — `cachedListRuns` is
  // already ordered, so that is the newer/canonical one.
  const seenIds = new Set<string>();
  for (const run of kind === 'standalone' ? [] : cachedListRuns(forgeRoot, Date.now())) {
    if (seenIds.has(run.id)) continue;
    seenIds.add(run.id);
    const nodeToSlug = flowNodeToSlug.get(run.flowId);
    const agents = nodeToSlug === undefined ? [] : [...new Set(
      Object.keys(run.phases)
        .map((nodeId) => nodeToSlug.get(nodeId))
        .filter((slug): slug is string => slug !== undefined),
    )];
    rows.push({
      id: run.id,
      when: run.startedAt ?? '',
      what: run.initiative,
      agents,
      status: run.status,
      costUsd: run.costUsd ?? null,
      href: `/flows/${encodeURIComponent(run.flowId)}/run/${encodeURIComponent(run.id)}`,
      linkKind: 'flow',
    });
  }
  // Standalone dispatches — same guarded enumeration discipline as
  // collectStandaloneRows (entry names come from readdir, never a caller).
  let entries: string[];
  try {
    entries = existsSync(logsRoot) ? readdirSync(logsRoot) : [];
  } catch {
    entries = [];
  }
  for (const entry of kind === 'flow' ? [] : entries) {
    if (!entry.startsWith(STANDALONE_RUN_DIR_PREFIX)) continue;
    if (seenIds.has(entry)) continue; // same row-id contract as the flow half
    const parsed = parseGuardedEventsJsonl(logsRoot, entry);
    if (parsed === null) continue;
    const slug = standaloneRunSlug(parsed);
    if (slug === null) continue; // unattributable — never a fabricated row
    // W8-A2 (ON-7 defect 4) — same staleness seam as collectStandaloneRows.
    const derived = withStandaloneLiveness(logsRoot, entry, deriveStandaloneStateFromEvents(parsed));
    const firstStartedAt = parsed[0]?.['started_at'];
    seenIds.add(entry);
    rows.push({
      id: entry,
      when: typeof firstStartedAt === 'string' ? firstStartedAt : '',
      what: slug,
      agents: [slug],
      status: derived.state,
      costUsd: derived.costUsd,
      href: `/agents/${encodeURIComponent(slug)}/run/${encodeURIComponent(entry)}`,
      linkKind: 'standalone',
      ...(derived.errorText !== undefined ? { errorText: derived.errorText } : {}),
    });
  }
  // Newest first; rows with no usable `when` sort last (mirrors the client
  // ledger's own rule). Bounded.
  rows.sort((a, b) => {
    const aMs = a.when ? Date.parse(a.when) : NaN;
    const bMs = b.when ? Date.parse(b.when) : NaN;
    const aOk = Number.isFinite(aMs);
    const bOk = Number.isFinite(bMs);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
    return bMs - aMs;
  });
  return rows.slice(0, Math.max(0, limit));
}

/** Cost + `when` facts read from a session's OWN log dir
 *  (`_logs/_<kind>-<sessionId>/events.jsonl`) — ONE guarded parse serving
 *  BOTH facts (replaces the former cost-only `readSessionCostUsd`, R6-06
 *  ROUND 9: `when` needs the exact same array, so a second guarded read for
 *  it would be a redundant re-parse of the same file, not a second
 *  independent cost summation — the "read never re-summed" rule is about
 *  `costUsd` specifically, unaffected here since the summation itself is
 *  unchanged). `costUsd` mirrors `readArchitectSessionStats`
 *  (orchestrator/architect-runner.ts)'s summing algorithm exactly,
 *  generalised over `kind` rather than hardcoded to `_architect-`; `null`
 *  when the log dir is absent (no cost has ever been recorded for this
 *  session — honest-absent, never a fabricated `0`). `when` is the FIRST
 *  event's own `started_at` (R6-06 ROUND 9 measurement) — `''` (the same
 *  honest-absent sentinel `flow-ledger.ts`'s own `run.startedAt ?? ''`
 *  convention uses, D7) when no event carries one. `_${kind}-${sessionId}`
 *  is ONE literal directory-entry name (a hyphen join, not a path
 *  separator), so it passes through the SAME guarded choke point as every
 *  other standalone-shaped log dir (R6-06 round 6) — `kind` comes from the
 *  live session-kind registry and `sessionId` from `readdirSync` in
 *  `collectSessionRows`, neither trusted enough to read through unguarded. */
function readSessionLogFacts(logsRoot: string, kind: string, sessionId: string): { costUsd: number | null; when: string } {
  const parsed = parseGuardedEventsJsonl(logsRoot, `_${kind}-${sessionId}`);
  if (parsed === null || parsed.length === 0) return { costUsd: null, when: '' };
  let total = 0;
  let any = false;
  for (const e of parsed) {
    const cost = e['cost_usd'];
    if (typeof cost === 'number') { total += cost; any = true; }
  }
  const firstStartedAt = parsed[0]['started_at'];
  return { costUsd: any ? total : null, when: typeof firstStartedAt === 'string' ? firstStartedAt : '' };
}

/**
 * Guarded read of `<projectsRoot>/<project>/<kindDirName>/<sessionId>/status.json`
 * (R6-06 round 6 — replaces the former direct `readSessionStatus(join(kindDir,
 * sessionId))` call, a plain `existsSync`/`readFileSync` with zero identity
 * or nlink check).
 *
 * `project`, `kindDirName`, `sessionId` each arrive as their OWN element of
 * `resolveGuardedPath`'s `segments[]` — never folded into `root` — so the
 * per-segment IDENTITY walk catches a symlinked `_<kind>` dir (the P0: a
 * malicious project's `_<kind>` pointing at a victim project's) at the
 * segment it actually lives at, regardless of which `sessionId` is being
 * tried; a symlinked `status.json` leaf fails the same walk one segment
 * later; a hardlinked `status.json` leaf is caught by the guard's
 * `nlink===1` check once the whole chain otherwise resolves. This is the
 * SAME shared `resolveGuardedPath` this file's task brief names as the
 * repo's intended guard for this shape — attacked directly (root-folding,
 * intermediate-segment symlink, hardlinked leaf, legitimate near-miss
 * names) before being wired in here; see the task report for the executed
 * results.
 *
 * `root` (`projectsRoot`) is a fixed, config-derived constant
 * (`resolveProjectsDir`), never request-derived — satisfying
 * `resolveGuardedPath`'s own root-trust contract. A rejected guard, an
 * absent leaf, and a malformed/non-object JSON body all collapse into the
 * SAME `null` — indistinguishable outcomes, per the no-oracle rule this
 * route's other two collectors already follow. */
function readGuardedSessionStatus(projectsRoot: string, project: string, kindDirName: string, sessionId: string): { phase?: unknown } | null {
  const guarded = resolveGuardedPath(projectsRoot, [project, kindDirName, sessionId, 'status.json']);
  if (!guarded.ok || !guarded.exists) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(guarded.realPath, 'utf8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as { phase?: unknown };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Path 3 — session rows. `slug` is matched against each session-kind
 * descriptor's OWN `agent` field (never joined into a path) to find which
 * kind(s) this agent drives; every project's `<project>/_<kind>/<sessionId>`
 * dir is then enumerated (mirrors `listInstructionsSessions`'s existing
 * cross-project enumeration pattern). Status is the session's OWN
 * `status.json.phase` string, verbatim (D12 — never coerced into a
 * RunStatus/RunPhaseStatus literal). Cost is read from the session's
 * SEPARATE log dir, never the state dir.
 */
function collectSessionRows(ctx: { forgeRoot: string; projectsRoot: string; logsRoot: string }, slug: string): AgentHistoryRow[] {
  // `loadSessionKinds` throws on a missing/unreadable `studio/session-kinds.yaml`
  // — that is a misconfigured studio and must fail loudly (no fallback table:
  // CLAUDE.md "Never do"), so the error is left to propagate to this route's
  // existing 500 handler below rather than degrading to a stale mirror.
  const matching = loadSessionKinds(ctx.forgeRoot).filter((d) => d.agent === slug);
  if (matching.length === 0) return [];

  let projects: string[];
  try {
    projects = existsSync(ctx.projectsRoot) ? readdirSync(ctx.projectsRoot) : [];
  } catch {
    projects = [];
  }

  const rows: AgentHistoryRow[] = [];
  for (const descriptor of matching) {
    const kindDirName = `_${descriptor.id}`;
    for (const project of projects) {
      const kindDir = join(ctx.projectsRoot, project, kindDirName);
      if (!existsSync(kindDir)) continue;
      let sessionIds: string[];
      try {
        sessionIds = readdirSync(kindDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      } catch {
        continue;
      }
      for (const sessionId of sessionIds) {
        if (sessionId.startsWith('_')) continue; // skip _archived/, mirrors listInstructionsSessions
        const status = readGuardedSessionStatus(ctx.projectsRoot, project, kindDirName, sessionId);
        if (!status || typeof status.phase !== 'string') continue; // unreadable/missing/escaping/hardlinked phase -> not a real session row
        const template = descriptor.legacyRoutes[0];
        const href = template
          ? template.replace('[sessionId]', sessionId)
          : `/sessions/${encodeURIComponent(descriptor.id)}/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(project)}`;
        // R6-06 ROUND 9 MEASUREMENT: `what` is the session-kind descriptor's
        // OWN `title` (e.g. 'Planning session') — a per-KIND, not per-
        // instance, label; `readGuardedSessionStatus`'s narrowed return type
        // doesn't expose the per-instance `project` field today, so a richer
        // "title · project" combination is a genuine (out-of-scope) future
        // change, not something already flowing (see the task report).
        const logFacts = readSessionLogFacts(ctx.logsRoot, descriptor.id, sessionId);
        rows.push({
          id: sessionId,
          linkKind: 'session',
          href,
          status: status.phase,
          costUsd: logFacts.costUsd,
          when: logFacts.when,
          what: descriptor.title,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// W6-B11 — GET /api/studio/sessions, the aggregate in-flight sessions index
// backing the /sessions page + Home's active-sessions strip.
// ---------------------------------------------------------------------------

/** One row of the aggregate `GET /api/studio/sessions` index: every in-flight
 *  (or, without `?active=1`, every) interactive session across ALL registry
 *  kinds and every project, flattened to the fields the /sessions index page
 *  + Home's active-sessions strip both need. */
export type SessionIndexRow = {
  kind: string;
  sessionId: string;
  project: string;
  phase: string;
  /** Derived via `isTerminalPhase` (cli/bridge-studio-sessions.ts) — the
   *  SAME derivation the single-session route's tail-gating already uses,
   *  never a second, hand-kept terminal-phase notion. */
  terminal: boolean;
  /** W7-A2 — TRUTHFUL in both directions: `deriveSessionLifecycle(...)
   *  .needsYou` (cli/bridge-studio-lifecycle.ts) — true iff an operator
   *  gate is open (`awaits: questions|verdict` on the phase row, or the
   *  LEGACY_SESSION_AWAITS_PHASES table for architect/project-brain) OR the
   *  runner crashed/stalled. An agent that is merely working (a `step:
   *  agent` row's staged-review/next-turn affordances) is NOT "needs you" —
   *  the pre-W7 derivation (`deriveSessionAffordances(...).length > 0`)
   *  counted those and inverted the signal for four of eight kinds
   *  (home-sessions-08, sessions-kinds-15). */
  needsYou: boolean;
  /** W7-A2 — the derived lifecycle state (`working` | `awaiting-operator` |
   *  `crashed` | `stalled` | `terminal`); see cli/bridge-studio-lifecycle.ts. */
  state: SessionLifecycleState;
  /** W7-A2 — the runner's crash message read live off
   *  `_logs/_<kind>-<sid>/stderr.log` for a `crashed` row; `null` otherwise. */
  error: string | null;
  /** W7-A2 — ms since the last on-disk sign of life; `null` when the
   *  session has no log dir (no liveness signal). */
  idleMs: number | null;
  modelTier: string | null;
  /** ISO timestamp of the session's last known write, or `''` — honest-absent,
   *  never fabricated — when the kind's status.json carries no timestamp
   *  field at all (kb-cleanup's shape today). */
  updatedAt: string;
  href: string;
};

/** Bound on `GET /api/studio/sessions`' response — an unbounded number of
 *  on-disk sessions (every project x every kind, for the lifetime of the
 *  forge instance) must never balloon the response; 200 comfortably covers
 *  any realistic in-flight count for the "one operator, many side projects"
 *  shape this platform is built around. Rows are sorted needs-you-first-
 *  then-newest (`sortAndCapSessionIndexRows`) BEFORE this cap is applied, so
 *  a capped response favours keeping needs-you rows over stale passive ones. */
export const SESSION_INDEX_MAX_ROWS = 200;

/** Generic phase/model/timestamp read for a session-kind with no dedicated
 *  per-kind list route (onboarding, authoring, kb-cleanup, and any future
 *  kind registered the same way) — the SAME guarded choke point
 *  (`resolveGuardedPath`) `readGuardedSessionStatus` (above) uses, just
 *  widened to the extra fields the aggregate index needs; not a second,
 *  independently-invented containment mechanism. `updatedAt` prefers
 *  `updated_at` (the four legacy kinds' own field name, in case a future
 *  kind reuses it), falls back to `startedAt` (onboarding's/authoring's own
 *  field — `writeOnboardingSession`/`writeAuthoringSession`, this file), and
 *  is `''` — honest-absent, never fabricated — when neither exists
 *  (kb-cleanup's status.json carries no timestamp field at all today). */
function readGuardedSessionIndexSummary(
  projectsRoot: string,
  project: string,
  kindDirName: string,
  sessionId: string,
): { phase: string; modelTier: string | null; updatedAt: string } | null {
  const guarded = resolveGuardedPath(projectsRoot, [project, kindDirName, sessionId, 'status.json']);
  if (!guarded.ok || !guarded.exists) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(guarded.realPath, 'utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.phase !== 'string') return null;
  return {
    phase: obj.phase,
    modelTier: typeof obj.modelTier === 'string' ? obj.modelTier : null,
    updatedAt: typeof obj.updated_at === 'string' ? obj.updated_at : typeof obj.startedAt === 'string' ? obj.startedAt : '',
  };
}

/**
 * `GET /api/studio/sessions`' row collector: flattens EVERY registered
 * session kind (`studio/session-kinds.yaml` via `loadSessionKinds` — never a
 * hardcoded kind list, so a new registry kind needs no code change here)
 * across every on-disk project into one row set.
 *
 * The four kinds with their OWN per-kind list route/reader
 * (architect/instructions/demo/project-brain) reuse THAT reader verbatim —
 * `listArchitectSessions` / `listInstructionsSessions` / `listDemoSessions` /
 * `listProjectBrainSessions`, the exact functions `GET /api/architect/
 * sessions` etc. already call — never a second, independently-written scan
 * of the same on-disk shape. Every OTHER kind (onboarding, authoring,
 * kb-cleanup today; any future kind added the same way) has no bespoke list
 * route (bridge-studio-sessions.ts's own header note: the generic
 * session-detail GET is authoring/kb-cleanup's ONLY read route) — those fall
 * through to the generic per-segment-guarded directory scan below, which
 * mirrors `collectSessionRows`'s own directory-enumeration shape immediately
 * above in this file (readdirSync of REAL, on-disk project names — never
 * request-derived — with the per-session STATUS READ routed through the SAME
 * `resolveGuardedPath` choke point every other guarded session read in this
 * file uses).
 *
 * `kind` never comes from a request — every row's `kind` is a registry
 * descriptor id from `loadSessionKinds`, so this route has no kind-id
 * traversal surface at all (unlike the single-session GET, whose `kind` path
 * segment IS request-derived and validated against the registry).
 */
/**
 * W8-A2 (ON-7 defect 1) — the ONE seam every session-list surface routes
 * through to get `{terminal, lifecycle}` for a row: the generic aggregate
 * index's `pushRow` below, AND each of the four bespoke per-kind list
 * routes (`GET /api/architect/sessions` etc.) — so a lifecycle-carrying row
 * can never omit the derivation by forgetting to call
 * `deriveSessionLifecycleFor` inline. Before this fix the four bespoke
 * routes never called `deriveSessionLifecycleFor` at all (imported once,
 * called once, by `pushRow` alone) — this is the wiring fix, not a second
 * derivation: `terminal` + `lifecycle` are computed EXACTLY the way
 * `pushRow` already computed them, just callable from five places instead
 * of copy-pasted or reinvented at four of them.
 */
/**
 * W8-A2 (ON-7) — `staleMs` for the bespoke per-kind session panels: ms since
 * the last sign of life, preferring the runner's OWN signals over the status
 * file's mtime.
 *
 * Order, and why:
 *   1. `.heartbeat` mtime — written only while a runner is genuinely alive,
 *      so it is the strongest positive evidence. Without this, an architect
 *      legitimately sitting in `drafting` for minutes while heartbeating
 *      would raise a FALSE stall warning.
 *   2. the runner's own `updated_at` — its CLAIM about when it last made
 *      progress. This is what the panel has always used, and it is the signal
 *      the flows-run stall cameo exercises.
 *   3. `lifecycle.idleMs` — last resort only.
 *
 * `lifecycle.idleMs` is deliberately NOT the primary source: it is
 * `now - max(status.json MTIME, .heartbeat, events.jsonl)`, and the runner
 * rewrites status.json on every phase transition, so a dead runner whose file
 * was merely touched reads FRESH — a fail-open exactly inverse to this lane's
 * purpose. (Falling back to idleMs also fixes the pre-existing
 * `Date.now() - 0` bug in the old hand-rolled version, which reported ~56
 * years of staleness for an unparseable `updated_at`.)
 */
function sessionStaleMs(
  ctx: { logsRoot: string },
  kind: string,
  sessionId: string,
  updatedAt: string | undefined,
  lifecycle: SessionLifecycle | null,
): number {
  const now = Date.now();
  const heartbeatMs = sessionHeartbeatMtimeMs(ctx.logsRoot, kind, sessionId);
  if (heartbeatMs !== null) return Math.max(0, now - heartbeatMs);
  const claimed = updatedAt !== undefined ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isNaN(claimed)) return Math.max(0, now - claimed);
  return lifecycle?.idleMs ?? 0;
}

function deriveRowLifecycle(
  ctx: { projectsRoot: string; logsRoot: string },
  descriptor: SessionKindDescriptor,
  phase: string,
  project: string,
  sessionId: string,
): { terminal: boolean; lifecycle: SessionLifecycle } {
  // Review fix (pre-existing, `pushRow`'s own note): `terminal` is derived
  // FIRST — cheap, and a terminal phase never has an affordance-table row.
  const terminal = isTerminalPhase(descriptor, phase);
  // W7-A2 — ONE lifecycle derivation per row (cli/bridge-studio-lifecycle.ts):
  // phase-row shape (awaits/step, or the legacy tables) + on-disk liveness
  // (stderr.log / .heartbeat / events.jsonl / turn.pid / status.json mtime),
  // computed at read time, never stored.
  const lifecycle = deriveSessionLifecycleFor({
    descriptor, phase, terminal, project, sessionId, projectsRoot: ctx.projectsRoot, logsRoot: ctx.logsRoot,
  });
  return { terminal, lifecycle };
}

/**
 * W8-A2 (ON-7 defect 1, review fix) — `loadSessionKinds` THROWS when
 * `studio/session-kinds.yaml` is missing/unreadable/malformed
 * (`loadSessionKindsSequence`'s own contract, orchestrator/studio/
 * session-kinds.ts). The pre-existing aggregate-index call site
 * (`collectStudioSessionIndexRows` below) accepted that risk unguarded —
 * every REAL forge install always has this file, so it never threw there in
 * practice. The four bespoke per-kind list routes this WI wires
 * `deriveRowLifecycle` into are exercised by many MORE pre-existing test
 * fixtures that never needed the registry before (their routes never called
 * `loadSessionKinds` at all) and do not set it up. An uncaught throw
 * mid-request there is not a clean 500 — none of these four GET handlers
 * wrap their body in try/catch, so the throw left `res.end()` never called
 * and the caller's `fetch()` hanging forever (reproduced: `cli/ui-bridge-
 * architect.test.ts` hung indefinitely against this fix before this
 * helper). Caught HERE, at the one place all four call it, and degrades to
 * "no descriptor resolved" — the SAME graceful "no lifecycle on this row"
 * fallback each route already has for a registry that resolved but simply
 * lacks this kind.
 */
function findSessionKindDescriptorSafe(forgeRoot: string, kind: string): SessionKindDescriptor | undefined {
  try {
    return loadSessionKinds(forgeRoot).find((d) => d.id === kind);
  } catch {
    return undefined;
  }
}

function collectStudioSessionIndexRows(ctx: { forgeRoot: string; projectsRoot: string; logsRoot: string }): SessionIndexRow[] {
  const descriptors = loadSessionKinds(ctx.forgeRoot);
  const rows: SessionIndexRow[] = [];
  // W8-B3 (sessions-kinds-R06/31) — resolved ONCE PER KIND for this request,
  // not once per row. The tier is a property of the KIND's agent, so a
  // per-row lookup would re-read the same SKILL.md for every session of that
  // kind — 24+ file reads on today's corpus, on a polled index route, for at
  // most 8 distinct answers. Request-scoped and thrown away afterwards, so it
  // is still derived at read time and a re-pointed SKILL.md is picked up on
  // the very next request; nothing is cached across requests.
  const tierByKind = new Map<string, string | null>();
  const fixedTierFor = (descriptor: SessionKindDescriptor): string | null => {
    const hit = tierByKind.get(descriptor.id);
    if (hit !== undefined) return hit;
    const resolved = fixedTierForSessionKind(ctx.forgeRoot, descriptor);
    tierByKind.set(descriptor.id, resolved);
    return resolved;
  };

  const pushRow = (
    descriptor: SessionKindDescriptor,
    sessionId: string,
    project: string,
    phase: string,
    modelTier: string | null,
    updatedAt: string,
  ): void => {
    // `SessionIndexRow.needsYou`'s own header: "a derivable operator
    // affordance exists at this phase" — a terminal session, by
    // definition, needs nothing further from the operator; `deriveRowLifecycle`
    // derives `terminal` before `lifecycle` so that is true structurally.
    const { terminal, lifecycle } = deriveRowLifecycle(ctx, descriptor, phase, project, sessionId);
    // W8-B3 (sessions-kinds-R06/31) — the SAME read-time fixed-tier fallback
    // the session shell applies (cli/session-model-tier.ts), so the index
    // MODEL column and the session's own chip can never disagree about what a
    // fixed-tier kind ran on. The index used to show "—" for every architect
    // and project-brain row for exactly this reason.
    const resolvedTier = modelTier ?? fixedTierFor(descriptor);
    rows.push({
      kind: descriptor.id,
      sessionId,
      project,
      phase,
      terminal,
      needsYou: lifecycle.needsYou,
      state: lifecycle.state,
      error: lifecycle.error,
      idleMs: lifecycle.idleMs,
      modelTier: resolvedTier,
      updatedAt,
      // W8-F6 (bead forge-6gv.27) — the ONE server-side builder of a session
      // address (cli/bridge-studio-sessions.ts), so the index and the route it
      // links to can never disagree about where a session lives. Every row
      // here is status.json-backed by construction (`readGuardedSessionIndexSummary`
      // above, and the four bespoke per-kind listers), i.e. already
      // `resolveReadableSession`'s `source:'status'` arm — pinned rather than
      // re-probed at runtime, which would be a guard that can never fail.
      href: sessionShellHref(descriptor.id, sessionId, project),
    });
  };

  for (const descriptor of descriptors) {
    if (descriptor.id === 'architect') {
      for (const s of listArchitectSessions(ctx.projectsRoot)) {
        pushRow(descriptor, s.session_id, s.project, s.phase, s.modelTier ?? null, s.updated_at);
      }
    } else if (descriptor.id === 'instructions') {
      for (const s of listInstructionsSessions(ctx.projectsRoot)) {
        pushRow(descriptor, s.session_id, s.project, s.phase, s.modelTier ?? null, s.updated_at);
      }
    } else if (descriptor.id === 'demo') {
      for (const s of listDemoSessions(ctx.projectsRoot)) {
        pushRow(descriptor, s.session_id, s.project, s.phase, s.modelTier ?? null, s.updated_at);
      }
    } else if (descriptor.id === 'project-brain') {
      for (const s of listProjectBrainSessions(ctx.projectsRoot)) {
        pushRow(descriptor, s.session_id, s.project, s.phase, s.modelTier ?? null, s.updated_at);
      }
    } else {
      const kindDirName = `_${descriptor.id}`;
      let projects: string[];
      try {
        projects = existsSync(ctx.projectsRoot) ? readdirSync(ctx.projectsRoot) : [];
      } catch {
        projects = [];
      }
      for (const project of projects) {
        const kindDir = join(ctx.projectsRoot, project, kindDirName);
        if (!existsSync(kindDir)) continue;
        let sessionIds: string[];
        try {
          sessionIds = readdirSync(kindDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
        } catch {
          continue;
        }
        for (const sessionId of sessionIds) {
          if (sessionId.startsWith('_')) continue; // skip _archived/, mirrors collectSessionRows
          const summary = readGuardedSessionIndexSummary(ctx.projectsRoot, project, kindDirName, sessionId);
          if (summary === null) continue; // unreadable/missing/escaping/hardlinked -> not a real session row
          pushRow(descriptor, sessionId, project, summary.phase, summary.modelTier, summary.updatedAt);
        }
      }
    }
  }
  return rows;
}

/** Deterministic ordering + bound for the aggregate sessions index —
 *  needs-you rows first, then newest-`updatedAt` first within each group;
 *  capped to the newest `cap` rows. Pure (no I/O), so it is unit-testable in
 *  isolation from the filesystem (ADR 042's "a pure function with an
 *  explicit error contract may be exported for direct tests" boundary).
 *  ISO-8601 timestamps compare correctly as plain strings; a `''`
 *  honest-absent `updatedAt` (kb-cleanup's shape today) sorts LAST within its
 *  needsYou group — an empty string is always lexically smaller than any real
 *  timestamp — never mistaken for "newest". */
export function sortAndCapSessionIndexRows(
  rows: readonly SessionIndexRow[],
  cap: number = SESSION_INDEX_MAX_ROWS,
): SessionIndexRow[] {
  return [...rows]
    .sort((a, b) => {
      if (a.needsYou !== b.needsYou) return a.needsYou ? -1 : 1;
      if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
      return 0;
    })
    .slice(0, cap);
}

/**
 * GET /api/studio/sessions[?active=1] — the aggregate sessions index backing
 * the /sessions page + Home's active-sessions strip. No path segments
 * (distinguishes it from `GET /api/studio/sessions/:kind/:id`,
 * bridge-studio-sessions.ts's single-session route — that regex requires
 * exactly two further path segments, this route requires none). Read-only —
 * covered by BRIDGE_ROUTE_CLASSIFICATION's blanket `{method:'GET',
 * route:'*'}` row (cli/dry-bridge.ts); no per-route table entry is needed
 * for a GET.
 *
 * `?active=1` filters to non-terminal rows only — the shape the /sessions
 * page and Home strip both request (operator-locked: in-flight sessions
 * ONLY, never terminal history). Omitting the query param returns every row
 * (terminal included), kept for testability and any future consumer that
 * genuinely wants the unfiltered set.
 */
async function handleStudioSessionsIndex(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HttpContext,
  url: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET' || pathOnly(url) !== '/api/studio/sessions') return false;
  const origin = allowedOrigin(req);
  try {
    const activeOnly = parseQuery(url).get('active') === '1';
    const allRows = collectStudioSessionIndexRows({ forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot, logsRoot: ctx.logsRoot });
    const filtered = activeOnly ? allRows.filter((r) => !r.terminal) : allRows;
    const sessions = sortAndCapSessionIndexRows(filtered);
    sendJson(res, 200, { sessions, cap: SESSION_INDEX_MAX_ROWS }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HttpContext,
): Promise<void> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';
  const origin = allowedOrigin(req);

  // CORS preflight for the browser fetch with content-type JSON.
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': origin,
      'vary': 'origin',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, x-forge-csrf',
    });
    res.end();
    return;
  }

  // ---- Webhook receipts (R2-04, ADR-041) ---------------------------------
  // POST /api/hooks/:hookId is called by EXTERNAL services (github/gitea/
  // gitlab), never by the Studio browser client — a webhook delivery cannot
  // carry the x-forge-csrf header (that header exists to defeat CROSS-ORIGIN
  // forgery from a browser; a server-to-server webhook is neither same-origin
  // nor a browser fetch). Its trust boundary is signature/token verification
  // (orchestrator/webhook-verify.ts), not the CSRF header, so this route is
  // dispatched — and therefore EXEMPT — BEFORE the anti-CSRF guard below runs.
  if (await handleHookRoutes(req, res, { forgeRoot: ctx.forgeRoot, queueRoot: ctx.queueRoot, logsRoot: ctx.logsRoot }, url, method)) return;

  // Anti-CSRF: every state-changing request must carry the custom header.
  // A non-safelisted header cannot be sent cross-origin without a preflight;
  // since we do not approve foreign-origin preflights, this blocks CSRF.
  if (method !== 'GET' && method !== 'OPTIONS') {
    if (!req.headers[CSRF_HEADER]) {
      sendJson(res, 403, { error: 'missing or invalid CSRF header' }, origin);
      return;
    }
  }

  if (method === 'GET' && url === '/api/health') {
    // F1: a JSON identity (not bare `ok`) so a second `forge studio` can tell a
    // healthy forge bridge from a stale/foreign listener and attach instead of
    // killing it. Probes still treat any 200 as "up", so readiness is unchanged.
    sendJson(res, 200, ctx.identity, origin);
    return;
  }
  if (method === 'GET' && url === '/api/cycles') {
    sendJson(res, 200, ctx.scanCycles(), origin);
    return;
  }
  // Feature #8 — daemon-stall liveness. The scheduler writes a `.heartbeat`
  // file (mtime = last beat) alongside each in-flight manifest. The max age
  // across in-flight cycles is the freshest signal that the daemon is making
  // progress; when it exceeds a GENEROUS multiple of staleHeartbeatMs the UI
  // surfaces a daemon-stalled state. forge does NOT hand-roll a watchdog — the
  // OS supervisor (systemd / pm2) restarts `forge serve`; this endpoint only
  // SURFACES the stall to the operator (see docs/operations/serve-supervision.md).
  if (method === 'GET' && url === '/api/liveness') {
    sendJson(res, 200, ctx.liveness(), origin);
    return;
  }
  if (method === 'GET' && url.startsWith('/api/events/')) {
    const cycleId = decodeURIComponent(url.slice('/api/events/'.length));
    // SEC-04 (bd forge-ebj) — cycleId is request-derived and, until now,
    // folded raw into `join(logsRoot, cycleId, 'events.jsonl')` with no
    // per-segment guard: a `%2F`-smuggled `../..` cycleId escaped `_logs`
    // entirely, and a symlinked `events.jsonl` leaf inside a real cycle dir
    // was followed out of root. Route the WHOLE path (cycleId as its OWN
    // segment under the trusted logsRoot, leaf included) through the guard;
    // a rejected/absent path both collapse to 404 (no existence oracle).
    // W7-A2 (sessions-kinds-24, home-sessions-11): a guard-CLEAN path whose
    // events.jsonl simply does not exist yet (a session minted seconds ago,
    // or one whose turn never ran) is 200 `{events: []}` — never a console
    // 404 on the operator's first screen. A guard-REJECTED path (traversal,
    // symlinked leaf/dir) stays 404 exactly as before — the sec04 pins
    // (cli/sec04-cycleid-containment.test.ts) hold.
    const eventsGuard = resolveGuardedPath(ctx.logsRoot, [cycleId, 'events.jsonl']);
    if (eventsGuard.ok && !eventsGuard.exists) {
      sendJson(res, 200, { cycleId, events: [] }, origin);
      return;
    }
    const raw = guardedReadFile(ctx.logsRoot, [cycleId, 'events.jsonl']);
    if (raw === null) {
      sendJson(res, 404, { error: 'no events.jsonl for cycle', cycleId }, origin);
      return;
    }
    try {
      const events: EventLogEntry[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
      sendJson(res, 200, { cycleId, events }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return;
  }
  if (method === 'GET' && url.startsWith('/api/cost/')) {
    // U1: cost summary per cycle (total + per-phase + per-skill).
    const cycleId = decodeURIComponent(url.slice('/api/cost/'.length));
    // SEC-04 (bd forge-ebj) — `summariseCycle` folds `cycleId` into
    // `join(logsRoot, cycleId, 'events.jsonl')` internally; gate the
    // request-derived cycleId (as its OWN segment under the trusted logsRoot)
    // through the per-segment identity guard BEFORE that read so a
    // `%2F`-smuggled `../..` cycleId or a symlinked cycle dir is refused. A
    // legitimately in-flight cycle whose dir does not yet exist stays valid
    // (create-mode ⇒ ok), so an empty summary is unaffected.
    const costCycleGuard = resolveGuardedPath(ctx.logsRoot, [cycleId]);
    if (!costCycleGuard.ok) {
      sendJson(res, 400, { error: 'invalid cycleId' }, origin);
      return;
    }
    try {
      const { summariseCycle } = await import('@forge/flows/metrics.ts');
      const m = summariseCycle(cycleId, ctx.logsRoot);
      sendJson(res, 200, {
        cycleId,
        totalUsd: m.total_cost_usd,
        perPhase: m.per_phase, // { phase: { cost_usd, iterations, duration_ms } }
        perSkill: m.per_skill, // { skill: { invocations, cost_usd, duration_ms } }
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return;
  }
  if (method === 'GET' && url.startsWith('/api/graph/')) {
    const cycleId = decodeURIComponent(url.slice('/api/graph/'.length));
    // Prefer the immutable cycle snapshot; fall back to the live worktree graph
    // while the cycle is still in-flight (the snapshot is only mirrored at cycle
    // end). Without this fallback a RESUMED cycle — whose PM phase is skipped, so
    // it has no snapshot until it finishes — serves no graph, and the WI hexes
    // vanish from the live hex view for the whole run. Mirrors /api/work-item.
    // SEC-04 (bd forge-ebj) — BOTH the snapshot path (cycleId under the
    // trusted logsRoot) and the live-worktree fallback (initiativeId, derived
    // from the request-supplied cycleId, under the trusted forgeRoot) are
    // request-derived. Route each through the per-segment identity guard with
    // the untrusted id as its OWN segment; a traversed cycleId or a symlinked
    // leaf/dir at either location is refused rather than followed out of root.
    const initiativeId = (cycleId.match(/_(INIT-.+)$/) ?? [, cycleId])[1] as string;
    const raw =
      guardedReadFile(ctx.logsRoot, [cycleId, 'work-items-snapshot', '_graph.md']) ??
      guardedReadFile(ctx.forgeRoot, ['_worktrees', initiativeId, '.forge', 'work-items', '_graph.md']);
    if (raw === null) {
      sendJson(res, 404, { error: 'no _graph.md for cycle', cycleId }, origin);
      return;
    }
    try {
      sendJson(res, 200, { cycleId, mermaid: raw }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return;
  }
  // Feature #9: single work-item definition for the hex-detail drawer. Serves
  // the on-disk WI snapshot the PM emitted — preferring the immutable cycle
  // snapshot (`_logs/<cycleId>/work-items-snapshot/<wiId>.md`), falling back to
  // the live worktree spec (`_worktrees/<initiativeId>/.forge/work-items/<wiId>.md`)
  // while the cycle is still in-flight (the snapshot is only mirrored at cycle
  // end). The cycleId encodes the initiativeId as `<timestamp>_<INIT-...>`.
  if (method === 'GET' && url.startsWith('/api/work-item/')) {
    const rest = decodeURIComponent(url.slice('/api/work-item/'.length));
    const slash = rest.indexOf('/');
    if (slash < 0) {
      sendJson(res, 400, { error: 'expected /api/work-item/<cycleId>/<wiId>' }, origin);
      return;
    }
    const cycleId = rest.slice(0, slash);
    const wiId = rest.slice(slash + 1);
    if (!cycleId || !wiId || !DEV_WORK_ITEM_ID_PATTERN.test(wiId)) {
      sendJson(res, 400, { error: 'cycleId and a WI-<n>[<letter>] wiId are required' }, origin);
      return;
    }
    // SEC-04 (bd forge-ebj) — cycleId is request-derived and was folded raw
    // into both `_logs/<cycleId>/...` and `_worktrees/<initiativeId>/...`; a
    // symlinked cycleId DIRECTORY and a symlinked `WI-<n>.md` LEAF both escaped
    // (wiId is already charset-gated above, but the cycleId hop was not).
    // Route each candidate (untrusted id as its OWN segment under a trusted
    // root, leaf included) through the per-segment identity guard.
    const initiativeId = (cycleId.match(/_(INIT-.+)$/) ?? [, cycleId])[1] as string;
    const found =
      guardedReadFile(ctx.logsRoot, [cycleId, 'work-items-snapshot', `${wiId}.md`]) ??
      guardedReadFile(ctx.forgeRoot, ['_worktrees', initiativeId, '.forge', 'work-items', `${wiId}.md`]);
    if (found === null) {
      sendJson(res, 404, { error: 'work item not found in snapshot or live worktree', cycleId, wiId }, origin);
      return;
    }
    try {
      const w = parseWorkItem(found);
      sendJson(res, 200, {
        work_item_id: w.work_item_id,
        acceptance_criteria: w.acceptance_criteria,
        files_in_scope: w.files_in_scope,
        quality_gate_cmd: w.quality_gate_cmd ?? [],
        body: w.body,
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return;
  }
  // Cycle-scoped artifact (PLAN.md / DEMO.md / etc.). The UI's /plan
  // and /demo sub-pages fetch these so the operator's interaction
  // points (verdict form) link to richer in-app views instead of
  // having to dig into the filesystem.
  // Path normalisation + a startsWith(logsRoot) check defeat
  // ../-escape attempts.
  if (method === 'GET' && url.startsWith('/api/artifact/')) {
    const rest = decodeURIComponent(url.slice('/api/artifact/'.length));
    const slash = rest.indexOf('/');
    if (slash < 0) {
      sendJson(res, 400, { error: 'expected /api/artifact/<cycleId>/<filename>' }, origin);
      return;
    }
    const cycleId = rest.slice(0, slash);
    const filename = rest.slice(slash + 1);
    if (!cycleId || !filename) {
      sendJson(res, 400, { error: 'cycleId and filename are required' }, origin);
      return;
    }
    // The startsWith(safeBase) check below builds safeBase from the SAME
    // cycleId, so a traversal INSIDE cycleId (e.g. '..') normalises into both
    // sides identically and passes it — validate the segment itself
    // (2026-07-24 adversarial review; same predicate as isSafeRunId).
    if (!/^[A-Za-z0-9._-]+$/.test(cycleId) || cycleId.includes('..')) {
      sendJson(res, 400, { error: 'invalid cycleId' }, origin);
      return;
    }
    // W7-C3 (bd forge-0u4), re-cut by the W7-C3 review (A-M6) — the FILENAME
    // dimension is enumerated as a DENY of the shapes that matter, sharing
    // the guard's OWN per-segment predicate (`isSafeSubPath`) so the cheap
    // 400 layer and the containment 404 layer cannot drift. The first cut was
    // an allow-list charset (`/^[A-Za-z0-9._-]+$/` + `.includes('..')`) and
    // was a fails-closed regression: it 400'd 55 of 508 real on-disk artifact
    // files (10.8%, all `.capture/{before,after}/*.out` demo evidence named
    // from AC titles) while every real attack shape was ALREADY refused by
    // `guardedReadFile` below. Legitimate names with spaces, parentheses,
    // em-dashes and a leading `..` pass; separators, `.`/`..` segments, empty
    // segments, control characters, NUL, DEL and encoded separators do not.
    // Pinned both ways in cli/sec04-cycleid-containment.test.ts (a real
    // `.capture` name serves 200; every escape shape still refused) and per
    // predicate in cli/studio-path-guard.test.ts.
    if (!isSafeSubPath(filename)) {
      sendJson(res, 400, { error: 'invalid filename' }, origin);
      return;
    }
    const filenameSegments = filename.split('/');
    // SEC-04 (bd forge-ebj) — the lexical `startsWith(safeBase)` above was
    // blind to a SYMLINKED leaf: `artifacts/<filename>` real-located inside a
    // genuine cycle dir but pointing out of root passed it and readFileSync
    // followed it. Route the WHOLE path (cycleId + fixed `artifacts` + the
    // filename segments, all under the trusted logsRoot) through the
    // per-segment identity + nlink guard, which the lexical check cannot do.
    let body = guardedReadFile(ctx.logsRoot, [cycleId, 'artifacts', ...filenameSegments]);
    // W7-D1 — PARITY with `deriveArtifacts` (orchestrator/run-model-derive.ts),
    // which marks `pr` ready when `pr-description.md` exists in EITHER
    // `artifacts/` OR the cycle-log ROOT ("accept the legacy cycle-log-root
    // location too so older frozen logs still resolve"). This route only ever
    // read `artifacts/`, so a frozen pre-mirror cycle advertised a PR tab in
    // `artifactsReady` and 404'd when the operator clicked it — a declaration
    // enforced by nothing, found by the Wave D crawl on
    // 2026-06-18T10-27-18_INIT-2026-06-17-release-definition-permissions-coverage.
    //
    // Deliberately ONE exact filename, and only as a FALLBACK after the
    // modern location misses: the cycle-log root also holds events.jsonl,
    // report.md, retro.md and user-questions.json, none of which may become
    // servable as a side effect. It goes through the SAME `guardedReadFile`,
    // so a symlinked legacy copy is refused exactly as a symlinked modern one
    // is. All four directions pinned in sec04-cycleid-containment.test.ts.
    if (body === null && filename === LEGACY_ROOT_ARTIFACT) {
      body = guardedReadFile(ctx.logsRoot, [cycleId, LEGACY_ROOT_ARTIFACT]);
    }
    if (body === null) {
      sendJson(res, 404, { error: 'artifact not found', cycleId, filename }, origin);
      return;
    }
    try {
      res.writeHead(200, servedFileHeaders(filename, origin));
      res.end(body);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return;
  }

  // ---- Architect (ADR 020) ----------------------------------------------
  if (await handleArchitect(req, res, ctx, url, method)) return;
  // ---- Instructions-creator (Stage A) -----------------------------------
  if (await handleInstructions(req, res, ctx, url, method)) return;
  // ---- Demo-builder (Stage B) -------------------------------------------
  if (await handleDemoBuilder(req, res, ctx, url, method)) return;
  if (await handleReflect(req, res, ctx, url, method)) return;
  // ---- Studio read routes (M1-2) + write routes (M2-2) -------------------
  // DEC-6 recovery surface (GET inspect + POST abandon/requeue/initiatives). GET is
  // read-only; the POSTs are gated by the x-forge-csrf guard above.
  if (await handleRecoveryRoutes(req, res, { forgeRoot: ctx.forgeRoot, queueRoot: ctx.queueRoot, logsRoot: ctx.logsRoot, projectsRoot: ctx.projectsRoot }, url, method)) return;
  if (await handleStudioRoutes(req, res, {
    forgeRoot: ctx.forgeRoot,
    logsRoot: ctx.logsRoot,
    // W8-F6 (bead forge-6gv.27) — this file is the one place that imports BOTH
    // cli/bridge-studio.ts and cli/bridge-studio-sessions.ts, so it wires the
    // readability predicate in rather than letting the runs routes import it
    // and close a module cycle. Same seam, same reason, as `ensureSessionTail`.
    sessionIsReadable: ({ kind, sessionId }) => sessionIsReadable({
      projectsRoot: ctx.projectsRoot, logsRoot: ctx.logsRoot, kind, sessionId,
    }),
  }, url, method)) return;
  if (await handleStudioWriteRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioKbRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioKbDrainRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioSkillsRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioHooksRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioAuthoringRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioTemplatesRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  // W6-B2 — the generic session-detail GET is the ONLY read route authoring
  // and kb-cleanup sessions have (no per-kind list route like architect/
  // instructions/demo-builder/project-brain); ensureSessionTail must be
  // threaded through here to close bd forge-2ee's "no consumer reads the
  // authoring spine's events dir" half.
  // W6-B11 — the aggregate sessions-index GET. Checked before the
  // single-session route immediately below: distinct URL shapes (no path
  // segments vs exactly two), so ordering doesn't affect matching, but this
  // keeps the two GET /api/studio/sessions... routes textually adjacent.
  if (await handleStudioSessionsIndex(req, res, ctx, url, method)) return;
  if (await handleStudioSessionsRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot, ensureSessionTail: ctx.ensureSessionTail }, url, method)) return;
  // W7-A2 — the generic session CANCEL route. MUST be dispatched BEFORE the
  // affordance write route immediately below: that route's regex matches
  // any `/api/studio/sessions/:kind/:sid/<segment>` and would swallow the
  // literal `cancel` segment as an affordance id (409 "not available").
  // W7-C2 T1 review (A12) — ONE per-kind live-refresh mapping, shared by the
  // cancel route and the generic affordance WRITE route below (which used to
  // keep its own inline instructions/demo pair). A kind with no
  // `*-list-changed` message in the bridge's WS vocabulary (authoring /
  // kb-cleanup) honestly no-ops here; those surfaces refresh on the
  // session shell's own poll.
  const broadcastKindChanged = (kind: string): void => {
    if (kind === 'architect') ctx.broadcastArchitectChanged();
    else if (kind === 'instructions') ctx.broadcastInstructionsChanged();
    else if (kind === 'demo') ctx.broadcastDemoChanged();
    else if (kind === 'project-brain') ctx.broadcastProjectBrainChanged();
  };
  if (await handleSessionCancelRoute(req, res, {
    forgeRoot: ctx.forgeRoot,
    logsRoot: ctx.logsRoot,
    broadcastKindChanged,
  }, url, method)) return;
  // W6-B4 (ADR-043 2026-08-15 amendment §1) — the generic session-affordance
  // WRITE endpoint. `spawnAgentTurn` is INJECTED (passed by reference, this
  // module's own function) rather than imported by bridge-studio-affordances.ts
  // — see that file's own header for why (bridge-studio-*.ts modules never
  // import FROM ui-bridge.ts).
  if (await handleStudioAffordanceRoutes(req, res, {
    forgeRoot: ctx.forgeRoot,
    logsRoot: ctx.logsRoot,
    spawnAgentTurn,
    // W7-C2 T1 review (A12) — the SAME per-kind mapping the cancel route
    // above is injected with, so there is exactly one place that knows which
    // kinds have a list-changed WS event.
    broadcastKindChanged,
  }, url, method)) return;
  if (await handleStudioInstructionsRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  // W6-B6 fix — the per-slug capability route, resolved against the
  // UNFILTERED agent defs (bypasses the library:false roster gate
  // /api/studio/agents applies). Adjacent to the instructions-draft route:
  // same /api/studio/agents/:slug/... URL family, same guarded-path posture.
  if (await handleStudioAgentCapabilityRoute(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioConnectionsRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioCommunityRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  // ---- Studio POST write routes (M3-4): run start/resume + gate verdicts --
  const studioPostCtx: StudioPostContext = {
    forgeRoot: ctx.forgeRoot,
    logsRoot: ctx.logsRoot,
    queueRoot: ctx.queueRoot,
    projectsRoot: ctx.projectsRoot,
    mergePr: ctx.mergePr,
    finalizeAfterMerge: ctx.finalizeAfterMerge,
    runReleaseFinalize: ctx.runReleaseFinalize,
    broadcastArchitectChanged: ctx.broadcastArchitectChanged,
  };
  if (await handleStudioPostRoutes(req, res, studioPostCtx, url, method)) return;

  // Scheduler lifecycle.
  if (method === 'GET' && url === '/api/scheduler/status') {
    const state = daemonState(ctx.forgeRoot, ctx.queueRoot);
    sendJson(res, 200, state, origin);
    return;
  }
  if (method === 'POST' && url === '/api/scheduler/start') {
    if (isDryBridge()) {
      refuseDryBridge(res, origin, { route: '/api/scheduler/start', method, action: 'daemon', logsRoot: ctx.logsRoot });
      return;
    }
    try {
      // M7-5 (ADR-031): start the detached `forge serve` daemon DIRECTLY via
      // the shared helper — the bridge no longer shells out to a `forge start`
      // CLI command (it's been deleted). Behaviour is identical: detached
      // child, stdout/stderr → _logs/daemon/serve.log, pid → forge.pid.
      // `spawnServeDetached` is the ONE liveness authority (null = a live
      // daemon already owns the pid file); the route never re-derives it.
      const result = spawnServeDetached(ctx.forgeRoot);
      if (result === null) {
        // W7-FIX-A3 (round-2 finding 4): Start is NOT Resume. A daemon that is
        // already running was not started by this click, and its `.paused`
        // flag is a deliberate, queue-wide decision another tab may have just
        // made — clearing it here (as this route used to, before the check)
        // meant a stale tab's Start silently resumed claiming with no operator
        // intent. The real state is reported instead; Resume is the control
        // that clears the flag.
        const state = daemonState(ctx.forgeRoot, ctx.queueRoot);
        sendJson(res, 200, { ok: true, alreadyRunning: true, state }, origin);
        return;
      }
      // W7-FIX-A3 (A3-05): a FRESH start keeps the card's promise ("queued
      // work will run once you start it"). `.paused` is a queue flag
      // independent of process liveness, so pause → stop → Start used to bring
      // the daemon back with the stale flag armed and every claim refused. The
      // scheduler re-reads the flag on every poll, so clearing it here — after
      // the spawn, inside the branch that actually started something — is
      // honest for the daemon we just launched and leaves a running one alone.
      setPaused(false, ctx.queueRoot);
      // Best-effort wait for the daemon to come up before reporting state.
      await sleep(800);
      const after = daemonState(ctx.forgeRoot, ctx.queueRoot);
      sendJson(res, 200, { ok: true, started: true, state: after }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return;
  }
  // Pause / resume — toggle the `<queueRoot>/.paused` flag the scheduler
  // reads each poll. In-flight cycles keep running; only new claims stop.
  if (method === 'POST' && (url === '/api/scheduler/pause' || url === '/api/scheduler/resume')) {
    try {
      const pause = url.endsWith('/pause');
      setPaused(pause, ctx.queueRoot, pause ? 'paused from UI' : '');
      sendJson(res, 200, { ok: true, state: daemonState(ctx.forgeRoot, ctx.queueRoot) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return;
  }
  // Stop — SIGTERM the daemon; it drains in-flight cycles then exits. We
  // don't block the request on the drain — the status poll reflects
  // `running:false` once it's down. W7-FIX-A3 (A3-07): the signalled pid is
  // MARKED (`_logs/daemon/stopping`) so `daemonState` reports `stopping:true`
  // to every poller for as long as that pid drains — Stop is not a silent
  // control, and a second tab / a reload sees the same transitional state.
  if (method === 'POST' && url === '/api/scheduler/stop') {
    if (isDryBridge()) {
      refuseDryBridge(res, origin, { route: '/api/scheduler/stop', method, action: 'daemon', logsRoot: ctx.logsRoot });
      return;
    }
    try {
      const { pidFile, stoppingFile } = daemonPaths(ctx.forgeRoot);
      const pid = readPid(pidFile);
      if (pid === null || !isAlive(pid)) {
        clearPidFile(ctx.forgeRoot);
        sendJson(res, 200, { ok: true, alreadyStopped: true, state: daemonState(ctx.forgeRoot, ctx.queueRoot) }, origin);
        return;
      }
      // W7-FIX-A3 (round-2 finding 3): Stop is IDEMPOTENT while THIS pid
      // drains. `orchestrator/scheduler.ts`'s signal handler treats a SECOND
      // SIGTERM as force-quit (`signalCount === 2` → exit), so re-signalling a
      // pid that is already draining hard-kills the in-flight cycles the first
      // Stop was politely waiting on — from nothing more than a second tab, or
      // one whose 10s poll had not yet flipped to `stopping`. The marker this
      // route writes is exactly the fact needed to make the repeat a no-op; a
      // marker naming any OTHER pid is stale and never suppresses a real Stop.
      if (readPid(stoppingFile) === pid) {
        sendJson(res, 200, { ok: true, alreadyStopping: true, state: daemonState(ctx.forgeRoot, ctx.queueRoot) }, origin);
        return;
      }
      process.kill(pid, 'SIGTERM');
      markStopping(ctx.forgeRoot, pid);
      sendJson(res, 200, { ok: true, stopping: true, state: daemonState(ctx.forgeRoot, ctx.queueRoot) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return;
  }

  // Start development (S7 / DEC-3) — the roadmap "start development" button.
  // Repoints each initiative's manifest at the forge-develop flow and makes it
  // claimable (the real enqueue behind the develop trigger). Batch (plan-
  // everything-before-kickoff): the roadmap can decompose N initiatives up
  // front, so kickoff accepts N ids at once and reports a per-id result
  // rather than one HTTP status for the whole request. The global CSRF guard
  // above (x-forge-csrf) already gates this POST.
  if (method === 'POST' && url === '/api/develop/start') {
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const rawIds = body['initiativeIds'];
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        sendJson(res, 400, { error: 'initiativeIds required (non-empty string array)' }, origin);
        return;
      }
      // Validate the WHOLE batch before any enqueue — a mixed-validity request
      // is rejected outright (no silent filtering, no partial side effects).
      const invalid = rawIds
        .map((v, i) => ({ v, i }))
        .filter(({ v }) => typeof v !== 'string' || v.length === 0);
      if (invalid.length > 0) {
        const named = invalid.map(({ v, i }) => `[${i}]=${JSON.stringify(v)}`).join(', ');
        sendJson(res, 400, { error: `initiativeIds contains invalid entries (must be non-empty strings): ${named}` }, origin);
        return;
      }
      // Dedupe, preserving first-occurrence order — one enqueue + one result per id.
      const initiativeIds = [...new Set(rawIds as string[])];

      // forge-shc WI-1 (T1 ruling): an operator per-run cost-ceiling override
      // is accepted ONLY on a single-id batch — a single scalar can't map
      // onto N manifests unambiguously. Validated fully BEFORE any enqueue
      // side effect (mirrors the 3-stage discipline at
      // `POST /api/agents/:slug/run` — batch-shape, then value bounds — a
      // refused request never repoints or stamps any manifest).
      let costCeilingUsd: number | undefined;
      if (body.costCeilingUsd !== undefined) {
        if (initiativeIds.length > 1) {
          sendJson(
            res,
            400,
            { error: `costCeilingUsd may only be supplied with a single initiativeId (got ${initiativeIds.length})` },
            origin,
          );
          return;
        }
        const v = body.costCeilingUsd;
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_KICKOFF_COST_CEILING_USD) {
          sendJson(
            res,
            400,
            { error: `invalid costCeilingUsd: ${JSON.stringify(v)} (must be a finite number > 0 and <= ${MAX_KICKOFF_COST_CEILING_USD})` },
            origin,
          );
          return;
        }
        costCeilingUsd = v;
      }

      // W8-A3 (`flows-37`, review round 2 finding 2): the operator's answer to a
      // repoint, forwarded like the other two doors. Without it NO client could
      // confirm through this route at all — the per-card "Start development"
      // control posts exactly ONE named initiative and was left telling the
      // operator to "confirm the repoint" through a route with no way to.
      //
      // Review round 3, S2-4: it is REFUSED for a multi-id batch, before any
      // enqueue runs — the same shape `costCeilingUsd` uses 30 lines above, and
      // for the same reason. A confirmation that accompanies N ids rubber-stamps
      // N moves the calling surface cannot show, which is the shape this lane
      // exists to remove; leaving that as a client-side convention while the
      // route accepted it is precisely the doctrine this module writes down and
      // would then have violated.
      const developConfirmRepointFrom = typeof (body as Record<string, unknown>)?.['confirmRepointFrom'] === 'string'
        ? ((body as Record<string, unknown>)['confirmRepointFrom'] as string)
        : undefined;
      if (developConfirmRepointFrom !== undefined && initiativeIds.length > 1) {
        sendJson(
          res,
          400,
          { error: 'confirmRepointFrom is only valid for a single-initiative request — a batch cannot confirm a move it cannot show' },
          origin,
        );
        return;
      }

      const results = initiativeIds.map((initiativeId) => {
        // Per-item isolation: a throw on one item must not 500 away the
        // results of items whose side effects already applied.
        try {
          const result = enqueueDevelopRun(initiativeId, { queueRoot: ctx.queueRoot, confirmRepointFrom: developConfirmRepointFrom });
          if (result.status === 'enqueued' && costCeilingUsd !== undefined) {
            // Single-id-only invariant (checked above) means this fires at
            // most once per request — stamp only when the operator supplied
            // an explicit, already-validated ceiling; never fabricate one.
            // shc review finding 2: fold the REAL outcome into the per-item
            // result as `ceilingStamped` — a silently-failed stamp (the
            // manifest went missing/unwritable between enqueue and stamp)
            // must stay distinguishable from a landed one, never reported as
            // an unconditional success.
            const pendingPath = join(getPaths(ctx.queueRoot).pending, `${initiativeId}.md`);
            const ceilingStamped = persistManifestCostCeiling(pendingPath, costCeilingUsd);
            return { ...result, ok: result.status === 'enqueued', ceilingStamped };
          }
          return { ...result, ok: result.status === 'enqueued' };
        } catch (err) {
          return { status: 'error' as const, initiativeId, ok: false, detail: sanitizeError(err) };
        }
      });
      const ok = results.every((r) => r.ok);
      sendJson(res, 200, { ok, results }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }

  // Generic agent run status (R2-01-F3) — GET /api/agents/runs/<runId>. Reads
  // the run's `_logs/<runId>/events.jsonl` and reports {state, costUsd, events}
  // so the agent-page RunPanel shows live status + cost (the F1 "events/cost
  // visible" AC) without a bespoke per-agent monitor.
  //
  // R6-04 WI-4: also reports `lines` — the run's own parsed event records,
  // capped to RUN_LOG_LINES_MAX and TAIL-preserving (most-recently-written
  // lines survive the cap, not the earliest ones) — so the standalone run
  // view can render a live log off this SAME poll rather than a second
  // endpoint or re-reading the JSONL file client-side. `state`/`costUsd`/
  // `events` keep their EXACT current meaning (`events` stays the COUNT,
  // uncapped) — both response call sites below (the early return when no
  // events file exists yet, and the main JSONL-parsing path) return `lines`
  // so the shape never differs between branches of this one endpoint.
  //
  // R6-04 D22 follow-up: a genuinely unknown runId (no `_logs/<runId>`
  // directory at all — never dispatched) now 404s instead of fabricating
  // `state: 'running'`, so `RunView.tsx`'s `found:false` prop actually has a
  // real signal to key off. This check is deliberately keyed off the RUN
  // DIRECTORY, not `events.jsonl` — a real, freshly-dispatched run's
  // directory exists before its first event lands, and that case must keep
  // reporting 200/`running`/`lines: []`, not 404.
  // W7-B5 (agents-03/04/39) — the aggregate recent-runs route. Matched
  // BEFORE the per-runId detail route below ('recent' is not a real run id;
  // real ids are `_agent-*` or cycle-shaped, so no collision is possible,
  // but the order makes it structural rather than lucky).
  if (method === 'GET' && (url === '/api/agents/runs/recent' || url.startsWith('/api/agents/runs/recent?'))) {
    try {
      const qs = url.includes('?') ? new URLSearchParams(url.slice(url.indexOf('?') + 1)) : new URLSearchParams();
      const rawLimit = qs.get('limit');
      let limit = RECENT_AGENT_RUNS_DEFAULT_LIMIT;
      if (rawLimit !== null) {
        const parsedLimit = Number(rawLimit);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > RECENT_AGENT_RUNS_MAX_LIMIT) {
          sendJson(res, 400, { error: `invalid limit: ${JSON.stringify(rawLimit)} (must be an integer 1..${RECENT_AGENT_RUNS_MAX_LIMIT})` }, origin);
          return;
        }
        limit = parsedLimit;
      }
      // Review round 1 — `kind` is a SERVER-SIDE filter, applied before the
      // bound. Home merges this ledger with its OWN flow-run rows and drops
      // every duplicate, so on an install with `limit` or more recent flow
      // runs the entire window came back as rows Home already had and threw
      // away, leaving zero standalone agent rows on the page. Asking the
      // server for rows the caller will discard is the bug; `kind` lets Home
      // spend its budget on the rows only this route can supply.
      const rawKind = qs.get('kind');
      if (rawKind !== null && rawKind !== 'flow' && rawKind !== 'standalone' && rawKind !== 'all') {
        sendJson(res, 400, { error: `invalid kind: ${JSON.stringify(rawKind)} (must be "flow", "standalone" or "all")` }, origin);
        return;
      }
      const kind = (rawKind ?? 'all') as 'flow' | 'standalone' | 'all';
      sendJson(res, 200, { ok: true, rows: collectRecentAgentRuns(ctx.forgeRoot, ctx.logsRoot, limit, kind) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }

  // W7-B5 (agents-30 / projects-29) — cancel a dispatched standalone run.
  // CSRF: the global x-forge-csrf guard above already gates every POST.
  // Containment: `runId` passes isSafeRunId (single `_logs/` segment) and
  // the SAME resolveGuardedPath choke point the detail route uses; a
  // rejected guard and a genuinely absent run collapse into ONE 404.
  if (method === 'POST' && url.startsWith('/api/agents/runs/') && url.endsWith('/cancel')) {
    // Review round 1: `decodeURIComponent` throws `URIError` on a malformed
    // escape (`%E0%A4%A`), and `handleHttp` is invoked as `void handleHttp(…)`
    // with no top-level catch — an unhandled rejection that never writes a
    // response and, under `--unhandled-rejections=throw`, takes the bridge
    // down. Same guard shape the sibling history route in this file already
    // applies to its own decode.
    let runId: string;
    try {
      runId = decodeURIComponent(url.slice('/api/agents/runs/'.length, url.length - '/cancel'.length));
    } catch {
      sendJson(res, 400, { error: 'invalid runId: malformed percent-encoding' }, origin);
      return;
    }
    if (!isSafeRunId(runId)) {
      sendJson(res, 400, { error: `invalid runId: ${JSON.stringify(runId)}` }, origin);
      return;
    }
    // Review round 1 — SCOPE. `isSafeRunId` gates CHARSET, not identity:
    // every cycle id under `_logs/` passes it too. Without this check,
    // cancelling a live develop cycle's id found a real `_logs/<cycleId>`,
    // derived `running` (no `end` event yet), found no `turn.pid`, and
    // answered `200 {ok:true, killed:false}` — having appended an
    // `agent-dispatch.cancelled` line into the RUNNING cycle's own
    // events.jsonl. The cycle kept going, the operator was told it had been
    // cancelled, and a marker no flow-run derivation expects was left in a
    // real cycle log. Reachable, not hypothetical: `GET /api/agents/runs/
    // recent` serves flow-run rows whose `id` IS a cycle id. This route
    // cancels STANDALONE dispatches only — a flow run is cancelled through
    // its own flow/scheduler surface.
    if (!runId.startsWith(STANDALONE_RUN_DIR_PREFIX)) {
      sendJson(
        res,
        400,
        { error: `not a standalone agent run: ${JSON.stringify(runId)} (this route cancels ${JSON.stringify(STANDALONE_RUN_DIR_PREFIX)}* dispatches; cancel a flow run from its flow)` },
        origin,
      );
      return;
    }
    const cancelDirGuard = resolveGuardedPath(ctx.logsRoot, [runId]);
    if (!cancelDirGuard.ok || !cancelDirGuard.exists) {
      sendJson(res, 404, { error: `no run found for id ${JSON.stringify(runId)}` }, origin);
      return;
    }
    try {
      const current = deriveStandaloneRunState(ctx.logsRoot, runId);
      // W8-A2 (ON-7 defect 4) — 'stalled' is NOT terminal (applyStandaloneStaleness's
      // own doc comment: it only ever narrows 'running'). A stalled run is
      // exactly the shape an operator most wants to cancel — a wedged or
      // zombie process — so this MUST stay cancellable, or 'stalled' becomes
      // a state an operator can see but never act on. Before this fix every
      // non-'running' state WAS terminal; that implicit equivalence broke
      // the moment 'stalled' stopped being one — caught here, not shipped.
      if (current.state !== 'running' && current.state !== 'stalled') {
        sendJson(res, 409, { error: `run is already terminal (${current.state}) — nothing to cancel` }, origin);
        return;
      }
      // Kill the tracked dispatch child if one is alive AND provably ours
      // (its argv carries this runId as a whole element — the `--run-id`
      // value `spawnAgentDispatch` passed). A dead/unowned/absent pid is an
      // honest `killed:false`; the marker below still lands either way, so
      // the run reads `cancelled` (sticky) rather than `running` forever.
      const killed = killTrackedRun(ctx.logsRoot, runId);
      createLogger(runId, ctx.logsRoot).emit({
        initiative_id: runId,
        phase: 'orchestrator',
        skill: 'ui-bridge',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'agent-dispatch.cancelled',
        metadata: { killed, cancelled_by: 'operator' },
      });
      sendJson(res, 200, { ok: true, killed }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }

  if (method === 'GET' && url.startsWith('/api/agents/runs/')) {
    const runId = decodeURIComponent(url.slice('/api/agents/runs/'.length));
    if (!isSafeRunId(runId)) {
      sendJson(res, 400, { error: `invalid runId: ${JSON.stringify(runId)}` }, origin);
      return;
    }
    // R6-06 round 6: this route's `runId` reaches `_logs/<runId>` the SAME
    // way an enumerated history-route entry does — `isSafeRunId` gates
    // charset/shape only, never containment, so a poisoned `_logs/<runId>`
    // (a directory symlink, mirroring escape 1) would previously have been
    // followed by a plain `existsSync`. Guarded here with the SAME
    // `resolveGuardedPath` choke point `deriveStandaloneRunState` now uses
    // internally for the leaf — a rejected guard and a genuinely absent
    // directory both collapse into the SAME 404 (never dispatched), never a
    // distinguishable error.
    const runDirGuard = resolveGuardedPath(ctx.logsRoot, [runId]);
    if (!runDirGuard.ok || !runDirGuard.exists) {
      sendJson(res, 404, { error: `no run found for id ${JSON.stringify(runId)}` }, origin);
      return;
    }
    try {
      // D3.5/shared-derivation (R6-06 WI-1): the SAME function the new
      // history route's standalone-path rows use — see
      // `deriveStandaloneRunState`'s own doc comment. `costUsd: null` (not a
      // fabricated `0`) once a run has no `end` event yet — Amendment 2.
      const derived = deriveStandaloneRunState(ctx.logsRoot, runId);
      // W7-B5 (agents-20): a LIVE standalone run must be tailed so the
      // thinking drawer/run page stream instead of freezing. Re-armed here
      // (the panel/run page poll this route) so a WS reconnect — which
      // resets every tail — recovers on the next poll tick.
      // Arm while live, RELEASE once terminal (review round 1) — otherwise
      // a finished run's immutable log keeps being polled for the whole life
      // of the Studio session.
      if (derived.state === 'running') ctx.ensureAgentRunTail(runId);
      else ctx.releaseAgentRunTail(runId);
      sendJson(res, 200, {
        ok: true,
        state: derived.state,
        costUsd: derived.costUsd,
        events: derived.events,
        lines: derived.lines,
        // W7-B5: outputRefs (agents-06) + errorText (agents-19) + ceilingUsd
        // (agents-31) — see StandaloneRunState's field docs.
        outputRefs: derived.outputRefs,
        ...(derived.errorText !== undefined ? { errorText: derived.errorText } : {}),
        ...(derived.ceilingUsd !== undefined ? { ceilingUsd: derived.ceilingUsd } : {}),
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }

  // Agent run-history ledger (R6-06 WI-1) — GET /api/agents/:slug/history.
  // Joins THREE execution paths an agent can have run through — a flow-node
  // (inside a seeded flow run), a standalone dispatch, and an interactive
  // session — into one ledger, each row carrying that TARGET's own
  // status/cost (D3), never a run-level aggregate. D5: `slug` is a FILTER
  // applied over enumerated directory entries / already-loaded declarative
  // data — it is NEVER joined into a filesystem path, so no traversal shape
  // can escape `_logs/`/`projects/`; an unknown OR traversal-shaped slug both
  // resolve to the same honest `{ok:true, rows:[]}` (nothing enumerated
  // matched), never a 404/500/leak.
  // D5 collapse case: a slug of exactly '..' never reaches this route as
  // `/api/agents/../history` via `fetch()` — the HTTP CLIENT (browsers/undici
  // apply RFC 3986 dot-segment removal before the request ever leaves the
  // process) collapses that path client-side. A raw, non-normalizing client
  // sending the literal un-collapsed bytes `GET /api/agents/../history` still
  // reaches the enumeration-filter route below with slug '..' and is handled
  // correctly there — no path is ever joined from the slug either way, so no
  // dedicated handler for the collapsed literal `/api/history` is needed.
  if (method === 'GET' && url.startsWith('/api/agents/') && url.endsWith('/history')) {
    let slug: string;
    try {
      slug = decodeURIComponent(url.slice('/api/agents/'.length, url.length - '/history'.length));
    } catch {
      sendJson(res, 400, { error: 'invalid agent slug (malformed percent-encoding)' }, origin);
      return;
    }
    // W7-B5 (agents-02): an empty or shape-invalid slug is a CLIENT BUG, not
    // a filter that happens to match nothing — the RunPanel used to fire
    // `GET /api/agents//history` on every mount and this route answered 200.
    // Same validator the POST /run route applies to the same path segment.
    if (!SAFE_AGENT_SLUG_RE.test(slug)) {
      sendJson(res, 400, { error: `invalid agent slug: ${JSON.stringify(slug)}` }, origin);
      return;
    }
    try {
      const rows: AgentHistoryRow[] = [
        ...collectFlowNodeRows(ctx.forgeRoot, slug),
        ...collectStandaloneRows(ctx.logsRoot, slug),
        ...collectSessionRows(ctx, slug),
      ];
      sendJson(res, 200, { ok: true, rows }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }

  // Generic agent run (R2-01-F3 dispatch half) — POST /api/agents/<slug>/run.
  // Dispatches ONE non-interactive roster agent standalone through the F1
  // runAgent primitive: the agent-page run surface any runnable agent plugs
  // into (the onboarding agent's first consumer, R4-02-F1). Mirrors
  // spawnAgentTurn — validate + generate a runId, spawn `agent dispatch`
  // detached (dry-bridge guarded), and hand the runId back so the UI links to
  // the monitor. Interactive agents (architect/instructions/…) are refused
  // here, not just hidden in the UI — resolveDispatchableAgent is the backstop.
  if (method === 'POST' && url.startsWith('/api/agents/') && url.endsWith('/run')) {
    const slug = decodeURIComponent(url.slice('/api/agents/'.length, url.length - '/run'.length));
    if (!SAFE_AGENT_SLUG_RE.test(slug)) {
      sendJson(res, 400, { error: `invalid agent slug: ${JSON.stringify(slug)}` }, origin);
      return;
    }
    try {
      const body = (await readJson(req)) as { project?: unknown; inputs?: unknown; materials?: unknown; costCeilingUsd?: unknown };
      // Resolve + validate against the live roster (unknown/interactive → 400).
      let def: ReturnType<typeof resolveDispatchableAgent>;
      try {
        def = resolveDispatchableAgent(slug, listAgentDefinitions(skillsDir(ctx.forgeRoot)));
      } catch (err) {
        sendJson(res, 400, { error: sanitizeError(err) }, origin);
        return;
      }
      // W7-B5 (agents-21): a 'ralph'-strategy agent cannot run standalone at
      // all — `runAgent` refuses multi-iteration loops (orchestrator-band),
      // so pre-B5 this route happily minted a run that then always died with
      // agent-dispatch.failed. Refuse HERE, before any run dir exists, with
      // the honest reason the UI can show next to the Run control.
      if (def.runtime.loopStrategy === 'ralph') {
        sendJson(
          res,
          400,
          {
            error:
              `agent "${slug}" declares loopStrategy 'ralph' — multi-iteration loops run inside the develop flow ` +
              `(orchestrator-band), never as a standalone dispatch. Start it through its flow instead.`,
          },
          origin,
        );
        return;
      }
      // R3-04 D9.2 — pre-spawn connection-readiness refusal, BEFORE
      // spawnAgentDispatch is ever called: same shared derivation
      // (`unreadyConnectionsFor`/`formatUnreadyConnections`,
      // `orchestrator/studio/connection-run-gate.ts`) as run-agent.ts's own
      // D9.1 gate — one vocabulary, not a second one open-coded here. A
      // blocked response carries neither `ok` nor `runId`: nothing was
      // dispatched.
      const unready = unreadyConnectionsFor(ctx.forgeRoot, def);
      if (unready.length > 0) {
        sendJson(res, 409, { error: formatUnreadyConnections(def, unready) }, origin);
        return;
      }
      let project: string | undefined;
      if (body.project !== undefined) {
        if (typeof body.project !== 'string' || !SAFE_PROJECT_NAME_RE.test(body.project)) {
          sendJson(res, 400, { error: `invalid project: ${JSON.stringify(body.project)}` }, origin);
          return;
        }
        if (!guardedFile(ctx.projectsRoot, [body.project], 'readdir')) {
          sendJson(res, 404, { error: `project not found: ${body.project}` }, origin);
          return;
        }
        project = body.project;
      }
      // inputs: a flat string→string map, rendered as prompt DATA by
      // dispatchAgentRun. Validate KEYS too — an invalid key must 400, never be
      // silently dropped downstream in spawnAgentDispatch (this repo bans
      // swallowed failures: a dropped input the operator never learns about).
      const inputs: Record<string, string> = {};
      if (body.inputs !== undefined) {
        if (typeof body.inputs !== 'object' || body.inputs === null || Array.isArray(body.inputs)) {
          sendJson(res, 400, { error: 'inputs must be an object of string values' }, origin);
          return;
        }
        for (const [k, v] of Object.entries(body.inputs as Record<string, unknown>)) {
          if (!SAFE_INPUT_KEY_RE.test(k)) {
            sendJson(res, 400, { error: `invalid input key: ${JSON.stringify(k)} (expected ${SAFE_INPUT_KEY_RE})` }, origin);
            return;
          }
          if (typeof v !== 'string') {
            sendJson(res, 400, { error: `input "${k}" must be a string` }, origin);
            return;
          }
          inputs[k] = v;
        }
      }
      // R6-04 WI-2 — the per-kickoff cost ceiling. Fail-closed, THREE ordered
      // stages (round 8, T1 ruling on validation precedence):
      //   1. shape/type — non-number or non-finite. Must win over everything
      //      else: we should never reason about whether a malformed value is
      //      "enforceable" or "in bounds".
      //   2. enforceability — a property of the AGENT, invariant under the
      //      value (only `runtime.loopStrategy: 'one-shot'` agents can honor
      //      a ceiling via options.maxBudgetUsd, orchestrator/run-agent.ts's
      //      runOneShotSpawn; the legacy invocation path, 14 of 19 real
      //      dispatchable roster agents, has no budget concept at all). This
      //      wins over bounds: a bounds message ("must be <= N") implies "use
      //      a smaller number" as a remedy, but for a legacy-path agent NO
      //      value is acceptable — a message naming an unusable remedy is
      //      actively misleading. Mirrors the SAME guard `runAgent` itself
      //      enforces (defense-in-depth: this route is not the only entry
      //      point — `forge agent dispatch --cost-ceiling-usd` never passes
      //      through it).
      //   3. bounds — a property of the VALUE: <= 0 or above
      //      MAX_KICKOFF_COST_CEILING_USD. Exactly-at-the-max is accepted
      //      (inclusive boundary); one unit over is refused.
      // All three 400 BEFORE runId is minted / spawnAgentDispatch is ever
      // called — no run is spawned on a refused ceiling.
      let costCeilingUsd: number | undefined;
      if (body.costCeilingUsd !== undefined) {
        const v = body.costCeilingUsd;
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          sendJson(
            res,
            400,
            { error: `invalid costCeilingUsd: ${JSON.stringify(v)} (must be a finite number > 0 and <= ${MAX_KICKOFF_COST_CEILING_USD})` },
            origin,
          );
          return;
        }
        // W7-B5 (agents-21): the legacy invocation path (absent loopStrategy)
        // now ENFORCES a ceiling (adapter maxBudgetUsdPerIteration — see
        // orchestrator/run-agent.ts runInvocationSpawn), so only an UNKNOWN
        // declared strategy is refused here ('ralph' was already refused
        // above, before the ceiling was ever considered).
        if (def.runtime.loopStrategy !== undefined && def.runtime.loopStrategy !== 'one-shot') {
          sendJson(
            res,
            400,
            {
              error:
                `costCeilingUsd: ceiling not enforceable for this agent's loop strategy ` +
                `(agent "${slug}" declares ${JSON.stringify(def.runtime.loopStrategy)} — an operator ` +
                `cost ceiling is enforced for loopStrategy 'one-shot' and for the legacy invocation path)`,
            },
            origin,
          );
          return;
        }
        if (v <= 0 || v > MAX_KICKOFF_COST_CEILING_USD) {
          sendJson(
            res,
            400,
            { error: `invalid costCeilingUsd: ${JSON.stringify(v)} (must be a finite number > 0 and <= ${MAX_KICKOFF_COST_CEILING_USD})` },
            origin,
          );
          return;
        }
        costCeilingUsd = v;
      }
      // R6-04-F2 WI-1 — materials contract enforcement, the agent-kickoff
      // upload seam. ALL validation happens here, alongside `inputs` above,
      // BEFORE `runId` is minted below: a refused request never reaches the
      // point where a run directory could exist at all, which is what makes
      // "nothing written on refusal" true BY CONSTRUCTION rather than by a
      // compensating delete. `def` (the agent's declared `materials:`) is
      // already resolved above; the kind for every entry is derived
      // SERVER-SIDE (`materialKindForFilename`) — a client-supplied `kind`
      // field, if present, is never read.
      const materialsValidation = validateMaterialsField(body.materials, def);
      if (!materialsValidation.ok) {
        sendJson(res, 400, { error: materialsValidation.error }, origin);
        return;
      }
      const runId = `_agent-${slug}-${newRunStamp()}`;
      // Guard symmetry, hoisted (W7-B5): the t0 marker below is now the FIRST
      // thing that writes under `runId` (`createLogger` does
      // `resolve(logsRoot, runId)` + `mkdirSync`), so the server-minted-id
      // safety check this file applies to this SAME value at its other sites
      // (spawnAgentDispatch, the run-status route, the staging mkdir below)
      // has to run BEFORE it — otherwise the very first write is the one that
      // skips the check. A server-minted id failing its own safety check is a
      // server anomaly, not a client mistake, so it raises to the route's
      // existing 500 path, never a 400.
      if (!isSafeRunId(runId)) {
        throw new Error('refused to dispatch — unsafe server-minted run id');
      }
      // W7-B5 (agents-20 / agents-31 / sessions-kinds-24 sibling): the run's
      // FIRST event lands the moment the id is minted — so `GET
      // /api/events/<runId>` is 200 at t0 (no console 404 on the drawer's
      // first fetch), the history route can attribute the run to its slug
      // even if the child dies before runAgent's own `start` event, and the
      // ceiling in force is durable from the moment it was accepted (a
      // failed/still-running run can still surface it). `skill: slug` is the
      // D4 identity field. Emitted BEFORE materials staging so the log reads
      // in real order: dispatched → materials-staged → (child lifecycle).
      createLogger(runId, ctx.logsRoot).emit({
        initiative_id: runId,
        phase: 'orchestrator',
        skill: slug,
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'agent-run.dispatched',
        metadata: {
          agent_slug: slug,
          ...(project !== undefined ? { project } : {}),
          ...(costCeilingUsd !== undefined ? { kickoff_ceiling_usd: costCeilingUsd } : {}),
        },
      });
      // Staging happens AFTER runId is minted (it needs a run dir to write
      // into) and BEFORE spawnAgentDispatch (so the spawned agent process
      // can see the files). A `MaterialsStagingError` here is a SERVER-side
      // anomaly, not a client-attributable refusal — every client-fixable
      // problem already 400'd above, and the client cannot plant a
      // symlink/hardlink under a runId it never knew in advance — so it
      // falls through to the route's normal catch below, which maps it to a
      // 500 via the existing `sanitizeError`, not a hand-rolled sanitiser.
      if (materialsValidation.entries.length > 0) {
        const runDir = join(ctx.logsRoot, runId);
        // `runId` is server-minted (just above) and `ctx.logsRoot` is
        // config-derived — both trusted, neither built from untrusted
        // input — so realizing the run's own directory here is safe.
        // `isSafeRunId(runId)` is already enforced immediately after the id
        // is minted (see the hoisted guard above) — it used to live here,
        // but W7-B5's t0 marker now writes under `runId` before this block
        // runs, so the check had to move ahead of the FIRST write rather
        // than sit in front of the second one. Same guard-symmetry intent
        // (spawnAgentDispatch, the run-status route, this mkdir), one site
        // earlier.
        // This is the run's FIRST staged artifact: under FORGE_DRY_BRIDGE,
        // spawnAgentDispatch below never runs, so nothing else creates
        // `runDir` before `stageMaterials`/`resolveGuardedPath` need it to
        // already exist.
        mkdirSync(runDir, { recursive: true });
        stageMaterials(
          runDir,
          materialsValidation.entries.map((m) => ({ filename: m.filename, bytes: m.bytes })),
        );
        // Record REFERENCES ONLY (relative path + derived kind) on the run's
        // own event log — never the bytes (forge-wide rule: the event log
        // logs refs, never contents).
        createLogger(runId, ctx.logsRoot).emit({
          initiative_id: runId,
          phase: 'orchestrator',
          skill: slug,
          // NOT 'start' — `runAgent` (orchestrator/run-agent.ts:297) already
          // emits the run's real lifecycle `start` event when the spawned
          // process runs; a second `start` here would double up the
          // lifecycle terminal for the same runId (wrong "when did this run
          // begin" answers, an inflated events count on the status route).
          // This is a supplementary record, not a lifecycle boundary — 'log'
          // is the established shape for that (mirrors
          // 'run-agent.spawn-suppressed', also a non-lifecycle `log` event).
          event_type: 'log',
          input_refs: materialsValidation.entries.map((m) => `materials/${m.filename}`),
          output_refs: [],
          message: 'agent-run.materials-staged',
          metadata: {
            materials: materialsValidation.entries.map((m) => ({ path: `materials/${m.filename}`, kind: m.kind })),
          },
        });
      }
      // Bead forge-c6h — thread the bridge's own snapshot projects root
      // through as --projects-root so a dispatch carrying a --session-dir
      // (none on this generic route today — sessionDir is `undefined` here;
      // the flag is inert without it) never has to re-derive it downstream.
      spawnAgentDispatch(ctx.forgeRoot, slug, runId, project, inputs, undefined, costCeilingUsd, ctx.projectsRoot);
      // agents-20: start streaming this run's log to connected WS clients
      // now that events.jsonl exists (ensureTailFor no-ops on a missing
      // file, which is why the t0 event above must land first). The status
      // route re-arms after any WS reconnect.
      ctx.ensureAgentRunTail(runId);
      sendJson(
        res,
        200,
        { ok: true, runId, slug, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/agents/:slug/run', runId) },
        origin,
      );
    } catch (err) {
      // A MaterialsStagingError (thrown by stageMaterials) lands here too —
      // deliberately: it maps to the SAME 500 + sanitizeError() as every
      // other unexpected failure on this route, not a hand-rolled second
      // sanitiser. See the staging call above for why a staging throw is a
      // server-state anomaly rather than a client-attributable 400. Worth a
      // distinct server-side log line, though, since this specific path
      // means containment refused a write under a runId only the server
      // ever knew — an environment fault, never a client mistake.
      if (err instanceof MaterialsStagingError) {
        console.error(`POST /api/agents/:slug/run: materials staging failed: ${err.message}`);
      }
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }

  // Plan (R4-05 / F4) — the roadmap's per-initiative "Plan" trigger. Repoints
  // ONE WI-less initiative's manifest at the forge-architect flow (decompose
  // only) and makes it claimable — the same manifest-move queue-state
  // transition as "start development" above, just single-id: unlike the batch
  // develop/start route, there is exactly one outcome per request here, so it
  // maps directly onto real HTTP statuses instead of a per-id results array.
  // No in-request spawn — the scheduler claims it later and runs
  // execPm -> runProjectManager.
  if (method === 'POST' && url.startsWith('/api/initiatives/') && url.endsWith('/plan')) {
    const initiativeId = decodeURIComponent(url.slice('/api/initiatives/'.length, url.length - '/plan'.length));
    if (!initiativeId) {
      sendJson(res, 400, { error: 'initiativeId required' }, origin);
      return;
    }
    // W8-A3 (`flows-37`, review round 1 S2-2): the third door onto a repoint.
    // Same compare-and-swap forward as `POST /api/flows/:id/run`; the rule
    // itself lives on `enqueuePlanRun`.
    let planBody: unknown;
    try {
      planBody = await readJson(req);
    } catch {
      planBody = {};
    }
    const planConfirmRepointFrom = typeof (planBody as Record<string, unknown>)?.['confirmRepointFrom'] === 'string'
      ? ((planBody as Record<string, unknown>)['confirmRepointFrom'] as string)
      : undefined;
    try {
      const result = enqueuePlanRun(initiativeId, { queueRoot: ctx.queueRoot, confirmRepointFrom: planConfirmRepointFrom });
      const httpStatus =
        result.status === 'enqueued' ? 200 :
        result.status === 'not-found' ? 404 :
        result.status === 'already-running' || result.status === 'repoint-requires-confirm' ? 409 :
        500;
      sendJson(res, httpStatus, { ...result, ok: result.status === 'enqueued' }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }

  // W7-A3 (flows-02/03) — per-flow run trigger: enqueue an EXISTING
  // initiative onto THIS flow (`enqueueFlowRun`, the ADR-041 generic per-flow
  // claimable enqueue). The flow monitor's generic "Start Run" used to POST the
  // flow id as an initiativeId to /api/runs (always 400, silently). Same
  // status→HTTP mapping as the plan route above; the scheduler claims it later.
  if (method === 'POST' && url.startsWith('/api/flows/') && url.endsWith('/run')) {
    const flowId = decodeURIComponent(url.slice('/api/flows/'.length, url.length - '/run'.length));
    if (!/^[a-z0-9][a-z0-9-]*$/.test(flowId)) {
      sendJson(res, 400, { error: 'invalid flow id' }, origin);
      return;
    }
    // Existence through the guard family (never a raw fs probe on a
    // request-derived segment): the flow id is a single slug segment under the
    // trusted forgeRoot/studio/flows.
    if (guardedFile(ctx.forgeRoot, ['studio', 'flows', flowId, 'flow.yaml'], 'read') === null) {
      sendJson(res, 404, { error: 'flow not found', flowId }, origin);
      return;
    }
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' }, origin);
      return;
    }
    const initiativeId = typeof (body as Record<string, unknown>)?.['initiativeId'] === 'string'
      ? ((body as Record<string, unknown>)['initiativeId'] as string)
      : '';
    if (!initiativeId) {
      sendJson(res, 400, { error: 'initiativeId required' }, origin);
      return;
    }
    // W8-A3 (`flows-37`): the operator's confirmation, forwarded verbatim as the
    // FLOW they were shown — a compare-and-swap, not a boolean override (review
    // round 3, S2-3). A non-string is carried as `undefined`, i.e. no
    // confirmation at all, so an accidental client serialization fails closed.
    // The RULE is the enqueue's; this line only carries the operator's answer.
    const confirmRepointFrom = typeof (body as Record<string, unknown>)?.['confirmRepointFrom'] === 'string'
      ? ((body as Record<string, unknown>)['confirmRepointFrom'] as string)
      : undefined;
    try {
      // W7-FIX-A3 (A3-01, round-2 finding 6): the OPERATOR route refuses a
      // shipped initiative — and the rule now lives ON `enqueueFlowRun`
      // (`allowFinishedSource`, default off) rather than as a pre-check bolted
      // onto this one route, so the sibling operator route
      // (`POST /api/develop/start`) is closed by the same guard instead of
      // still yanking a merged manifest out of `done/`. The route only maps
      // the status onto its HTTP code; the id rule + the fs probe are the
      // enqueue's own (one INIT predicate, no third copy of the regex here).
      const result = enqueueFlowRun(initiativeId, flowId, { queueRoot: ctx.queueRoot, confirmRepointFrom });
      const httpStatus =
        result.status === 'enqueued' ? 200 :
        result.status === 'not-found' ? 404 :
        result.status === 'already-running' || result.status === 'already-done' ||
          result.status === 'not-planned' || result.status === 'repoint-requires-confirm' ? 409 :
        500;
      sendJson(res, httpStatus, { ...result, ok: result.status === 'enqueued' }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }

  // Review-comment sidecar (S7 / DEC-5) — the visual review page's anchored
  // comments. GET reads them + the derived verdict; POST appends one; POST
  // .../resolve marks one resolved. Writes are proper-lockfile guarded (the
  // read-modify-write is atomic per cycle). Verdict derivation is over the set:
  // any blocking, unresolved comment ⇒ send-back; else ⇒ approve.
  if (method === 'GET' && url.startsWith('/api/review-comments/')) {
    const cycleId = decodeURIComponent(url.slice('/api/review-comments/'.length));
    if (!cycleId || !isSafeCycleId(cycleId)) { sendJson(res, 400, { error: 'expected /api/review-comments/<cycleId>' }, origin); return; }
    const sidecar = readReviewComments(ctx.logsRoot, cycleId);
    sendJson(res, 200, { ...sidecar, derivedVerdict: deriveVerdictFromComments(sidecar.comments) }, origin);
    return;
  }
  // W7-B7 (artifact-plan-15): edit + delete for authored comments. A
  // non-blocking comment has no resolve affordance, so delete is the only way
  // to clear it; edit fixes a typo'd concern without losing its anchor id.
  // Same lock + derive-on-every-mutate shape as append/resolve.
  if (method === 'POST' && url.startsWith('/api/review-comments/') && url.endsWith('/edit')) {
    const cycleId = decodeURIComponent(url.slice('/api/review-comments/'.length, url.length - '/edit'.length));
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const commentId = typeof body['commentId'] === 'string' ? body['commentId'] : '';
      if (!cycleId || !isSafeCycleId(cycleId) || !commentId) { sendJson(res, 400, { error: 'cycleId and commentId required' }, origin); return; }
      const patchBody = typeof body['body'] === 'string' ? body['body'].trim() : undefined;
      const patchBlocking = typeof body['blocking'] === 'boolean' ? body['blocking'] : undefined;
      if (patchBody === '') { sendJson(res, 400, { error: 'body must be non-empty when provided' }, origin); return; }
      if (patchBody === undefined && patchBlocking === undefined) { sendJson(res, 400, { error: 'nothing to edit — provide body and/or blocking' }, origin); return; }
      const result = await withReviewCommentLock(ctx.logsRoot, cycleId, (sidecar) =>
        editComment(sidecar, commentId, { body: patchBody, blocking: patchBlocking }),
      );
      sendJson(res, 200, { ...result, derivedVerdict: deriveVerdictFromComments(result.comments) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }
  if (method === 'POST' && url.startsWith('/api/review-comments/') && url.endsWith('/delete')) {
    const cycleId = decodeURIComponent(url.slice('/api/review-comments/'.length, url.length - '/delete'.length));
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const commentId = typeof body['commentId'] === 'string' ? body['commentId'] : '';
      if (!cycleId || !isSafeCycleId(cycleId) || !commentId) { sendJson(res, 400, { error: 'cycleId and commentId required' }, origin); return; }
      const result = await withReviewCommentLock(ctx.logsRoot, cycleId, (sidecar) => deleteComment(sidecar, commentId));
      sendJson(res, 200, { ...result, derivedVerdict: deriveVerdictFromComments(result.comments) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }
  if (method === 'POST' && url.startsWith('/api/review-comments/') && url.endsWith('/resolve')) {
    const cycleId = decodeURIComponent(url.slice('/api/review-comments/'.length, url.length - '/resolve'.length));
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const commentId = typeof body['commentId'] === 'string' ? body['commentId'] : '';
      if (!cycleId || !isSafeCycleId(cycleId) || !commentId) { sendJson(res, 400, { error: 'cycleId and commentId required' }, origin); return; }
      const result = await withReviewCommentLock(ctx.logsRoot, cycleId, (sidecar) => resolveComment(sidecar, commentId));
      sendJson(res, 200, { ...result, derivedVerdict: deriveVerdictFromComments(result.comments) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }
  if (method === 'POST' && url.startsWith('/api/review-comments/')) {
    const cycleId = decodeURIComponent(url.slice('/api/review-comments/'.length));
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const region = typeof body['region'] === 'string' ? body['region'].trim() : '';
      const text = typeof body['body'] === 'string' ? body['body'].trim() : '';
      if (!cycleId || !isSafeCycleId(cycleId) || !region || !text) { sendJson(res, 400, { error: 'cycleId, region, body required' }, origin); return; }
      if (readReviewComments(ctx.logsRoot, cycleId).comments.length >= REVIEW_COMMENTS_MAX) {
        sendJson(res, 409, { error: `review-comment cap reached (${REVIEW_COMMENTS_MAX}) for this cycle` }, origin);
        return;
      }
      const ac = isAcShape(body['ac']) ? (body['ac'] as { given: string; when: string; then: string }) : undefined;
      const result = await withReviewCommentLock(ctx.logsRoot, cycleId, (sidecar) =>
        appendReviewComment(sidecar, { region, body: text, blocking: Boolean(body['blocking']), ac }),
      );
      sendJson(res, 200, {
        ...result,
        comment: result.comments[result.comments.length - 1],
        derivedVerdict: deriveVerdictFromComments(result.comments),
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }

  // Review verdict — the M2-C intervention surface. Delegates to applyReviewVerdict.
  if (method === 'POST' && url === '/api/verdict') {
    try {
      const body = await readJson(req);
      const b = body as Record<string, unknown>;
      await applyReviewVerdict(req, res, studioPostCtx, {
        initiativeId: typeof b['initiativeId'] === 'string' ? b['initiativeId'] : '',
        kind: (b['kind'] as 'approve' | 'send-back') ?? 'send-back',
        rationale: typeof b['rationale'] === 'string' ? b['rationale'] : '',
        acceptanceCriteria: Array.isArray(b['acceptanceCriteria'])
          ? (b['acceptanceCriteria'] as Array<{ given: string; when: string; then: string }>)
          : undefined,
        concernKind: b['concernKind'] as 'packaging' | 'code-fix' | undefined,
        qualityGateCmd: Array.isArray(b['qualityGateCmd']) ? (b['qualityGateCmd'] as string[]) : undefined,
      });
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return;
  }

  res.writeHead(404);
  res.end();
}

// ---- Architect routes (ADR 020) -------------------------------------------

/** The 5 detached-runner turn families the bridge spawns — each `argvPrefix`
 *  is prepended to `<sid> --project <project>` to build the full argv passed
 *  to `orchestrator/cli.ts`, and `logPrefix` names the `_logs/_<logPrefix>-
 *  <sid>/` capture dir. `demo-builder` is the one legacy case where verb and
 *  log prefix diverge (verb `demo-builder`, log prefix `demo`) — preserved
 *  exactly from the pre-collapse per-agent functions.
 *
 *  R4-21 phase 2, WI-2 (D5's sibling concern): `authoring` is the first row
 *  that does NOT go through a bespoke `<verb> run <sid> --project <p>` CLI
 *  command — it rides the GENERIC `forge agent run <agent-id> <sid> --project
 *  <p>` dispatch fork (ADR-043 §3, `cli/agent-run.ts`'s `cmdAgentRun`), so its
 *  argvPrefix is `['agent', 'run', 'authoring']` rather than `['<verb>',
 *  'run']`. The 4 legacy rows carry an EXPLICIT argv prefix instead of the
 *  former `{verb}` + implicit `'run'` shape specifically so this one row can
 *  differ in SHAPE (3 tokens, not 2) while the legacy rows stay
 *  byte-equivalent to their pre-existing argv — `['architect','run']`,
 *  `['instructions','run']`, `['demo-builder','run']`,
 *  `['project-brain','run']` are the SAME tokens the old `{verb}+'run'`
 *  construction produced, just spelled as a literal array.
 *
 *  W6-B2 review fix (MEDIUM 1) — exported (with SPAWN_AGENT_SPECS below) so
 *  cli/session-tail-kind-parity.test.ts can import the real table directly
 *  and assert, for every studio/session-kinds.yaml descriptor with a
 *  corresponding entry here, that `logPrefix === descriptor.id` — the
 *  coincidence ensureSessionTail's `_${kind}-${sessionId}` derivation
 *  (this file, near ensureTailFor) relies on. Without this ratchet, a
 *  future rename of either side drifts silently: ensureSessionTail just
 *  no-ops (ensureTailFor's existsSync guard swallows the miss), so a
 *  session's WS tail would quietly stop activating with no error anywhere. */
export type SpawnableAgentId = 'architect' | 'instructions' | 'demo-builder' | 'project-brain' | 'authoring' | 'kb-cleanup';

export const SPAWN_AGENT_SPECS: Record<SpawnableAgentId, { argvPrefix: readonly string[]; logPrefix: string }> = {
  architect: { argvPrefix: ['architect', 'run'], logPrefix: 'architect' },
  instructions: { argvPrefix: ['instructions', 'run'], logPrefix: 'instructions' },
  'demo-builder': { argvPrefix: ['demo-builder', 'run'], logPrefix: 'demo' },
  'project-brain': { argvPrefix: ['project-brain', 'run'], logPrefix: 'project-brain' },
  authoring: { argvPrefix: ['agent', 'run', 'authoring'], logPrefix: 'authoring' },
  // R4-19-F2 — the kb-cleanup session, riding the SAME generic
  // runInteractiveTurn spine as authoring (ADR-043 §3): `forge agent run
  // kb-cleanup <sid> --project <p>`.
  'kb-cleanup': { argvPrefix: ['agent', 'run', 'kb-cleanup'], logPrefix: 'kb-cleanup' },
};

/** Spawn one `<agentId>`-runner turn as a detached child (the scheduler-daemon
 *  spawn pattern). Best-effort + fire-and-forget — the runner checkpoints to
 *  the session dir and the relevant `broadcast*Changed` signal drives the UI
 *  re-fetch. `FORGE_ARCHITECT_NO_SPAWN=1` disables the spawn for harness /
 *  curl runs that pre-seed session state (mirrors `FORGE_BRIDGE_DEBUG`).
 *
 *  The runner's stderr (uncaught exceptions, SDK errors) is captured to
 *  `_logs/_<logPrefix>-<sid>/stderr.log` so stalls are diagnosable via the
 *  existing GET /api/<family>/file/<project>/<sid>/stderr.log endpoints.
 *
 *  R2-01-F3b: collapses the 4 near-byte-identical `spawn<X>Turn` helpers
 *  (architect/instructions/demo-builder/project-brain) that differed only in
 *  the CLI verb and the log-dir prefix — same guard, same detached-spawn
 *  shape, same argv per agent as before the collapse.
 *
 *  R2-01 final-review fix (e): guard `sessionId` against path traversal
 *  before it's used to build the `_logs/_<logPrefix>-<sessionId>/` dir name
 *  below — defense-in-depth on a pre-existing, F3b-renamed function (route
 *  handlers already 404 an unknown sessionId before spawning, plus the
 *  bridge's same-origin + `x-forge-csrf` guard, so this isn't closing an
 *  exploitable hole today). Reuses `isSafeRunId` — `orchestrator/run-agent.ts`'s
 *  `SAFE_RUN_ID_RE` + `..` check — as the SSOT rather than re-deriving it. */
// Exported (W6-B4) so cli/bridge-studio-affordances.ts's generic session-
// affordance write endpoint can DELEGATE to this SAME spawn helper instead of
// reimplementing it, injected via its AffordanceRouteContext (mirrors
// SessionsRouteContext's ensureSessionTail injection, cli/bridge-studio-
// sessions.ts) — bridge-studio-*.ts modules never import FROM ui-bridge.ts
// (see that file's own header for the reasoning), so this stays exported and
// passed by reference at the wiring call site, never imported directly.
export function spawnAgentTurn(forgeRoot: string, agentId: SpawnableAgentId, project: string, sessionId: string): SpawnTurnOutcome {
  // W7-C2 T1 review (A7) — this helper no longer swallows. Its outcome is
  // REPORTED to the caller (`SpawnTurnOutcome`, cli/bridge-studio-
  // affordances.ts) so a route can refuse to claim `{ok:true, phase:
  // 'analyzing'}` for a turn that never started; a session left in a working
  // phase with no log dir can never be derived as `stalled`
  // (cli/bridge-studio-lifecycle.ts), so a swallowed failure showed the
  // operator `working` forever with `needsYou:false`. A DELIBERATE no-spawn
  // (FORGE_ARCHITECT_NO_SPAWN / the dry bridge) is `ok` with
  // `spawned:false` — not a failure. Callers that genuinely have nothing to
  // do with the outcome ignore the return value exactly as before.
  if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge()) return { ok: true, spawned: false };
  if (!isSafeRunId(sessionId)) {
    console.error(`spawnAgentTurn: unsafe sessionId (path-traversal risk), refusing to spawn: ${JSON.stringify(sessionId)}`);
    return { ok: false, error: 'unsafe sessionId (path-traversal risk) — refusing to spawn' };
  }
  const { argvPrefix, logPrefix } = SPAWN_AGENT_SPECS[agentId];
  try {
    const logDir = join(forgeRoot, '_logs', `_${logPrefix}-${sessionId}`);
    mkdirSync(logDir, { recursive: true });
    const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
    const proc = spawn(
      process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', ...argvPrefix, sessionId, '--project', project],
      { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] },
    );
    closeSync(stderrFd);
    proc.unref();
    // W7-A2 — track the turn's pid so the generic cancel route
    // (cli/bridge-studio-session-cancel.ts → killTrackedTurn) can SIGTERM a
    // live turn, and the lifecycle derivation can tell "re-run in flight"
    // from "crashed" (isTurnAlive additionally proves ownership via the
    // sessionId in the process's own argv above). Same logDir, same guard
    // posture as stderr.log; best-effort like the rest of this helper.
    if (typeof proc.pid === 'number') {
      guardedWriteFile(join(forgeRoot, '_logs'), [`_${logPrefix}-${sessionId}`, 'turn.pid'], `${proc.pid}\n`);
    }
    return { ok: true, spawned: true };
  } catch (err) {
    // W7-C2 T1 review (A7) — surfaced, never swallowed: logged here for the
    // bridge operator AND returned so the route can answer honestly.
    console.error(`spawnAgentTurn: failed to start the ${agentId} turn for session ${sessionId}:`, err);
    return { ok: false, error: sanitizeError(err) };
  }
}

/** Studio agent slug shape (skill dir names): lowercase alnum + hyphen, no
 *  leading hyphen (so a flag-shaped slug can't reach a detached spawn even from
 *  a future caller that skips roster resolution). The TRUE injection guard is
 *  `resolveDispatchableAgent` rejecting non-roster slugs + argv-array/no-shell
 *  spawn semantics; this regex is defense-in-depth, not the sole barrier. */
const SAFE_AGENT_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
/** Project dir name: real projects carry uppercase / `_` (e.g. `trafficGame`,
 *  `terraform-provider-betterado`), so this is broader than a slug — but still
 *  no `.`/`/` (traversal) and no leading `-` (flag shape). W7-A4: this IS the
 *  one project-id rule (`PROJECT_ID_RE`, orchestrator/studio/validate.ts) —
 *  aliased here so the existing call site reads unchanged. */
const SAFE_PROJECT_NAME_RE = PROJECT_ID_RE;
/** Run-input keys are freer (camelCase like `northStar`) but still flag-safe. */
const SAFE_INPUT_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
/** R6-04-F2 WI-1 contract point 3 — a `materials:` upload's `filename` must
 *  be a single safe path-segment NAME: alnum-first (bans dotfiles like
 *  `.env` and the `..foo`/`.`/`..` shapes outright — no traversal token is
 *  needed for any of those to be refused), then alnum plus SPACE, `.`, `_`,
 *  `-`, `(`, `)`, `[`, `]` (no `/`, no `\`, no `%`, no NUL/control chars,
 *  never decoded — this field is a JSON string VALUE, never a URL segment),
 *  max 128 chars total.
 *
 *  ROUND 3 WIDENING (adversarial review): the original class
 *  (`[A-Za-z0-9._-]` only) rejected the filenames operators' own machines
 *  produce by DEFAULT — `Screen Shot 2026-08-07 at 10.32.15 AM.png` (macOS
 *  screenshot), `data (1).csv` (browser duplicate-download suffix),
 *  `Meeting Notes.pdf` — on this feature's headline use case (attaching a
 *  screenshot). Space/`(`/`)`/`[`/`]` were added to the TAIL class only; the
 *  leading-character rule, the length cap, and every excluded character
 *  (`/`, `\`, `%`, NUL, control chars) are UNCHANGED from round 1/2.
 *
 *  ATTACK-THE-FIX (personally attempted before accepting this widening, not
 *  just watched pass): a literal `..` substring embedded via the newly
 *  allowed brackets/parens (e.g. `photo [..] (backup)..png`) is safe and
 *  correctly ACCEPTED — there is no `/` anywhere, so it is one opaque
 *  segment name, never a path boundary, exactly `studio-path-guard.ts`'s own
 *  established `..foo`-is-legitimate precedent; `/`, `\`, `%`, NUL, and
 *  control characters are all still excluded by the class itself (adding
 *  space/parens/brackets to the tail did not touch the exclusion list); a
 *  name that is only dots/spaces (no alnum at all) is still refused by the
 *  alnum-first rule, unchanged.
 *
 *  Deliberately STILL ASCII-only — non-ASCII (e.g. `résumé.pdf`) is REFUSED,
 *  not an oversight of the widening: filesystem unicode normalization
 *  differs by platform (macOS tends toward NFD, Linux does not), so one
 *  logical name can be two different on-disk byte sequences, and
 *  `resolveGuardedPath`'s realpath-identity comparison would behave
 *  differently per platform for the SAME input — fail-closed-and-consistent
 *  beats convenient-and-platform-dependent.
 *
 *  Deliberately STRICTER than, and NOT reused from, `studio-path-guard.ts`'s
 *  `isSafeSegment` (which allows `..foo` but not space/parens/brackets at
 *  all) — this is a narrower, purpose-built contract for an untrusted
 *  upload name, not a relaxation of the shared guard's rule. */
const MATERIAL_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ()._[\]-]{0,127}$/;

/** Comma-separated, declaration-order rendering of an agent's declared
 *  materials kinds for a refusal message — the literal `(none)` when the
 *  agent declares nothing at all (R6-04-F2 WI-1, exact wording pinned by
 *  `cli/ui-bridge-agent-run-materials.test.ts`). */
function declaredMaterialKindsClause(declared: readonly string[]): string {
  return declared.length > 0 ? declared.join(', ') : '(none)';
}

/** Exact refusal text for a filename whose extension derives NO material
 *  kind at all (`materialKindForFilename` returned `undefined`). Wording is
 *  pinned character-for-character by the acceptance tests — do not reword. */
function materialsNoKindMessage(filename: string, slug: string, declared: readonly string[]): string {
  return `materials: "${filename}" maps to no material kind; agent "${slug}" declares: ${declaredMaterialKindsClause(declared)}`;
}

/** Exact refusal text for a filename that DOES derive a kind, but one the
 *  agent has not declared (`agentAcceptsMaterial` returned `false`). Wording
 *  is pinned character-for-character by the acceptance tests — do not
 *  reword. */
function materialsUndeclaredKindMessage(filename: string, kind: string, slug: string, declared: readonly string[]): string {
  return `materials: "${filename}" is ${kind}; agent "${slug}" declares: ${declaredMaterialKindsClause(declared)}`;
}

/** Decode `raw` as base64 and require it to ROUND-TRIP back to the exact
 *  same string. Node's base64 decoder is lenient — it silently drops stray
 *  invalid characters instead of throwing — so "does `Buffer.from` throw"
 *  is not a valid validity check on its own; only a successful round-trip
 *  proves `raw` was genuinely, exactly base64. Returns `undefined` (never
 *  throws) on any mismatch. */
function decodeStrictBase64(raw: string): Buffer | undefined {
  const buf = Buffer.from(raw, 'base64');
  return buf.toString('base64') === raw ? buf : undefined;
}

type ValidatedMaterial = { filename: string; bytes: Buffer; kind: string };
type MaterialsValidation = { ok: true; entries: ValidatedMaterial[] } | { ok: false; error: string };

/**
 * Validate one `POST /api/agents/:slug/run` request body's `materials`
 * field end to end (R6-04-F2 WI-1, contract points 2-8): shape, filename
 * charset, duplicate-within-request, strict base64, the three caps, and —
 * the headline behaviour — the kind gate itself. The kind for every entry
 * is derived SERVER-SIDE via `materialKindForFilename`; nothing here ever
 * reads a client-supplied `kind` field, so one can never influence the
 * outcome in either direction (acceptance test: a lying `kind` can neither
 * bypass the gate nor cause a false refusal).
 *
 * Pure and synchronous — no filesystem I/O, no partial state. Returns
 * either the fully-validated, decoded entries ready for `stageMaterials`,
 * or a single `error` string ready to send as a 400. `materials` absent (or
 * `[]`) returns `{ ok: true, entries: [] }` — contract point 1,
 * byte-identical to today's behaviour.
 */
function validateMaterialsField(rawMaterials: unknown, def: AgentDefinition): MaterialsValidation {
  if (rawMaterials === undefined) return { ok: true, entries: [] };
  if (!Array.isArray(rawMaterials)) {
    return { ok: false, error: 'materials: must be an array' };
  }
  if (rawMaterials.length > MAX_MATERIALS_COUNT) {
    return { ok: false, error: `materials: at most ${MAX_MATERIALS_COUNT} materials per request (got ${rawMaterials.length})` };
  }

  const declared = def.materials ?? [];
  const seenFilenames = new Set<string>();
  const entries: ValidatedMaterial[] = [];
  let totalBytes = 0;

  for (const raw of rawMaterials) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'materials: each entry must be an object with filename and contentBase64' };
    }
    const entry = raw as Record<string, unknown>;

    if (typeof entry.filename !== 'string') {
      return { ok: false, error: 'materials: filename must be a string' };
    }
    const filename = entry.filename;
    if (!MATERIAL_FILENAME_RE.test(filename)) {
      return { ok: false, error: `materials: invalid filename ${JSON.stringify(filename)}` };
    }
    if (typeof entry.contentBase64 !== 'string') {
      return { ok: false, error: `materials: "${filename}" contentBase64 must be a string` };
    }
    if (seenFilenames.has(filename)) {
      return { ok: false, error: `materials: duplicate filename "${filename}" in one request` };
    }
    seenFilenames.add(filename);

    const bytes = decodeStrictBase64(entry.contentBase64);
    if (!bytes) {
      return { ok: false, error: `materials: "${filename}" contentBase64 is not valid base64` };
    }
    if (bytes.length > MAX_MATERIAL_BYTES) {
      return { ok: false, error: `materials: "${filename}" exceeds the per-file size cap (${MAX_MATERIAL_BYTES} bytes)` };
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_MATERIALS_TOTAL_BYTES) {
      return { ok: false, error: `materials: total size exceeds the request cap (${MAX_MATERIALS_TOTAL_BYTES} bytes)` };
    }

    const kind = materialKindForFilename(filename);
    if (!kind) {
      return { ok: false, error: materialsNoKindMessage(filename, def.slug, declared) };
    }
    if (!agentAcceptsMaterial(def, kind)) {
      return { ok: false, error: materialsUndeclaredKindMessage(filename, kind, def.slug, declared) };
    }

    entries.push({ filename, bytes, kind });
  }

  return { ok: true, entries };
}

/** R4-16 — GET /api/demo-builder/generation/<project>/<sid>/<n>/<filename>
 *  path segments. `n` is a bounded digit string (mirrors a generation number,
 *  never negative/decimal). `filename` structurally forbids `..`, `/`, and an
 *  absolute path — a malicious segment can never even reach the realpath
 *  choke point (`safeReadFileInSession`), which is this route's actual
 *  containment guard (D11). The negative lookahead rejects a filename that is
 *  EXACTLY "." or ".." — without it, correctness for those two values would
 *  depend on `n` happening to be a digit string (so the joined
 *  `generations/<n>/.` or `generations/<n>/..` merely resolves to a
 *  directory and 404s for an unrelated reason) rather than the filename
 *  actually being rejected as a structural violation (pin 2, Finding E). */
const GENERATION_NUMBER_RE = /^[0-9]{1,6}$/;
const GENERATION_FILENAME_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/** R4-16 pin 2 (Finding A, BLOCKER) — `project`/`sessionId` on the
 *  generation-serve route below are validated with the EXACT PROJECT_ID_RE/
 *  SAFE_ID_RE + length-cap contract `cli/bridge-studio-sessions.ts` already
 *  applies to its own session routes (imported, not re-declared): length cap
 *  THEN charset, BEFORE any fs call. Without this, `demoSessionDir(join(
 *  projectsRoot, project), sessionId)` — a plain `path.join`, no containment
 *  of its own — walks an attacker-chosen `project`/`sessionId` (e.g. ".." /
 *  "../OUTSIDE") straight out of `projectsRoot` before `safeReadFileInSession`
 *  ever runs; that choke point only proves containment relative to whatever
 *  `sessionDir` it is handed, so an escaping caller-supplied dir defeats it
 *  entirely (reproduced live: AT-36). */
const MAX_GENERATION_PROJECT_LENGTH = MAX_EXACT_ID_LENGTH;
const MAX_GENERATION_SESSION_ID_LENGTH = MAX_SKILL_ID_LENGTH;

/** R4-21 (T3) — the authoring session's initial free-text description
 *  (`POST /api/studio/authoring/start`'s `prompt`, written verbatim to
 *  `prompt.md`). A generous bound on an operator-typed field, no different
 *  in spirit from every other length-capped text input in this file — just
 *  named for its own route rather than reusing an unrelated cap. */
const MAX_AUTHORING_PROMPT_LENGTH = 4000;

function invalidGenerationProjectReason(id: string): string | null {
  if (id.length > MAX_GENERATION_PROJECT_LENGTH) {
    return `invalid project "${id.slice(0, 40)}…" — ${id.length} characters exceeds the ${MAX_GENERATION_PROJECT_LENGTH}-character length limit`;
  }
  // W7-A4: the ONE project-id rule (case-preserving directory name, exact).
  if (!PROJECT_ID_RE.test(id)) {
    return `invalid project "${id}" — must match ${PROJECT_ID_RE} (the project's directory name: one path segment; no "/", "\\", ".", "..", or a leading "-")`;
  }
  return null;
}

function invalidGenerationSessionIdReason(id: string): string | null {
  if (id.length > MAX_GENERATION_SESSION_ID_LENGTH) {
    return `invalid sessionId "${id.slice(0, 40)}…" — ${id.length} characters exceeds the ${MAX_GENERATION_SESSION_ID_LENGTH}-character length limit`;
  }
  if (!SAFE_ID_RE.test(id)) {
    return `invalid sessionId "${id}" — must match ${SAFE_ID_RE} (alphanumeric, "_", "-"; no "/", ".", "..", whitespace, or null bytes)`;
  }
  return null;
}

/**
 * R4-16 round 2 (pin 3, Findings A + B, both BLOCKER) — the ONE choke point
 * every demo-builder route uses to turn a CALLER-SUPPLIED `project` +
 * `sessionId` into a session dir. This is the ONLY place a caller-supplied
 * `project`/`sessionId` is turned into a session dir via `demoSessionDir(
 * join(ctx.projectsRoot, project), sessionId)` in the demo-builder handler
 * (SEC-03 WI-6 correction: `listDemoSessions` also calls `demoSessionDir`
 * directly, but on names it obtained itself from `readdirSync` — server-
 * enumerated, never caller-supplied — so it is deliberately outside this
 * function's coverage, not an oversight; the original wording overstated
 * this as the ONLY caller of `demoSessionDir` full stop, which is what let
 * the `/demo/` and `/fragment/` GET routes below be written straight past
 * this choke point undetected) — round 1 validated `project`/`sessionId` on
 * the GET generation route alone, which closed that one ROUTE, not the class: the
 * five sibling routes (start/brief/feedback/lock/abandon) built the exact
 * same unguarded call themselves and reached `readSessionStatus`/
 * `writeSessionStatus` (no containment of their own) with only a
 * non-emptiness check on the inputs (AT-43/44, reproduced live).
 *
 * Two escapes closed in one pass:
 *   - Finding A: `project`/`sessionId` are validated (length cap THEN
 *     charset, BEFORE any fs call) with the exact PROJECT_ID_RE/SAFE_ID_RE
 *     contract `cli/bridge-studio-sessions.ts` applies to its own session
 *     routes — reused via `invalidGenerationProjectReason`/
 *     `invalidGenerationSessionIdReason` above (round 1 already imported the
 *     regexes for the GET route; not re-declared here). A `".."`-shaped
 *     value is rejected structurally and never reaches a `path.join`.
 *   - Finding B: a NAME that legitimately PASSES SAFE_ID_RE can still be a
 *     symlink on disk pointing outside this project — validating the STRING
 *     says nothing about what the PATH resolves to. This function proves
 *     containment the same way `resolveSafeSessionDir`
 *     (cli/bridge-studio-sessions.ts) does: `realpathSync` the resolved
 *     directory and require it to land inside THIS project's own resolved
 *     dir (`realpathSync(<projectsRoot>/<project>)`) — scoped to the
 *     specific project, never a `projectsRoot`-wide check, which would still
 *     admit a symlink pointing into ANOTHER project's session dir (exactly
 *     R2-10's own AT-47 escape shape).
 *
 * CREATE case (`POST /start`'s session dir does not exist yet):
 * `realpathSync` on a path that doesn't exist throws ENOENT, which must be
 * treated as neither an escape NOR a false pass. This walks up from the
 * candidate session dir to the closest EXISTING ancestor (same idea as
 * `closestExistingAncestorContained`, orchestrator/demo-builder-runner.ts —
 * a different module boundary, so not imported across it: that helper is
 * private to the runner's lock-step restore, this one is private to the
 * bridge's route dispatch, and each needs a different reference boundary —
 * a project repo root there, this project's OWN dir here) and proves THAT
 * ancestor is contained instead. Any remaining not-yet-existing tail
 * segments are plain literal directory names — `sessionId` already passed
 * SAFE_ID_RE, which forbids "/" — so they cannot themselves introduce an
 * escape between the check and the caller's later `mkdirSync`.
 */
type DemoSessionDirOutcome =
  | { readonly ok: true; readonly dir: string }
  | { readonly ok: false; readonly reason: string };

function resolveDemoSessionDir(projectsRoot: string, project: string, sessionId: string): DemoSessionDirOutcome {
  const projectReason = invalidGenerationProjectReason(project);
  if (projectReason) return { ok: false, reason: projectReason };
  const sessionIdReason = invalidGenerationSessionIdReason(sessionId);
  if (sessionIdReason) return { ok: false, reason: sessionIdReason };

  // SEC-04 (bd forge-ebj) — MIGRATED off the bespoke realpath baseline onto the
  // shared per-segment IDENTITY guard. `project` now arrives as its OWN element
  // of `segments[]`, NEVER folded into a realpath baseline: the previous check
  // realpath'd `join(projectsRoot, project)` FIRST and compared against THAT,
  // so when `project` itself was a SYMLINK the baseline WAS the escaped
  // location and the `startsWith` was tautological (root-folding — verbatim
  // from the adversarial-containment-review catalogue; the charset shape was
  // already guarded by the two reason-checks above, but the symlinked-first-
  // segment shape was not). `resolveGuardedPath` walks project → `_demo` →
  // sessionId, identity-checking each; the session dir may not exist yet (the
  // `/start` create case), which it handles by walking to the deepest existing
  // ancestor and reassembling the literal tail. A missing dir and an escaping
  // symlink both collapse to a single generic reason (no oracle).
  const guarded = resolveGuardedPath(projectsRoot, [project, '_demo', sessionId]);
  if (!guarded.ok) {
    return { ok: false, reason: `sessionId "${sessionId}" for project "${project}" resolves outside the project directory` };
  }
  return { ok: true, dir: guarded.realPath };
}

/** Timestamp stamp + short random suffix for a generated run id
 *  (YYYY-MM-DDTHH-mm-ss-SSS-xxxx): the ms precision plus 4 base36 chars so two
 *  dispatches of the same slug in the same millisecond (a programmatic driver,
 *  e.g. R4-02 fanout) don't collide onto one `_logs/<runId>/` dir. */
function newRunStamp(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  return `${ts}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Pure argv builder for `forge agent dispatch <slug> --run-id <runId> [...]`
 * (R6-04 WI-2 extraction, mirrors `parseAgentDispatchArgs`'s pure argv PARSER
 * on the other side of the CLI boundary, cli/agent-run.ts). Extracted from
 * `spawnAgentDispatch` so the argv-building itself becomes independently
 * testable (no spawn, no mock) — this function has no side effects and
 * performs no safety checks of its own (`spawnAgentDispatch` still owns the
 * `isSafeRunId`/`SAFE_AGENT_SLUG_RE` refusal, unchanged, before ever calling
 * this). Returns EXACTLY the array `cmdAgentDispatch`'s `rest` parameter
 * expects (`[slug, '--run-id', runId, ...optional flags]`) — NOT the full
 * node-invocation array; `spawnAgentDispatch` still prepends the
 * process-invocation boilerplate (`--experimental-strip-types`,
 * `orchestrator/cli.ts`, `agent`, `dispatch`) around this helper's output.
 *
 * Input keys are filtered through `SAFE_INPUT_KEY_RE` here (defense-in-depth,
 * unchanged from before this extraction) so no arg injects a flag. Input
 * VALUES are arbitrary — safe as a single `k=v` arg since `spawn()` runs no
 * shell.
 */
export function buildAgentDispatchArgs(
  slug: string,
  runId: string,
  project?: string,
  inputs?: Record<string, string>,
  /** R4-17, D6/D7 — when given, threaded through as `forge agent dispatch`'s
   *  `--session-dir <abs>` so the dispatch process can write the terminal
   *  phase into that session's status.json when the run ends (D7). Omitted
   *  by the generic `POST /api/agents/:slug/run` route (D6: byte-identical
   *  behaviour without it) — only `POST /api/studio/onboarding/start` passes
   *  it today. `sessionDir` is always OUR OWN already-created, already-
   *  realpath-verified directory (never request-derived text folded in
   *  here), so no extra validation is needed at this spawn-arg boundary; the
   *  process on the receiving end (`cmdAgentDispatch`, cli/agent-run.ts)
   *  guards its own write through it regardless.
   */
  sessionDir?: string,
  /** R6-04 (WI-2) — the operator's per-kickoff cost ceiling, already
   *  validated (finite, > 0, <= MAX_KICKOFF_COST_CEILING_USD) by the route
   *  before this is ever called. */
  costCeilingUsd?: number,
  /** Bead forge-c6h — the bridge's own SNAPSHOT `ctx.projectsRoot` (resolved
   *  once at `startBridge`), threaded through as `forge agent dispatch`'s
   *  `--projects-root <abs>` so the spawned subprocess's
   *  `writeSessionTerminalPhase` (cli/agent-run.ts) can honour THIS exact
   *  root verbatim instead of re-deriving its own from `forge.config.json`/
   *  env at write time — the re-derivation was the defect (see that
   *  function's docstring). `cmdAgentDispatch` re-validates this value
   *  itself (absolute/exists/contained-in-forgeRoot) before trusting it, so
   *  no extra validation is needed at this spawn-arg boundary. */
  projectsRoot?: string,
): string[] {
  const args = [slug, '--run-id', runId];
  if (project) args.push('--project', project);
  for (const [k, v] of Object.entries(inputs ?? {})) {
    if (!SAFE_INPUT_KEY_RE.test(k)) continue;
    args.push('--input', `${k}=${v}`);
  }
  if (sessionDir) args.push('--session-dir', sessionDir);
  if (costCeilingUsd !== undefined) args.push('--cost-ceiling-usd', String(costCeilingUsd));
  if (projectsRoot) args.push('--projects-root', projectsRoot);
  return args;
}

/**
 * Spawn `forge agent dispatch <slug> --run-id <runId> [--project <p>] [--input
 * k=v …]` detached — the generic sibling of `spawnAgentTurn` (R2-01-F3
 * dispatch half). Dry-bridge / no-spawn guarded; best-effort (a spawn error
 * never bubbles into the request). slug/runId/project are pre-validated by the
 * route; input keys are re-checked in `buildAgentDispatchArgs` (defense-in-
 * depth) so no arg injects a flag.
 */
function spawnAgentDispatch(
  forgeRoot: string,
  slug: string,
  runId: string,
  project?: string,
  inputs?: Record<string, string>,
  sessionDir?: string,
  costCeilingUsd?: number,
  /** Bead forge-c6h — see `buildAgentDispatchArgs`'s matching parameter. */
  projectsRoot?: string,
): void {
  // Argv construction is pure (no I/O, no side effects) — safe to build
  // above the spawn-suppression early-return below, so it stays observable
  // as ordinary function composition rather than something only a real spawn
  // attempt could exercise.
  const dispatchArgs = buildAgentDispatchArgs(slug, runId, project, inputs, sessionDir, costCeilingUsd, projectsRoot);
  if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge()) return;
  if (!isSafeRunId(runId) || !SAFE_AGENT_SLUG_RE.test(slug)) {
    console.error(`spawnAgentDispatch: unsafe slug/runId, refusing to spawn: ${JSON.stringify({ slug, runId })}`);
    return;
  }
  const args = ['--experimental-strip-types', 'orchestrator/cli.ts', 'agent', 'dispatch', ...dispatchArgs];
  try {
    const logDir = join(forgeRoot, '_logs', runId);
    mkdirSync(logDir, { recursive: true });
    const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
    const proc = spawn(process.execPath, args, { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] });
    closeSync(stderrFd);
    proc.unref();
    // W7-B5 (agents-30): EVERY dispatch records its child pid at
    // `_logs/<runId>/turn.pid` so the cancel route (`POST /api/agents/runs/
    // :runId/cancel`) can reach it. Ownership proof at kill time is the
    // runId in the child's own argv (`--run-id <runId>` — a whole element),
    // via the same `isTurnAlive` the session cancel uses. Guarded write,
    // best-effort like stderr.log.
    if (typeof proc.pid === 'number') {
      guardedWriteFile(join(forgeRoot, '_logs'), [runId, 'turn.pid'], `${proc.pid}\n`);
    }
    // W7-FIX-A2 (W7A2-01) — a session-bound dispatch (`--session-dir
    // <projectsRoot>/<project>/_<kind>/<sid>`, today only onboarding) records
    // its pid where the generic cancel route looks: `_logs/_<kind>-<sid>/
    // turn.pid` (`sessionLogDirName`, cli/bridge-studio-lifecycle.ts — the
    // SAME template `spawnAgentTurn` uses). Before this, onboarding was the
    // one kind `killTrackedTurn` could never find, so cancel returned
    // `killed:false` and left the agent running. `isTurnAlive` proves
    // ownership through the `--session-dir` value's basename (the sid) in
    // the child's own argv. kind/sid are derived from the ALREADY-validated
    // sessionDir the route built (never request text); the guarded write
    // refuses anything that does not resolve under `_logs`. Best-effort like
    // stderr.log — never bubbles into the request.
    if (sessionDir !== undefined && typeof proc.pid === 'number') {
      const sid = basename(sessionDir);
      const kind = basename(dirname(sessionDir)).replace(/^_/, '');
      if (kind.length > 0 && isSafeRunId(sid)) {
        guardedWriteFile(join(forgeRoot, '_logs'), [sessionLogDirName(kind, sid), 'turn.pid'], `${proc.pid}\n`);
      }
    }
  } catch { /* best-effort */ }
}

/**
 * SEC-04 (bd forge-ebj) — the ONE containment choke point for the bridge's
 * request-derived session-dir families (architect / instructions /
 * project-brain / demo). `project` and `sessionId` arrive from request input
 * (a JSON body value OR a decoded URL segment); `kindDirName` is a fixed
 * literal (`_architect` / `_instructions` / `_project-brain` / `_demo`). Each
 * untrusted value is passed as its OWN element of `resolveGuardedPath`'s
 * `segments[]` (cli/studio-path-guard.ts) — NEVER folded into `root` — so the
 * per-segment IDENTITY walk catches every escape shape from the
 * adversarial-containment-review catalogue: a `/`-, `.`- or `..`-laden segment,
 * a symlinked `<project>` / `_<kind>` / `<sessionId>`, a cross-object same-root
 * alias, and a hardlinked leaf.
 *
 * Returns the fully-resolved, contained dir, or `null` on ANY escape — a
 * missing dir and an escaping symlink both collapse to `null`, so the caller's
 * response is indistinguishable between "wrong id" and "blocked escape" (no
 * oracle). The leaf may legitimately NOT exist yet (the `/start` create case),
 * so existence is NOT required here; every read route separately returns 404
 * when its `status.json` / file is subsequently found absent, and every write
 * route mkdirs under a dir this function already proved contained.
 */
function guardedSessionDir(
  projectsRoot: string,
  project: string,
  kindDirName: string,
  sessionId: string,
): string | null {
  const guarded = resolveGuardedPath(projectsRoot, [project, kindDirName, sessionId]);
  return guarded.ok ? guarded.realPath : null;
}

/** R4-17, D8 — renders the operator's own onboarding-start `inputs` verbatim
 *  as `prompt.md`'s body. No fabricated interview: form field labels are
 *  never re-cast as agent questions, mirroring the honest single-turn shape
 *  project-brain's `prompt.md` already has. */
/**
 * W8-B3 (operator note ON-5) — the kb-cleanup session's OPENING OPERATOR TURN.
 *
 * ON-5: "there is no transcript for many of these sessions". Measured: a
 * kb-cleanup session's dir held only `status.json` until an operator verdict
 * landed, so `deriveSessionTranscript` honestly found nothing and the session
 * opened on an empty pane — even though the operator HAD made a request (they
 * clicked "Cleanup plan" on a specific KB's health panel). That request was
 * real input and simply was not written down.
 *
 * This records the request, at the moment it was made, in the same shape and
 * for the same reason `renderOnboardingPrompt` (below) records an onboarding
 * form: the operator's own inputs, verbatim, never re-cast as a fabricated
 * agent question (D8).
 *
 * The finding count is stamped "at kickoff" ON PURPOSE. It is a HISTORICAL
 * fact about the request, not a status field: the cleanup-plan artifact still
 * re-derives findings live from a fresh scan at read time
 * (`deriveCleanupPlan`), and nothing must ever read this line back as current
 * — see the `findings` comment on the start route itself.
 */
function renderKbCleanupPrompt(kbId: string, binding: { kind: string; ref?: string }, findingCount: number): string {
  const target = binding.ref === undefined ? binding.kind : `${binding.kind} ${binding.ref}`;
  return [
    `Clean up the knowledge base \`${kbId}\` (${target}).`,
    '',
    `Requested from that KB's health panel with ${findingCount} agent-tier finding${findingCount === 1 ? '' : 's'} open at kickoff.`,
    'Draft a cleanup plan for review; nothing is applied without an explicit approval.',
    '',
  ].join('\n');
}

function renderOnboardingPrompt(inputs: Record<string, string>): string {
  const keys = Object.keys(inputs);
  if (keys.length === 0) return '# Onboarding inputs\n\n(no inputs provided)\n';
  const lines = ['# Onboarding inputs', ''];
  for (const k of keys) lines.push(`- ${k}: ${inputs[k]}`);
  return lines.join('\n') + '\n';
}

/**
 * R4-16 PIN 4/5 (SEC-02, forge-d1f) — the COMPLETE set of `/start`-family
 * routes that accept a caller-supplied `projectRepoPath`: `/api/architect/start`,
 * `/api/instructions/start`, `/api/demo-builder/start`, and
 * `/api/project-brain/start`. Each persists it verbatim into the session's
 * `status.json` as `project_repo_path`. That field becomes the agent's
 * `cwd`, the target of real `git` branch-create + commit calls, and the base
 * for every artifact write — reproduced live: an unvalidated field served a
 * planted sentinel outside the forge tree and let a forged status write real
 * artifacts into an arbitrary git repo. This comment is the complete
 * enumeration — a future `/start`-family route accepting this field MUST
 * wire this same guard before any read/write/status-persist, not just add
 * itself to this list.
 *
 * Reuses the SHIPPED guard (`isContainedProjectRepoPath`,
 * `cli/manifest-path-guard.ts`) rather than a new check — same choke point
 * `cli/bridge-recovery.ts` already uses for `worktree_path` /
 * `project_repo_path` on the recovery routes. Returns the offending value
 * (so the caller can name it in the 400) when present-but-not-contained,
 * `null` when absent or genuinely contained under `<forgeRoot>/projects/`.
 *
 * Finding B: `''` is treated as absent here, matching every call site's
 * `body.projectRepoPath || join(ctx.projectsRoot, body.project)` default —
 * `??` does NOT substitute for `''`, so every call site MUST use `||`, never
 * `??`, for this field.
 *
 * Finding C: `candidate` is `unknown`, not `string | undefined` — the
 * request body is untrusted JSON and the static type is a lie about what
 * can actually arrive at runtime. A non-string value (e.g. `0`, `null`,
 * `{}`) must fail closed with a 400 naming it, rather than falling through
 * to `isAbsolute()` and leaking a raw Node `TypeError [ERR_INVALID_ARG_TYPE]`.
 *
 * PRECONDITION (load-bearing, stated because a future caller will otherwise
 * break it silently): `candidate` is `JSON.parse` output from a request body.
 * That is what makes the value space closed — string / number / boolean /
 * null / array / object, never a BigInt, Symbol, circular structure or a
 * hostile `toJSON`. This function is deliberately NOT exported; feeding it
 * from a non-JSON source would reopen shapes `describeRejectedValue` cannot
 * be assumed to survive.
 */
function invalidProjectRepoPath(candidate: unknown, roots: { forgeRoot: string; projectsRoot: string }): string | null {
  if (candidate === undefined || candidate === '') return null;
  if (typeof candidate !== 'string') return describeRejectedValue(candidate);
  return isContainedProjectRepoPath(candidate, roots) ? null : candidate;
}

/**
 * Wave-6 kickoff model-tier seam (ADR-043 §3 amendment, 2026-08-15) — the
 * COMPLETE set of `/start`-family routes that accept an optional
 * caller-supplied `modelTier`: `/api/architect/start`,
 * `/api/instructions/start`, `/api/project-brain/start`,
 * `/api/demo-builder/start`, `/api/studio/authoring/start`,
 * `POST /api/studio/kbs/:id/cleanup/start`. Each MUST validate it through
 * this helper BEFORE any mkdir/status write, and persist the returned
 * `tier` (when present) verbatim into the session's initial `status.json`
 * as `modelTier` — every turn runner (the four legacy runners +
 * `runInteractiveTurn`) reads it back from there and resolves it through
 * `resolveSessionModel` on EVERY turn (ADR 024's SKILL.md-is-the-envelope
 * contract, not just at kickoff).
 *
 * The allowed set is derived from the agent's OWN `SKILL.md` (via
 * `deriveAgentSpec` + `resolveSessionModel`) — NEVER a client-supplied list
 * — so a request naming a tier outside the skill's declared envelope
 * (`strategy:range`'s `range:`, or the single tier a `strategy:fixed` skill
 * pins) is rejected naming both the offending value and the real allowed
 * set, exactly per `resolveSessionModel`'s own error contract. Never trust a
 * wider set than the skill itself declares.
 *
 * `candidate` is `unknown`, not `string | undefined` — same untrusted-JSON
 * discipline as `invalidProjectRepoPath` above (request bodies are `JSON.parse`
 * output, so a non-string `modelTier` — `0`, `null`, `{}` — is a real shape
 * that must fail closed with a 400 naming it, not a raw `TypeError`).
 */
/**
 * W7-B6 (sessions-kinds-02 / projects-15 / crosscut-21): a kickoff `project`
 * must name a DISCOVERED project. Every session /start route used to accept
 * any string — the containment guards tolerate a not-yet-existing segment
 * (creation mode), so a typo minted `projects/<typo>/_<kind>/<sid>/` and the
 * phantom then appeared on /projects as a real project card (and, for the
 * architect, spawned a real agent turn against it). Returns the 404 reason,
 * or `null` when the project is in the roster. The KB-anchored kind
 * (kb-cleanup's `.kb-<id>`) has its own anchor rules and never passes
 * through this check.
 */
function unknownProjectReason(ctx: HttpContext, candidate: unknown): string | null {
  // NON-STRING shapes and containment-rejected strings (traversal, "..",
  // separators, control chars — everything `isSafeSegment` refuses) stay
  // each route's own (pre-existing, PINNED) 400 contracts — they fall
  // THROUGH this check so those guards keep firing exactly as before. But a
  // string isSafeSegment ACCEPTS that still fails PROJECT_ID_RE is the
  // creation-mode GAP (W7-B6 review F1): spaces, interior dots, leading
  // "_"/"."/"-" all pass the containment guard, so "my project" or
  // ".hidden" minted a phantom projects/<junk>/ (and, for the architect,
  // spawned a paid agent turn) straight past the roster check — those are
  // refused HERE. `invalidGenerationProjectReason` is the ONE project-id
  // shape rule (length cap THEN charset, value interpolation bounded),
  // reused rather than re-declared.
  if (typeof candidate !== 'string') return null;
  if (isSafeSegment(candidate)) {
    const invalidShape = invalidGenerationProjectReason(candidate);
    if (invalidShape !== null) return invalidShape;
  } else {
    return null; // the downstream containment guard's own pinned 400 fires
  }
  const known = discoverProjects(ctx.projectsRoot, ctx.forgeRoot).some((p) => p.id === candidate);
  return known ? null : `unknown project "${candidate}" — not in the project roster (onboard it at /projects/new first)`;
}

function resolveKickoffModelTier(
  agentSlug: string,
  candidate: unknown,
): { ok: true; tier: ModelTier | undefined } | { ok: false; error: string } {
  if (candidate === undefined) return { ok: true, tier: undefined };
  if (typeof candidate !== 'string') {
    return { ok: false, error: `modelTier must be a string (got ${describeRejectedValue(candidate)})` };
  }
  try {
    const spec = deriveAgentSpec(skillPathRelative(agentSlug));
    resolveSessionModel(spec, candidate as ModelTier);
    return { ok: true, tier: candidate as ModelTier };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Cap on the rendered offending value interpolated into a 400 body. Two
 *  independent reasons, both measured: (1) `JSON.stringify` THROWS
 *  `RangeError: Maximum call stack size exceeded` on a deeply nested value —
 *  measured boundary on this build: fine at depth 4,166, throws at 4,167,
 *  while `JSON.parse` still succeeds at depth 100,000, so a wire body can
 *  reach this function and blow up inside it; and (2) without a cap the
 *  response is unbounded — measured, a 200,038-byte request produced a
 *  300,063-byte response, LARGER than the request because re-quoting adds
 *  overhead. Closing a `TypeError` leak while shipping a `RangeError` leak in
 *  the same error-formatting path would be this campaign's "the fix ships its
 *  own instance of the defect it closed" pattern, for the fourth time. */
const MAX_REJECTED_VALUE_CHARS = 200;

/** Renders an untrusted, non-string value for a 400 body: never throws, never
 *  unbounded. The `?? String(candidate)` arm covers the values whose
 *  `JSON.stringify` is `undefined` rather than a string. */
function describeRejectedValue(candidate: unknown): string {
  let rendered: string;
  try {
    rendered = JSON.stringify(candidate) ?? String(candidate);
  } catch {
    rendered = '<unrepresentable value>';
  }
  if (rendered.length <= MAX_REJECTED_VALUE_CHARS) return rendered;
  return `${rendered.slice(0, MAX_REJECTED_VALUE_CHARS)}… (${rendered.length} chars, truncated)`;
}

/** Parse an already-read JSON string; null on malformed content. Companion to
 *  the guarded read primitives (which return raw contents, not parsed JSON) so
 *  a SEC-04 guarded read can replace a `readJsonFile(join(dir, leaf))` call
 *  without re-following the leaf: the guard read the bytes, this parses them. */
function safeParseJson<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function newArchitectSessionId(): string {
  // YYYY-MM-DDTHH-mm-ss (matches ArchitectSession.session_id elsewhere) plus
  // an 8-hex-char entropy suffix (R4-17 round-3 BLOCKER pin 5, item 1, close
  // 3): the timestamp alone has only ONE-SECOND granularity — zero entropy —
  // so a session id was guessable well enough to pre-plant a colliding
  // directory (reproduced live, 100% hit rate over a 4-second candidate
  // window; see cli/ui-bridge-onboarding-start.test.ts AT-13/14/15/17). This
  // helper is shared by FIVE routes (architect / instructions /
  // project-brain / demo-builder / onboarding start) and nothing downstream
  // string-matches the bare timestamp shape — only SAFE_ID_RE plus a length
  // cap gate it — so fixing it here fixes all five in one place rather than
  // only the caller that happened to get adversarially reviewed.
  //
  // Hex digits are a subset of SAFE_ID_RE's charset ([A-Za-z0-9_-]), and the
  // fixed-width timestamp prefix still sorts chronologically across
  // different seconds (the entropy suffix only breaks ties WITHIN the same
  // second, where finer ordering was never a guarantee anyway).
  const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+$/, '');
  const entropy = randomBytes(4).toString('hex');
  return `${stamp}-${entropy}`;
}

/** Returns true if the request was an architect route (and was handled). */
async function handleArchitect(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HttpContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);

  // GET /api/architect/sessions — list every session with its current state.
  if (method === 'GET' && url === '/api/architect/sessions') {
    const statuses = listArchitectSessions(ctx.projectsRoot);
    // Live-tail each non-terminal session's log so the dedicated screen's hex
    // streams tool bursts (idempotent; no-ops if the log doesn't exist yet).
    for (const s of statuses) {
      if (!LEGACY_SESSION_TERMINAL_PHASES.architect.has(s.phase)) ctx.ensureSessionTail(SPAWN_AGENT_SPECS.architect.logPrefix, s.session_id);
    }
    // W8-A2 (ON-7 defect 1) — loaded ONCE per request (a single YAML parse),
    // not once per row; `deriveRowLifecycle` below takes the already-resolved
    // descriptor. `undefined` only if the registry itself lacks 'architect'
    // (never true for the real studio/session-kinds.yaml — architect is
    // "permanently bespoke", isTerminalPhase's own doc comment) — degrades to
    // no lifecycle on the row rather than 500ing the whole list.
    const architectDescriptor = findSessionKindDescriptorSafe(ctx.forgeRoot, 'architect');
    const sessions = statuses.map((s) => {
      // SEC-04 (bd forge-ebj) — this used a RAW `architectSessionDir` join and
      // then raw-appended each leaf (worse than dir-guarded): a symlinked
      // `_architect`/session dir OR a symlinked `questions.json`/`PLAN.html`
      // leaf (git-plantable inside a project repo) was followed out of root.
      // Route each leaf through the guard, request ids as their OWN segments
      // under the trusted projectsRoot.
      const dirSegs = [s.project, '_architect', s.session_id];
      const questionsRaw =
        s.phase === 'awaiting-answers'
          ? guardedReadFile(ctx.projectsRoot, [...dirSegs, 'questions.json'])
          : null;
      const questions = questionsRaw !== null ? safeParseJson<ArchitectQuestion[]>(questionsRaw) : null;
      const planUrl = guardedFile(ctx.projectsRoot, [...dirSegs, 'PLAN.html'], 'read') !== null
        ? `/api/architect/file/${encodeURIComponent(s.project)}/${encodeURIComponent(s.session_id)}/PLAN.html`
        : null;
      // W7-A3 (sessions-kinds-08/12, artifact-plan-22/23): the initiative ids
      // this session drafted — DERIVED at read time from its `manifests/*.md`
      // (the same files finalize promotes to `_queue/pending`), never stored
      // on status.json. Same guard family as the leaves above: a symlinked
      // `manifests` dir yields [] rather than being followed out of root.
      const initiativeIds = (guardedReadDir(ctx.projectsRoot, [...dirSegs, 'manifests']) ?? [])
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.slice(0, -'.md'.length))
        .sort();

      // W8-A2 (ON-7 defect 1) — the derived lifecycle (state/needsYou/error/
      // idleMs/cancellable): the SAME derivation the aggregate `/api/studio/
      // sessions` index already carried per row — this dedicated route never
      // called it before (`deriveSessionLifecycleFor` was imported once,
      // called once, by that other route alone).
      //
      // `staleMs` deliberately does NOT come from `lifecycle.idleMs`.
      // Collapsing it into idleMs was tried and REVERTED: idleMs is
      // `now - max(status.json MTIME, .heartbeat, events.jsonl)`, and the
      // runner rewrites status.json on every phase transition, so a dead
      // runner whose file was merely touched reads FRESH. The runner's own
      // `updated_at` is its CLAIM about when it last made progress, which is
      // the honest signal and the one this panel has always used; the file's
      // mtime is a weaker proxy that fails OPEN. Caught by the flows-run
      // stall cameo, whose fixture writes status.json NOW with an
      // `updated_at` 200s old and deletes the heartbeat — precisely the
      // divergence. `isSessionStale` (apps/studio/lib/architect-hex.ts) reads
      // this field against STALE_THRESHOLD_MS (120s), matched by
      // STALL_CEILING_MS_BY_KIND.architect.
      const rowLifecycle = architectDescriptor
        ? deriveRowLifecycle(ctx, architectDescriptor, s.phase, s.project, s.session_id).lifecycle
        : null;
      const staleMs = sessionStaleMs(ctx, 'architect', s.session_id, s.updated_at, rowLifecycle);

      return {
        sessionId: s.session_id,
        project: s.project,
        projectRepoPath: s.project_repo_path,
        phase: s.phase,
        round: s.round,
        idea: s.idea,
        questions,
        planUrl,
        staleMs,
        ...(rowLifecycle ? { lifecycle: rowLifecycle } : {}),
        completenessCritic: s.completenessCritic ?? null,
        initiativeIds,
      };
    });
    sendJson(res, 200, { sessions }, origin);
    return true;
  }

  // GET /api/architect/file/<project>/<sid>/<filename> — serve a session-dir
  // file (PLAN.html etc.) with a path-escape guard + content-type sniff.
  if (method === 'GET' && url.startsWith('/api/architect/file/')) {
    const rest = url.slice('/api/architect/file/'.length).split('/').map(decodeURIComponent);
    const [project, sessionId, ...fileParts] = rest;
    const filename = fileParts.join('/');
    if (!project || !sessionId || !filename) {
      sendJson(res, 400, { error: 'expected /api/architect/file/<project>/<sid>/<filename>' }, origin);
      return true;
    }
    // SEC-04 (bd forge-ebj) — the old `startsWith(base)` check was
    // self-defeating: `base` and `requested` were BOTH built from the same
    // untrusted `project`/`sessionId`, so a traversal in either was invisible
    // to the comparison (`join` only normalises `..` inside `filename`).
    // Resolve the WHOLE path — project, `_architect`, sessionId AND the
    // filename segments — through the per-segment identity guard; `!ok` (any
    // escape) and `!exists` (contained but absent) both collapse to 404.
    const guarded = resolveGuardedPath(ctx.projectsRoot, [project, '_architect', sessionId, ...filename.split('/')]);
    if (!guarded.ok) {
      // A containment escape (traversed project/sessionId, or a `..`/absolute
      // filename) — rejected BEFORE any existence probe, so out-of-root
      // existence is never leaked.
      sendJson(res, 400, { error: 'path escape rejected' }, origin);
      return true;
    }
    if (!guarded.exists) {
      sendJson(res, 404, { error: 'file not found', project, sessionId, filename }, origin);
      return true;
    }
    const requested = guarded.realPath;
    try {
      res.writeHead(200, servedFileHeaders(filename, origin));
      res.end(readFileSync(requested, 'utf8'));
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/architect/start {project, idea, projectRepoPath?} — create a new
  // session and kick off the first interview turn.
  if (method === 'POST' && url === '/api/architect/start') {
    try {
      const body = (await readJson(req)) as { project?: string; idea?: string; projectRepoPath?: string; modelTier?: unknown; costCeilingUsd?: unknown };
      if (!body.project || !body.idea) {
        sendJson(res, 400, { error: 'project and idea are required' }, origin);
        return true;
      }
      // W7-B6 (projects-15 / crosscut-21): the most expensive kickoff used to
      // accept ANY project string — a typo created a phantom project dir AND
      // spawned a real agent turn against it. Roster check BEFORE anything.
      const unknownReason = unknownProjectReason(ctx, body.project);
      if (unknownReason !== null) {
        sendJson(res, 404, { error: unknownReason }, origin);
        return true;
      }
      // SEC-02 (forge-d1f) — reject BEFORE any mkdirSync/writeFileSync/status
      // write. See invalidProjectRepoPath's header for the defect.
      const badRepoPath = invalidProjectRepoPath(body.projectRepoPath, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot });
      if (badRepoPath !== null) {
        sendJson(res, 400, { error: `projectRepoPath is not a valid project directory: ${badRepoPath}` }, origin);
        return true;
      }
      // ADR-043 §3 amendment (wave-6) — validated EARLY, against the real
      // architect SKILL.md envelope. See resolveKickoffModelTier's header.
      const modelTierResult = resolveKickoffModelTier('architect', body.modelTier);
      if (!modelTierResult.ok) {
        sendJson(res, 400, { error: modelTierResult.error }, origin);
        return true;
      }
      // W7-B6 (projects-14 / sessions-kinds-03): an operator cost ceiling for
      // the whole architect session — same validation envelope as the agent
      // dispatch route; enforced by the runner at every turn start (a turn
      // that would START past the ceiling is refused with the reason in the
      // session's own error surface — never a silent overrun).
      let costCeilingUsd: number | undefined;
      if (body.costCeilingUsd !== undefined) {
        const v = body.costCeilingUsd;
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_KICKOFF_COST_CEILING_USD) {
          sendJson(
            res,
            400,
            { error: `invalid costCeilingUsd: ${JSON.stringify(v)} (must be a finite number > 0 and <= ${MAX_KICKOFF_COST_CEILING_USD})` },
            origin,
          );
          return true;
        }
        costCeilingUsd = v;
      }
      const sessionId = newArchitectSessionId();
      // SEC-04 — guard BEFORE the UNCONDITIONED mkdir+write: a traversal
      // `project` must create NOTHING out of root (the old code wrote
      // idea.md=body.idea to `<outside>/_architect/<sid>/`).
      const dirSegs = [body.project, '_architect', sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_architect', sessionId);
      if (!dir) {
        sendJson(res, 400, { error: 'invalid project' }, origin);
        return true;
      }
      const status: ArchitectStatus = {
        session_id: sessionId,
        project: body.project,
        project_repo_path: body.projectRepoPath || join(ctx.projectsRoot, body.project),
        phase: 'interviewing',
        round: 1,
        idea: body.idea,
        updated_at: new Date().toISOString(),
        ...(modelTierResult.tier ? { modelTier: modelTierResult.tier } : {}),
        ...(costCeilingUsd !== undefined ? { costCeilingUsd } : {}),
      };
      // SEC-04 (bd forge-ebj) — route both leaf writes (`idea.md`, `status.json`)
      // through the guard (leaf included) rather than raw-appending onto the
      // contained dir; guardedWriteFile/guardedWriteStatus mkdir the parent and
      // refuse a symlinked/hardlinked leaf (⇒ null ⇒ 400, nothing written).
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'idea.md'], body.idea) === null ||
        guardedWriteStatus(ctx.projectsRoot, dirSegs, status) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      spawnAgentTurn(ctx.forgeRoot, 'architect', body.project, sessionId);
      ctx.broadcastArchitectChanged();
      sendJson(res, 200, { ok: true, sessionId, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/architect/start', sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/architect/answer {project, sessionId, answers} — append an
  // interview round and re-spawn a turn.
  if (method === 'POST' && url === '/api/architect/answer') {
    try {
      const body = (await readJson(req)) as {
        project?: string;
        sessionId?: string;
        answers?: { question: string; answer: string }[];
      };
      if (!body.project || !body.sessionId || !Array.isArray(body.answers)) {
        sendJson(res, 400, { error: 'project, sessionId, answers[] are required' }, origin);
        return true;
      }
      // SEC-04 — guard BEFORE the lockfile.lock (which would otherwise create
      // a `.lock` at an out-of-root traversed path) and before any read/write.
      const dirSegs = [body.project, '_architect', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_architect', body.sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      // R4-04 review finding: guard + serialize like applyPlanVerdict — the
      // interview→exploring→drafting turn is longer now, and an answer
      // landing mid-turn would yank a live session back to 'interviewing'
      // (a stray double-submit could previously do the same). The lock
      // serializes against the runner's own status writes; the phase guard
      // 409s anything that isn't actually waiting for answers.
      // The lock path sits in the already-contained dir; the status/answers
      // CONTENT reads+writes below go through the SEC-04 guarded leaf siblings
      // (leaf included) so a symlinked `status.json`/`answers.json` is refused.
      const statusPath = join(dir, 'status.json');
      let round = 0;
      let release: (() => Promise<void>) | null = null;
      try {
        release = await lockfile.lock(statusPath, { retries: { retries: 5, minTimeout: 50 } });
      } catch {
        sendJson(res, 409, { error: 'session is busy — try again' }, origin);
        return true;
      }
      try {
        const status = guardedReadStatus(ctx.projectsRoot, dirSegs);
        if (!status) {
          sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
          return true;
        }
        if (status.phase !== 'awaiting-answers') {
          sendJson(res, 409, { error: `session is not awaiting answers (phase: ${status.phase})` }, origin);
          return true;
        }
        const priorRaw = guardedReadFile(ctx.projectsRoot, [...dirSegs, 'answers.json']);
        const prior = (priorRaw !== null ? safeParseJson<{ round: number; answers: unknown[] }[]>(priorRaw) : null) ?? [];
        round = prior.length + 1;
        if (
          guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'answers.json'], JSON.stringify([...prior, { round, answers: body.answers }], null, 2)) === null ||
          guardedWriteStatus(ctx.projectsRoot, dirSegs, { ...status, phase: 'interviewing', round: round + 1 }) === null
        ) {
          sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
          return true;
        }
      } finally {
        if (release) await release().catch(() => {});
      }
      spawnAgentTurn(ctx.forgeRoot, 'architect', body.project, body.sessionId);
      ctx.broadcastArchitectChanged();
      sendJson(res, 200, { ok: true, round, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/architect/answer', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/architect/rerun {project, sessionId} — StuckWarning's one-click
  // re-run affordance (R4-11-T5). Re-invokes the EXISTING session's turn
  // as-is: unlike /api/architect/answer, no round is appended and no
  // answers.json write happens — the runner re-reads status.json fresh at
  // turn start and resumes wherever it left off, so there's nothing to
  // rewrite here beyond confirming the session exists before spawning.
  if (method === 'POST' && url === '/api/architect/rerun') {
    try {
      const body = (await readJson(req)) as { project?: string; sessionId?: string };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      // SEC-04 — guard the request-derived session dir before resolving/reading
      // it: a traversal `project` must not resolve to an out-of-root session,
      // and the status.json READ goes through the guarded leaf sibling so a
      // symlinked status leaf inside a real dir is refused, not followed.
      const dirSegs = [body.project, '_architect', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_architect', body.sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const status = guardedReadStatus(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      spawnAgentTurn(ctx.forgeRoot, 'architect', body.project, body.sessionId);
      ctx.broadcastArchitectChanged();
      sendJson(res, 200, { ok: true, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/architect/rerun', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/plan-verdict — delegates to applyPlanVerdict in bridge-studio.ts.
  if (method === 'POST' && url === '/api/plan-verdict') {
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const planCtx: StudioPostContext = {
        forgeRoot: ctx.forgeRoot,
        logsRoot: ctx.logsRoot,
        queueRoot: ctx.queueRoot,
        projectsRoot: ctx.projectsRoot,
        mergePr: ctx.mergePr,
        finalizeAfterMerge: ctx.finalizeAfterMerge,
        broadcastArchitectChanged: ctx.broadcastArchitectChanged,
        spawnArchitectTurnFn: (forgeRoot, project, sessionId) => spawnAgentTurn(forgeRoot, 'architect', project, sessionId),
      };
      await applyPlanVerdict(req, res, planCtx, {
        project: typeof body['project'] === 'string' ? body['project'] : '',
        sessionId: typeof body['sessionId'] === 'string' ? body['sessionId'] : '',
        kind: (body['kind'] as 'approve' | 'revise' | 'reject') ?? 'reject',
        rationale: typeof body['rationale'] === 'string' ? body['rationale'] : undefined,
        entryRoute: '/api/plan-verdict',
      });
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

// ---- Instructions-creator routes (Stage A) --------------------------------
//
// Mirrors the architect routes: an operator-driven, file-checkpointed runner
// that authors a managed project's AGENTS.md (interview → draft → verdict →
// finalize). The bridge spawns one CLI turn per operator action via the
// shared `spawnAgentTurn(forgeRoot, 'instructions', project, sessionId)`.

/** Discover every instructions session under `projects/<name>/_instructions/<sid>/`
 *  — used by the bridge's `GET /api/instructions/sessions`. Best-effort; never
 *  throws on a malformed dir. Mirrors architect-runner's `listArchitectSessions`,
 *  kept local to the bridge (not added to the runner). */
function listInstructionsSessions(projectsRoot: string): InstructionsStatus[] {
  const out: InstructionsStatus[] = [];
  if (!existsSync(projectsRoot)) return out;
  let projects: string[];
  try { projects = readdirSync(projectsRoot); } catch { return out; }
  for (const project of projects) {
    const instrDir = join(projectsRoot, project, '_instructions');
    if (!existsSync(instrDir)) continue;
    let sids: string[];
    try {
      sids = readdirSync(instrDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch { continue; }
    for (const sid of sids) {
      if (sid.startsWith('_')) continue; // skip _archived/
      // SEC-04 (AT-47) — resolve through the per-segment identity guard so a
      // symlinked `_instructions` (git-plantable inside any onboarded project's
      // own repo) cannot fold this enumeration onto a victim dir outside root.
      const dir = guardedSessionDir(projectsRoot, project, '_instructions', sid);
      if (!dir) continue;
      // SEC-04 (bd forge-ebj) — route the status.json READ through the guarded
      // leaf sibling so a symlinked `status.json` inside a real session dir is
      // refused, not followed (the dir guard alone did not cover the leaf).
      const status = guardedReadSessionStatus<InstructionsStatus>(projectsRoot, [project, '_instructions', sid]);
      if (status) out.push(status);
    }
  }
  return out;
}

/** Returns true if the request was an instructions route (and was handled). */
async function handleInstructions(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HttpContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);

  // GET /api/instructions/sessions — list every session with its current state.
  if (method === 'GET' && url === '/api/instructions/sessions') {
    const statuses = listInstructionsSessions(ctx.projectsRoot);
    // Live-tail each non-terminal session's log so the dedicated screen's hex
    // streams tool bursts (idempotent; no-ops if the log doesn't exist yet).
    for (const s of statuses) {
      if (!LEGACY_SESSION_TERMINAL_PHASES.instructions.has(s.phase)) ctx.ensureSessionTail(SPAWN_AGENT_SPECS.instructions.logPrefix, s.session_id);
    }
    // W8-A2 (ON-7 defect 1) — see the architect route's identical comment.
    const instructionsDescriptor = findSessionKindDescriptorSafe(ctx.forgeRoot, 'instructions');
    const sessions = statuses.map((s) => {
      // SEC-04 — resolve through the shared guard (the enumeration is already
      // guarded, so this is the same contained dir; keeps this file free of
      // bare request-derived session-dir builders).
      // SEC-04 (bd forge-ebj) — route each leaf through the guard (the dir was
      // already contained, but the `questions.json`/draft leaves were then
      // raw-appended and would follow a symlinked leaf).
      const dirSegs = [s.project, '_instructions', s.session_id];
      const questionsRaw =
        s.phase === 'awaiting-answers'
          ? guardedReadFile(ctx.projectsRoot, [...dirSegs, 'questions.json'])
          : null;
      const questions = questionsRaw !== null ? safeParseJson<InterviewQuestion[]>(questionsRaw) : null;
      const draftUrl = guardedFile(ctx.projectsRoot, [...dirSegs, DRAFT_FILENAME], 'read') !== null
        ? `/api/instructions/file/${encodeURIComponent(s.project)}/${encodeURIComponent(s.session_id)}/${encodeURIComponent(DRAFT_FILENAME)}`
        : null;

      // W8-A2 (ON-7 defect 1) — see the architect route: the derived lifecycle,
      // and `staleMs` from the runner's own heartbeat/`updated_at`, never the
      // status file's mtime.
      const rowLifecycle = instructionsDescriptor
        ? deriveRowLifecycle(ctx, instructionsDescriptor, s.phase, s.project, s.session_id).lifecycle
        : null;
      const staleMs = sessionStaleMs(ctx, 'instructions', s.session_id, s.updated_at, rowLifecycle);

      // Surface the current AGENTS.md so the briefing screen can show the file
      // the operator is editing (and the read-only context for their notes).
      const current = readAgentInstructionsFile(s.project_repo_path);
      return {
        sessionId: s.session_id,
        project: s.project,
        projectRepoPath: s.project_repo_path,
        phase: s.phase,
        mode: s.mode ?? 'init',
        round: s.round,
        prompt: s.prompt,
        questions,
        draftUrl,
        currentInstructions: current ? current.content : null,
        currentInstructionsFile: current ? current.file : null,
        staleMs,
        ...(rowLifecycle ? { lifecycle: rowLifecycle } : {}),
      };
    });
    sendJson(res, 200, { sessions }, origin);
    return true;
  }

  // GET /api/instructions/file/<project>/<sid>/<filename> — serve a session-dir
  // file (AGENTS.draft.md etc.) with a path-escape guard + content-type sniff.
  if (method === 'GET' && url.startsWith('/api/instructions/file/')) {
    const rest = url.slice('/api/instructions/file/'.length).split('/').map(decodeURIComponent);
    const [project, sessionId, ...fileParts] = rest;
    const filename = fileParts.join('/');
    if (!project || !sessionId || !filename) {
      sendJson(res, 400, { error: 'expected /api/instructions/file/<project>/<sid>/<filename>' }, origin);
      return true;
    }
    // SEC-04 — same self-defeating `startsWith(base)` defect as the architect
    // /file route; resolve the whole path (project, `_instructions`, sessionId,
    // filename) through the per-segment identity guard instead.
    const guarded = resolveGuardedPath(ctx.projectsRoot, [project, '_instructions', sessionId, ...filename.split('/')]);
    if (!guarded.ok) {
      // A containment escape — rejected BEFORE any existence probe, so
      // out-of-root existence is never leaked.
      sendJson(res, 400, { error: 'path escape rejected' }, origin);
      return true;
    }
    if (!guarded.exists) {
      sendJson(res, 404, { error: 'file not found', project, sessionId, filename }, origin);
      return true;
    }
    const requested = guarded.realPath;
    try {
      res.writeHead(200, servedFileHeaders(filename, origin));
      res.end(readFileSync(requested, 'utf8'));
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/instructions/start {project, mode?, projectRepoPath?} — create a
  // session in the `briefing` phase. It does NOT spawn the agent: the operator
  // lands on the screen, reviews the current AGENTS.md (edit mode), and provides
  // notes; POST /api/instructions/brief then kicks off the agent.
  if (method === 'POST' && url === '/api/instructions/start') {
    try {
      const body = (await readJson(req)) as { project?: string; mode?: 'init' | 'edit'; projectRepoPath?: string; modelTier?: unknown };
      if (!body.project) {
        sendJson(res, 400, { error: 'project is required' }, origin);
        return true;
      }
      // W7-B6 (sessions-kinds-02): roster check — a typo'd project used to
      // mkdir a phantom projects/<typo>/_instructions/<sid>/ forever.
      const unknownInstrProject = unknownProjectReason(ctx, body.project);
      if (unknownInstrProject !== null) {
        sendJson(res, 404, { error: unknownInstrProject }, origin);
        return true;
      }
      // SEC-02 (forge-d1f) — reject BEFORE the readAgentInstructionsFile read
      // below (an unvalidated READ through the field, not just a write
      // target) and before any mkdirSync/status write. See
      // invalidProjectRepoPath's header for the defect.
      const badRepoPath = invalidProjectRepoPath(body.projectRepoPath, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot });
      if (badRepoPath !== null) {
        sendJson(res, 400, { error: `projectRepoPath is not a valid project directory: ${badRepoPath}` }, origin);
        return true;
      }
      // ADR-043 §3 amendment (wave-6) — validated EARLY, against the real
      // instructions-creator SKILL.md envelope.
      const modelTierResult = resolveKickoffModelTier('instructions-creator', body.modelTier);
      if (!modelTierResult.ok) {
        sendJson(res, 400, { error: modelTierResult.error }, origin);
        return true;
      }
      // forge-osz — the `projectRepoPath || join(projectsRoot, project)` fallback
      // reaches readAgentInstructionsFile with a repoPath folded from the untrusted
      // `body.project`; guardedSessionDir below only guards the WRITE, and runs
      // AFTER this read. Guard the `body.project` segment through the SAME
      // resolveGuardedPath choke point the four sibling /start routes use, BEFORE
      // the read, so an untrusted project cannot fold an out-of-root read into a
      // trusted root.
      let repoPath: string;
      if (body.projectRepoPath) {
        repoPath = body.projectRepoPath;
      } else {
        const guardedProject = resolveGuardedPath(ctx.projectsRoot, [body.project]);
        if (!guardedProject.ok) {
          sendJson(res, 400, { error: 'invalid project' }, origin);
          return true;
        }
        repoPath = guardedProject.realPath;
      }
      // Default the mode by whether an agent-instruction file already exists.
      const mode: 'init' | 'edit' =
        body.mode ?? (readAgentInstructionsFile(repoPath) ? 'edit' : 'init');
      const sessionId = newArchitectSessionId();
      // SEC-04 — guard BEFORE the UNCONDITIONED mkdir+status write: a traversal
      // `project` must create no out-of-root `_instructions` session.
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_instructions', sessionId);
      if (!dir) {
        sendJson(res, 400, { error: 'invalid project' }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — status.json WRITE through the guarded leaf
      // sibling (leaf included; mkdirs the parent, refuses a symlinked leaf).
      if (guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, [body.project, '_instructions', sessionId], {
        session_id: sessionId,
        project: body.project,
        project_repo_path: repoPath,
        phase: 'briefing',
        mode,
        round: 1,
        prompt: '',
        updated_at: new Date().toISOString(),
        ...(modelTierResult.tier ? { modelTier: modelTierResult.tier } : {}),
      }) === null) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      ctx.broadcastInstructionsChanged();
      sendJson(res, 200, { ok: true, sessionId, mode }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/instructions/brief {project, sessionId, brief} — record the
  // operator's brief / change-notes and kick off the agent (briefing → interviewing).
  if (method === 'POST' && url === '/api/instructions/brief') {
    try {
      const body = (await readJson(req)) as { project?: string; sessionId?: string; brief?: string };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — the dir guard below contains the DIRECTORY,
      // but each leaf (`status.json`, `prompt.md`) was then raw-appended and
      // read/written through `join(dir, leaf)`, which FOLLOWS a symlinked leaf.
      // Route every leaf — request ids as their OWN segments under the trusted
      // projectsRoot, leaf included — through the guarded siblings so a
      // symlinked/hardlinked `status.json`/`prompt.md` inside a real session
      // dir is refused (read ⇒ null ⇒ 404; write ⇒ null ⇒ 400, nothing written).
      const dirSegs = [body.project, '_instructions', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_instructions', body.sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const status = guardedReadSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const brief = body.brief ?? '';
      // W6-B9 reviewer fix (parity): the generic `briefing-question-form`
      // affordance's equivalent field (`handleInstructionsBrief`,
      // cli/bridge-studio-affordances.ts) already caps at
      // MAX_ANSWER_FIELD_BYTES — this bespoke route writes the SAME
      // prompt.md/status.prompt target and must cap identically, one shared
      // constant, not two hand-kept limits (one bounded, one not).
      const briefBytes = Buffer.byteLength(brief, 'utf8');
      if (briefBytes > MAX_ANSWER_FIELD_BYTES) {
        sendJson(res, 400, { error: `brief is ${briefBytes} bytes — exceeds the ${MAX_ANSWER_FIELD_BYTES}-byte limit` }, origin);
        return true;
      }
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'prompt.md'], brief) === null ||
        guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'interviewing', round: 1, prompt: brief }) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      spawnAgentTurn(ctx.forgeRoot, 'instructions', body.project, body.sessionId);
      ctx.broadcastInstructionsChanged();
      sendJson(res, 200, { ok: true, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/instructions/brief', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/instructions/answer {project, sessionId, answers} — append an
  // interview round and re-spawn a turn.
  if (method === 'POST' && url === '/api/instructions/answer') {
    try {
      const body = (await readJson(req)) as {
        project?: string;
        sessionId?: string;
        answers?: { question: string; answer: string }[];
      };
      if (!body.project || !body.sessionId || !Array.isArray(body.answers)) {
        sendJson(res, 400, { error: 'project, sessionId, answers[] are required' }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — guard the request-derived session dir, and
      // route every leaf (status.json, answers.json) through the guarded leaf
      // siblings so a symlinked leaf inside a real dir is refused, not followed.
      const dirSegs = [body.project, '_instructions', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_instructions', body.sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const status = guardedReadSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const priorRaw = guardedReadFile(ctx.projectsRoot, [...dirSegs, 'answers.json']);
      const prior = (priorRaw !== null ? safeParseJson<{ round: number; answers: unknown[] }[]>(priorRaw) : null) ?? [];
      const round = prior.length + 1;
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'answers.json'], JSON.stringify([...prior, { round, answers: body.answers }], null, 2)) === null ||
        guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'interviewing', round: round + 1 }) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      spawnAgentTurn(ctx.forgeRoot, 'instructions', body.project, body.sessionId);
      ctx.broadcastInstructionsChanged();
      sendJson(res, 200, { ok: true, round, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/instructions/answer', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/instructions/verdict {project, sessionId, kind, feedback?} —
  // approve → finalizing; revise → write feedback.md + drafting; reject → rejected.
  if (method === 'POST' && url === '/api/instructions/verdict') {
    try {
      const body = (await readJson(req)) as {
        project?: string;
        sessionId?: string;
        kind?: 'approve' | 'revise' | 'reject';
        feedback?: string;
      };
      if (!body.project || !body.sessionId || !body.kind) {
        sendJson(res, 400, { error: 'project, sessionId, kind are required' }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — guard the dir, and route each leaf (status.json,
      // feedback.md) through the guarded leaf siblings (leaf-symlink close).
      const dirSegs = [body.project, '_instructions', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_instructions', body.sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const status = guardedReadSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      let wrote: string | null;
      if (body.kind === 'approve') {
        wrote = guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'finalizing' });
      } else if (body.kind === 'revise') {
        // W7-C2 T1 review (A12) — parity with the generic route: an EMPTY
        // revise is refused here too. `body.feedback ?? ''` used to accept
        // one, so the bespoke surface re-ran the drafting turn with no
        // guidance (which regenerates the same draft) where the generic
        // route 400s — two routes onto the same on-disk state disagreeing
        // about the same rule.
        if (typeof body.feedback !== 'string' || body.feedback.trim().length === 0) {
          sendJson(res, 400, { error: `feedback is required for kind "revise" — say what to change, got ${JSON.stringify(body.feedback)}` }, origin);
          return true;
        }
        const wroteFeedback = guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'feedback.md'], body.feedback);
        wrote = wroteFeedback === null ? null : guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'drafting' });
      } else {
        wrote = guardedWriteSessionStatus<InstructionsStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'rejected' });
      }
      if (wrote === null) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      spawnAgentTurn(ctx.forgeRoot, 'instructions', body.project, body.sessionId);
      ctx.broadcastInstructionsChanged();
      sendJson(res, 200, { ok: true, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/instructions/verdict', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  return false;
}

// ---- Demo-builder routes (Stage B) ----------------------------------------
//
// Mirrors the instructions routes: an operator-driven, file-checkpointed runner
// that authors a managed project's DEMO.html (generate → review → lock). Unlike
// instructions (whose output lives in the session dir), the demo-builder agent
// writes DEMO.html into the PROJECT REPO under .forge/demo/ — so the file route
// serves from `project_repo_path`, not the session dir. The bridge spawns one
// CLI turn per operator action, via the shared
// `spawnAgentTurn(forgeRoot, 'demo-builder', project, sessionId)` — note the
// log-dir prefix stays `_demo-<sid>` (not `_demo-builder-<sid>`), matching
// the pre-collapse `spawnDemoBuilderTurn` exactly.

// R1-3b — the project-brain turn spawns via
// `spawnAgentTurn(forgeRoot, 'project-brain', project, sessionId)`.

/** R1-3b — list every project-brain session with its current state. */
function listProjectBrainSessions(projectsRoot: string): ProjectBrainStatus[] {
  const out: ProjectBrainStatus[] = [];
  if (!existsSync(projectsRoot)) return out;
  let projects: string[];
  try { projects = readdirSync(projectsRoot); } catch { return out; }
  for (const project of projects) {
    const base = join(projectsRoot, project, '_project-brain');
    if (!existsSync(base)) continue;
    let sids: string[];
    try { sids = readdirSync(base); } catch { continue; }
    for (const sid of sids) {
      // SEC-04 (AT-47) — resolve through the per-segment identity guard so a
      // symlinked `_project-brain` cannot fold this enumeration onto a victim
      // dir outside root.
      const dir = guardedSessionDir(projectsRoot, project, '_project-brain', sid);
      if (!dir) continue;
      // SEC-04 (bd forge-ebj) — status.json READ through the guarded leaf
      // sibling (leaf-symlink close; the dir guard did not cover the leaf).
      const status = guardedReadSessionStatus<ProjectBrainStatus>(projectsRoot, [project, '_project-brain', sid]);
      if (status) out.push(status);
    }
  }
  return out;
}

/** R1-3b — the staged theme files (name + content) for a session under review.
 *  SEC-04 (bd forge-ebj): the caller's `guardedSessionDir` contains the session
 *  DIRECTORY, but the `themes/` subdir and each `<name>.md` LEAF were then
 *  raw-appended and `readdir`/`readFileSync`'d — a symlinked `themes/` subdir
 *  (git-plantable inside a project repo) OR a symlinked theme leaf was followed
 *  out of root. Takes the TRUSTED `projectsRoot` plus the request-derived
 *  `dirSegments` (project / `_project-brain` / sessionId) as their OWN
 *  elements, and routes the `themes/` readdir + every leaf read through the
 *  per-segment identity guard (leaf included). */
function readStagedThemes(
  projectsRoot: string,
  dirSegments: readonly string[],
): Array<{ name: string; content: string }> {
  const themeSegs = [...dirSegments, 'themes'];
  const names = guardedReadDir(projectsRoot, themeSegs);
  if (names === null) return [];
  const out: Array<{ name: string; content: string }> = [];
  for (const name of names.filter((f) => f.endsWith('.md')).sort()) {
    const content = guardedReadFile(projectsRoot, [...themeSegs, name]);
    if (content !== null) out.push({ name, content });
  }
  return out;
}

/** Read the Forge demo base stylesheet (best-effort; a minimal dark fallback). */
function readForgeDemoCss(forgeRoot: string): string {
  try {
    return readFileSync(join(forgeRoot, 'studio', 'demo', 'forge-demo.css'), 'utf8');
  } catch {
    return 'body{background:#0a0e14;color:#e6edf3;font-family:system-ui,sans-serif;padding:2rem}';
  }
}

/** Wrap one element fragment in a self-contained, Forge-styled HTML doc so a single
 *  component renders as a styled slice of the full demo. */
function wrapDemoFragment(forgeRoot: string, element: string, fragment: string): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>demo · ${element}</title>`,
    `<style>${readForgeDemoCss(forgeRoot)}</style>`,
    '</head><body>',
    fragment,
    '</body></html>',
  ].join('\n');
}

/** Discover every demo-builder session under `projects/<name>/_demo/<sid>/`
 *  — used by the bridge's `GET /api/demo-builder/sessions`. Best-effort; never
 *  throws on a malformed dir. Mirrors `listInstructionsSessions`. */
function listDemoSessions(projectsRoot: string): DemoBuilderStatus[] {
  const out: DemoBuilderStatus[] = [];
  if (!existsSync(projectsRoot)) return out;
  let projects: string[];
  try { projects = readdirSync(projectsRoot); } catch { return out; }
  for (const project of projects) {
    const demoDir = join(projectsRoot, project, '_demo');
    if (!existsSync(demoDir)) continue;
    let sids: string[];
    try {
      sids = readdirSync(demoDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch { continue; }
    for (const sid of sids) {
      if (sid.startsWith('_')) continue; // skip _archived/
      // SEC-04 (AT-47) — resolve through the per-segment identity guard so a
      // symlinked `_demo` cannot fold this enumeration onto a victim dir
      // outside root.
      const dir = guardedSessionDir(projectsRoot, project, '_demo', sid);
      if (!dir) continue;
      // SEC-04 (bd forge-ebj) — status.json READ through the guarded leaf
      // sibling (leaf-symlink close; the dir guard did not cover the leaf).
      const status = guardedReadSessionStatus<DemoBuilderStatus>(projectsRoot, [project, '_demo', sid]);
      if (status) out.push(status);
    }
  }
  return out;
}

/**
 * R4-17 round-3 BLOCKER pin 5, item 1 — create the onboarding session's own
 * directory and write its two files (`status.json`, `prompt.md`), extracted
 * out of the `POST /api/studio/onboarding/start` route body into its own
 * EXPORTED function taking an EXPLICIT `sessionId`. Exists so the exclusive-
 * create defences below (closes 1 and 2) can be exercised directly against a
 * KNOWN id — once `newArchitectSessionId()` carries real entropy (close 3,
 * that function's own docstring), an external caller can no longer reliably
 * pre-plant a colliding directory to exercise closes 1/2 THROUGH the route
 * at all. The round-3 test file discloses exactly this: AT-13/14/15's
 * assertions stay true post-fix, but only vacuously, once the id is
 * unguessable — this export is the seam a follow-up unit test (owned by
 * whoever picks that up) would call directly with a fixed id instead.
 *
 * THREE independent closes (T2 ruling — a defence that only works because
 * another one also works is one defence, not two):
 *   1. `mkdirSync(sessionDir)` with NO `recursive` — a pre-existing entry at
 *      this exact path (a planted symlink OR a real, empty directory an
 *      attacker pre-staked) throws EEXIST rather than being silently reused.
 *   2. Both leaf writes use the exclusive create flag (`{flag:'wx'}`, i.e.
 *      `O_CREAT|O_EXCL`) — an existing path at the leaf, symlink included,
 *      fails the open() with EEXIST instead of following the symlink and
 *      writing through it.
 *   3. `newArchitectSessionId()` (the id this function's callers pass in)
 *      now carries real entropy — see its own docstring, above.
 *
 * `onboardingParent` MUST already be the caller's realpath-verified,
 * contained `_onboarding` directory (the route verifies this BEFORE calling
 * in) — this function does not re-derive that; it only guards the ONE new
 * segment (`sessionId`) joined onto it. Since `sessionId` is required to
 * match `SAFE_ID_RE` (no `/`, no `..`, no leading `.`) it is always a single
 * path segment, so `join(onboardingParent, sessionId)` cannot itself escape
 * `onboardingParent` — "validating a root does not validate what you write
 * beneath it" (this file's round-2 lesson, applied one level deeper again;
 * here the id is generated/validated rather than request-derived, so the
 * escape vector this closes is TOCTOU/guessing, not path injection).
 */
export function writeOnboardingSession(
  onboardingParent: string,
  sessionId: string,
  project: string,
  runId: string,
  inputs: Record<string, string>,
): { sessionDir: string } {
  if (!SAFE_ID_RE.test(sessionId)) {
    throw new Error(`invalid onboarding sessionId: ${JSON.stringify(sessionId)}`);
  }
  const sessionDir = join(onboardingParent, sessionId);
  // Close 1: exclusive directory CREATE. No `recursive` — a pre-existing
  // entry at this exact path is a hard EEXIST error, never silently reused.
  mkdirSync(sessionDir);
  writeFileSync(
    join(sessionDir, 'status.json'),
    JSON.stringify({ phase: 'running', project, runId, startedAt: new Date().toISOString() }, null, 2),
    { encoding: 'utf8', flag: 'wx' }, // close 2: exclusive create — never follows an existing symlink
  );
  // D8 — no fabricated interview: prompt.md renders the operator's own
  // inputs verbatim, exactly as project-brain's honestly-one-turn prompt
  // does; form field labels are never re-cast as agent questions.
  writeFileSync(join(sessionDir, 'prompt.md'), renderOnboardingPrompt(inputs), { encoding: 'utf8', flag: 'wx' });
  return { sessionDir };
}

/**
 * R4-21 (T3, BLOCKER-2 fix) — create the authoring session's own directory
 * and write its two files (`status.json`, `prompt.md`). Byte-for-byte the
 * SAME three independent closes as `writeOnboardingSession`, directly above
 * (exclusive dir create, exclusive leaf writes, a server-generated
 * `sessionId`) — see that function's own docstring for the full rationale;
 * not restated here. The only difference is the seed content: one free-text
 * `prompt` (the operator's initial description of the skill/hook to build)
 * instead of a multi-field `inputs` record, written verbatim — no fabricated
 * interview question, same D8 rationale `renderOnboardingPrompt` documents.
 *
 * R4-21 phase 2, WI-2: `prompt` is ALSO written INTO `status.json` (alongside
 * `phase`/`project`/`runId`/`startedAt`), not just into `prompt.md`. Verified
 * by reading `buildTurnPrompt` (`orchestrator/interactive-runner.ts`): the
 * generic spine composes its turn prompt from the SKILL.md + the phase row +
 * a JSON dump of `status.json` — it never reads `prompt.md`. Without this,
 * the operator's description of what to build is silently dropped and the
 * agent drafts from nothing. `prompt.md` is kept too — it stays the
 * operator-visible artifact the session's file-package/transcript pane reads.
 */
export function writeAuthoringSession(
  authoringParent: string,
  sessionId: string,
  project: string,
  runId: string,
  prompt: string,
  /** ADR-043 §3 amendment (wave-6 kickoff model-tier seam): already validated
   *  by the caller (`resolveKickoffModelTier` against the real creation-agent
   *  SKILL.md envelope) before this ever runs. Absent ⇒ unchanged default
   *  behavior — the key is omitted from status.json entirely, not written
   *  as `undefined`. */
  modelTier?: ModelTier,
): { sessionDir: string } {
  if (!SAFE_ID_RE.test(sessionId)) {
    throw new Error(`invalid authoring sessionId: ${JSON.stringify(sessionId)}`);
  }
  const sessionDir = join(authoringParent, sessionId);
  // Close 1: exclusive directory CREATE. No `recursive` — a pre-existing
  // entry at this exact path is a hard EEXIST error, never silently reused.
  mkdirSync(sessionDir);
  writeFileSync(
    join(sessionDir, 'status.json'),
    JSON.stringify(
      {
        phase: 'analyzing',
        project,
        runId,
        prompt,
        startedAt: new Date().toISOString(),
        ...(modelTier ? { modelTier } : {}),
      },
      null,
      2,
    ),
    { encoding: 'utf8', flag: 'wx' }, // close 2: exclusive create — never follows an existing symlink
  );
  writeFileSync(join(sessionDir, 'prompt.md'), `${prompt}\n`, { encoding: 'utf8', flag: 'wx' });
  return { sessionDir };
}

/** Returns true if the request was a demo-builder route (and was handled). */
async function handleDemoBuilder(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HttpContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);

  // GET /api/demo-builder/sessions — list every session with its current state.
  if (method === 'GET' && url === '/api/demo-builder/sessions') {
    const statuses = listDemoSessions(ctx.projectsRoot);
    // Live-tail each non-terminal session's log so the dedicated screen's hex
    // streams tool bursts (idempotent; no-ops if the log doesn't exist yet).
    for (const s of statuses) {
      if (!LEGACY_SESSION_TERMINAL_PHASES.demo.has(s.phase)) ctx.ensureSessionTail(SPAWN_AGENT_SPECS['demo-builder'].logPrefix, s.session_id);
    }
    // W8-A2 (ON-7 defect 1) — see the architect route's identical comment.
    // The registry id for this kind is 'demo' (SPAWN_AGENT_SPECS's own key
    // is 'demo-builder', but its logPrefix — and the session-kinds.yaml id —
    // is 'demo'; see the top-of-file note at collectStudioSessionIndexRows).
    const demoDescriptor = findSessionKindDescriptorSafe(ctx.forgeRoot, 'demo');
    const sessions = statuses.map((s) => {
      // SEC-04 (bd forge-ebj) — `s.project_repo_path` is UNTRUSTED at read time
      // (it is status.json content, git-plantable, not a routing input). These
      // probes existsSync/readdirSync THROUGH it: an out-of-root value was an
      // existence oracle AND the fragments readdir ENUMERATED (disclosed) an
      // out-of-root directory's filenames. Contain the value first
      // (isContainedProjectRepoPath — the same guard the serve routes apply),
      // THEN route each leaf through the per-segment identity guard (leaf
      // included) with that now-contained value as the root. A forged
      // out-of-root path yields no demoUrl/fragments (safe default), never a
      // disclosure. DEMO.html lives in the PROJECT REPO under .forge/demo/.
      const repoContained =
        typeof s.project_repo_path === 'string' &&
        isContainedProjectRepoPath(s.project_repo_path, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot });
      const demoUrl = repoContained && guardedFile(s.project_repo_path, DEMO_HTML_REL_PATH.split('/'), 'read') !== null
        ? `/api/demo-builder/demo/${encodeURIComponent(s.project)}/${encodeURIComponent(s.session_id)}`
        : null;
      // Per-element rendered fragments present in the repo (element ids) — so the
      // operator can view each part's output independently.
      const fragmentNames = repoContained ? guardedReadDir(s.project_repo_path, ['.forge', 'demo', 'fragments']) : null;
      const fragments: string[] = (fragmentNames ?? [])
        .filter((f) => f.endsWith('.html'))
        .map((f) => f.slice(0, -'.html'.length));

      // W8-A2 (ON-7 defect 1) — see the architect route: the derived lifecycle,
      // and `staleMs` from the runner's own heartbeat/`updated_at`, never the
      // status file's mtime. NOTE the on-disk log dir for this kind is
      // `_demo-<sid>`, not `_demo-builder-<sid>`.
      const rowLifecycle = demoDescriptor
        ? deriveRowLifecycle(ctx, demoDescriptor, s.phase, s.project, s.session_id).lifecycle
        : null;
      const staleMs = sessionStaleMs(ctx, 'demo', s.session_id, s.updated_at, rowLifecycle);

      return {
        sessionId: s.session_id,
        project: s.project,
        projectRepoPath: s.project_repo_path,
        phase: s.phase,
        mode: s.mode ?? 'create',
        targetElement: s.targetElement ?? null,
        iteration: s.iteration,
        prompt: s.prompt,
        demoUrl,
        fragments,
        hasLockedDemo: repoContained && guardedFile(s.project_repo_path, ['.forge', 'demo', 'demo.lock.json'], 'read') !== null,
        staleMs,
        ...(rowLifecycle ? { lifecycle: rowLifecycle } : {}),
      };
    });
    sendJson(res, 200, { sessions }, origin);
    return true;
  }

  // GET /api/demo-builder/demo/<project>/<sid> — serve the session's DEMO.html
  // from the PROJECT REPO (.forge/demo/DEMO.html), with a path-escape guard.
  // Reads status.json to resolve project_repo_path. (Unlike the instructions
  // /file route, the served file lives in the repo, NOT the session dir.)
  if (method === 'GET' && url.startsWith('/api/demo-builder/demo/')) {
    const rest = url.slice('/api/demo-builder/demo/'.length).split('/').map(decodeURIComponent);
    const [project, sessionId] = rest;
    if (!project || !sessionId) {
      sendJson(res, 400, { error: 'expected /api/demo-builder/demo/<project>/<sid>' }, origin);
      return true;
    }
    // SEC-03 WI-6, Half A — route through the SHIPPED choke point
    // (`resolveDemoSessionDir`, ~1477) instead of calling `demoSessionDir`
    // raw. `split('/')` above runs on the RAW url BEFORE `decodeURIComponent`,
    // so a %2F-smuggled ".." survives the split and only becomes a "/"
    // afterwards — invisible to the truthiness check that used to be the
    // only gate here. `resolveDemoSessionDir` validates `project`/`sessionId`
    // by charset (never reaching `join`) AND proves real realpath
    // containment inside THIS project's own resolved dir.
    const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, project, sessionId);
    if (!dirOutcome.ok) {
      sendJson(res, 400, { error: dirOutcome.reason }, origin);
      return true;
    }
    // SEC-04 (bd forge-ebj) — the status.json READ goes through the guarded
    // leaf sibling (leaf included) so a symlinked status leaf inside the
    // resolved-contained session dir is refused, not followed.
    const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, [project, '_demo', sessionId]);
    if (!status) {
      sendJson(res, 404, { error: 'session not found', project, sessionId }, origin);
      return true;
    }
    // SEC-03 WI-6, Half B — `status.project_repo_path` is untrusted at READ
    // time (status.json content, not routing input; a forged file on disk
    // reaches here exactly the way a forged session dir did for Half A). The
    // OLD check here built BOTH `base` and `requested` from this SAME
    // untrusted value, so `requested.startsWith(base)` was true BY
    // CONSTRUCTION for every possible value — a guard that cannot fail is
    // not a guard, so it is deleted here rather than kept as decoration.
    // Validate the value itself instead, with the SHIPPED
    // `isContainedProjectRepoPath` (cli/manifest-path-guard.ts) — the same
    // guard `invalidProjectRepoPath` (~1610) applies to `project_repo_path`
    // on every `/start` route. (`invalidProjectRepoPath` itself is not
    // reused directly: its `candidate === ''` early-return means "absent,
    // use the caller's default" — correct for a request body at WRITE time,
    // wrong here, where the field is mandatory and already persisted; a
    // forged empty string must be REJECTED, not silently treated as fine.)
    if (typeof status.project_repo_path !== 'string' || !isContainedProjectRepoPath(status.project_repo_path, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot })) {
      sendJson(res, 400, { error: 'session data invalid: project_repo_path is not a valid project directory' }, origin);
      return true;
    }
    // SEC-04 (bd forge-ebj) — project_repo_path is proven contained above, but
    // the DEMO.html LEAF beneath it could still be a symlink/hardlink out of
    // root; route the whole leaf path (fixed DEMO_HTML_REL_PATH segments under
    // the now-contained repo root) through the per-segment identity + nlink
    // guard so a symlinked DEMO.html is refused, not followed.
    const demoBody = guardedReadFile(status.project_repo_path, DEMO_HTML_REL_PATH.split('/'));
    if (demoBody === null) {
      sendJson(res, 404, { error: 'DEMO.html not found', project, sessionId }, origin);
      return true;
    }
    try {
      res.writeHead(200, servedFileHeaders('DEMO.html', origin));
      res.end(demoBody);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // GET /api/demo-builder/fragment/<project>/<sid>/<element> — serve one element's
  // rendered HTML fragment (<repo>/.forge/demo/fragments/<element>.html), so the
  // operator can view a single part's output independently. Path-escape guarded.
  if (method === 'GET' && url.startsWith('/api/demo-builder/fragment/')) {
    const rest = url.slice('/api/demo-builder/fragment/'.length).split('/').map(decodeURIComponent);
    const [project, sessionId, element] = rest;
    if (!project || !sessionId || !element) {
      sendJson(res, 400, { error: 'expected /api/demo-builder/fragment/<project>/<sid>/<element>' }, origin);
      return true;
    }
    // SEC-03 WI-6, Half A — see the /demo/ route above for the full
    // rationale; identical fix, same choke point.
    const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, project, sessionId);
    if (!dirOutcome.ok) {
      sendJson(res, 400, { error: dirOutcome.reason }, origin);
      return true;
    }
    // SEC-04 (bd forge-ebj) — status.json READ through the guarded leaf
    // sibling (leaf-symlink close).
    const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, [project, '_demo', sessionId]);
    if (!status) {
      sendJson(res, 404, { error: 'session not found', project, sessionId }, origin);
      return true;
    }
    // SEC-03 WI-6, Half B (symmetry) — this route's base/requested check
    // below is ALSO built from `status.project_repo_path` on both sides, so
    // it is exactly as tautological in `project_repo_path` as the /demo/
    // route's deleted check was — the AT-13 non-regression test measures
    // only that the `element` component (folded into `requested` alone,
    // fully `join()`-normalised) is already safe; it says nothing about
    // `project_repo_path` itself. Close the same hole here rather than leave
    // the twin route exposed. `element`'s own handling below is UNCHANGED.
    if (typeof status.project_repo_path !== 'string' || !isContainedProjectRepoPath(status.project_repo_path, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot })) {
      sendJson(res, 400, { error: 'session data invalid: project_repo_path is not a valid project directory' }, origin);
      return true;
    }
    // The lexical `startsWith(base)` still guards the `element` component's own
    // `..`/escape shape (AT-13 non-regression, 400). SEC-04 (bd forge-ebj)
    // additionally routes the actual READ through the per-segment identity +
    // nlink guard (project_repo_path is proven contained above ⇒ a trusted
    // root here), so a symlinked/hardlinked fragment LEAF inside the real
    // fragments dir is refused (⇒ null ⇒ 404), never followed out of root.
    const base = join(status.project_repo_path, '.forge', 'demo', 'fragments') + sep;
    const requested = join(status.project_repo_path, '.forge', 'demo', 'fragments', `${element}.html`);
    if (!requested.startsWith(base)) {
      sendJson(res, 400, { error: 'path escape rejected' }, origin);
      return true;
    }
    // A fragment is just the element's `<section>` slice. Wrap it in the Forge
    // demo base stylesheet so the component view is a styled slice of the full
    // demo (the composer inlines the same CSS into DEMO.html). If the fragment
    // is already a full HTML doc, serve it untouched.
    const raw = guardedReadFile(status.project_repo_path, ['.forge', 'demo', 'fragments', ...`${element}.html`.split('/')]);
    if (raw === null) {
      sendJson(res, 404, { error: 'fragment not found', project, sessionId, element }, origin);
      return true;
    }
    try {
      const isFullDoc = /^\s*<!doctype|^\s*<html[\s>]/i.test(raw);
      const out = isFullDoc ? raw : wrapDemoFragment(ctx.forgeRoot, element, raw);
      res.writeHead(200, servedFileHeaders(`${element}.html`, origin));
      res.end(out);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // GET /api/demo-builder/generation/<project>/<sid>/<n>/<filename> — serve
  // one R4-16 generation-snapshot file out of <sessionDir>/generations/<n>/.
  // ALL FOUR path segments are validated before any fs call: `project`/
  // `sessionId` go through `resolveDemoSessionDir` above — the ONE choke
  // point every demo-builder route (this GET route AND the five POST routes
  // below) resolves a session dir through, closing both the ".."-shaped
  // escape (pin 2, Finding A) AND a symlinked session dir whose NAME
  // legitimately passes SAFE_ID_RE (pin 3, Finding B); `n`/`filename`
  // against GENERATION_NUMBER_RE/GENERATION_FILENAME_RE, structurally
  // forbidding `..`, `/`, an absolute path, or a bare `.`/`..`. The final
  // read then goes through `safeReadFileInSession` (session-transcript.ts's
  // realpath choke point, D11) as belt-and-braces against a symlink escape
  // from WITHIN the already-validated session dir (e.g. one generation-
  // snapshot FILE symlinked out, rather than the session dir itself).
  //
  // The sibling /demo/ and /fragment/ GET routes above remain OUT OF SCOPE
  // for this round: they still validate `project`/`sessionId` for
  // non-emptiness only and rely solely on a lexical `startsWith(base)` check
  // on the resolved file path — a real gap, filed as an evidenced follow-up
  // rather than fixed here (a containment change for those two wants its own
  // attack round). Every demo-builder POST route (start/brief/feedback/lock/
  // abandon), by contrast, IS now covered — see their call sites below.
  const generationMatch = url.match(/^\/api\/demo-builder\/generation\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (method === 'GET' && generationMatch) {
    let project: string;
    let sessionId: string;
    let n: string;
    let filename: string;
    try {
      project = decodeURIComponent(generationMatch[1]);
      sessionId = decodeURIComponent(generationMatch[2]);
      n = decodeURIComponent(generationMatch[3]);
      filename = decodeURIComponent(generationMatch[4]);
    } catch {
      sendJson(res, 400, { error: 'invalid generation route — malformed URL encoding' }, origin);
      return true;
    }
    if (!GENERATION_NUMBER_RE.test(n)) {
      sendJson(res, 400, { error: `invalid generation number "${n}"` }, origin);
      return true;
    }
    if (!GENERATION_FILENAME_RE.test(filename)) {
      sendJson(res, 400, { error: `invalid filename "${filename}"` }, origin);
      return true;
    }
    const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, project, sessionId);
    if (!dirOutcome.ok) {
      sendJson(res, 400, { error: dirOutcome.reason }, origin);
      return true;
    }
    const fileBody = safeReadFileInSession(dirOutcome.dir, join(GENERATIONS_DIRNAME, n, filename));
    if (fileBody === null) {
      sendJson(res, 404, { error: 'generation snapshot file not found', project, sessionId, generation: n, filename }, origin);
      return true;
    }
    res.writeHead(200, servedFileHeaders(filename, origin));
    res.end(fileBody);
    return true;
  }

  // GET /api/demo-builder/history/<project> — list previously-locked demos
  // (snapshots under <repo>/.forge/demo/history/<id>/), newest first.
  const histListMatch = url.match(/^\/api\/demo-builder\/history\/([^/]+)$/);
  if (method === 'GET' && histListMatch) {
    const project = decodeURIComponent(histListMatch[1]);
    // SEC-04 (bd forge-ebj) — `project` was folded raw into
    // `join(projectsRoot, project, '.forge','demo','history')` and enumerated
    // with NO guard: a `%2F`-smuggled `../..` project enumerated an
    // out-of-root history tree, and an in-root project whose `.forge/demo/
    // history` is a git-plantable SYMLINK was followed out of root by
    // readdirSync. Gate the request-derived `project` (its OWN segment under
    // the trusted projectsRoot) first — a traversed/symlinked project is a 400
    // — then route the history readdir + each per-id leaf through the guard so
    // a symlinked history dir (or a symlinked id/leaf beneath it) is refused,
    // never followed. A legit project with no history yet reads as empty.
    const projGuard = resolveGuardedPath(ctx.projectsRoot, [project]);
    if (!projGuard.ok) {
      sendJson(res, 400, { error: 'invalid project' }, origin);
      return true;
    }
    const histSegs = [project, '.forge', 'demo', 'history'];
    const entries: Array<Record<string, unknown>> = [];
    const ids = guardedReadDir(ctx.projectsRoot, histSegs) ?? [];
    for (const id of ids) {
      if (guardedFile(ctx.projectsRoot, [...histSegs, id, 'DEMO.html'], 'read') === null) continue;
      const metaRaw = guardedReadFile(ctx.projectsRoot, [...histSegs, id, 'meta.json']);
      const meta = (metaRaw !== null ? safeParseJson<Record<string, unknown>>(metaRaw) : null) ?? {};
      entries.push({
        id,
        demoUrl: `/api/demo-builder/history/${encodeURIComponent(project)}/${encodeURIComponent(id)}`,
        lockedAt: typeof meta.locked_at === 'string' ? meta.locked_at : null,
        prompt: typeof meta.prompt === 'string' ? meta.prompt : '',
        iterations: typeof meta.iterations === 'number' ? meta.iterations : null,
      });
    }
    entries.sort((a, b) => String(b.lockedAt ?? '').localeCompare(String(a.lockedAt ?? '')));
    sendJson(res, 200, { history: entries }, origin);
    return true;
  }

  // GET /api/demo-builder/history/<project>/<id> — serve a snapshotted DEMO.html.
  const histServeMatch = url.match(/^\/api\/demo-builder\/history\/([^/]+)\/([^/]+)$/);
  if (method === 'GET' && histServeMatch) {
    const project = decodeURIComponent(histServeMatch[1]);
    const id = decodeURIComponent(histServeMatch[2]);
    // SEC-04 (bd forge-ebj) — the old `requested.startsWith(base)` was
    // self-defeating: `base` and `requested` were BOTH built from the same
    // untrusted `project`, so a `../..` traversal sat in BOTH sides and the
    // check was tautological; and a symlinked `.forge/demo/history` dir is
    // lexically inside `base` yet readFileSync followed it out of root. Route
    // the WHOLE path (project AND id each as their OWN segment under the
    // trusted projectsRoot, DEMO.html leaf included) through the per-segment
    // identity guard, which the lexical prefix check structurally cannot do. A
    // rejected/absent path both collapse to 404 (no existence oracle).
    const demoHtml = guardedReadFile(ctx.projectsRoot, [project, '.forge', 'demo', 'history', id, 'DEMO.html']);
    if (demoHtml === null) {
      sendJson(res, 404, { error: 'demo not found', project, id }, origin);
      return true;
    }
    try {
      res.writeHead(200, servedFileHeaders('DEMO.html', origin));
      res.end(demoHtml);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/demo-builder/start {project, mode?, projectRepoPath?} — create a
  // session in the `briefing` phase. It does NOT spawn the agent: the operator
  // lands on the screen, sees the demo process + any existing locked demo, and
  // provides notes; POST /api/demo-builder/brief then kicks off the agent.
  // R1-3b — project-brain builder ops (analyze → review → commit).
  if (method === 'GET' && url === '/api/project-brain/sessions') {
    const statuses = listProjectBrainSessions(ctx.projectsRoot);
    for (const s of statuses) {
      if (!LEGACY_SESSION_TERMINAL_PHASES['project-brain'].has(s.phase)) ctx.ensureSessionTail(SPAWN_AGENT_SPECS['project-brain'].logPrefix, s.session_id);
    }
    // W8-A2 (ON-7 defect 1) — this route served `statuses` VERBATIM, with no
    // lifecycle AND no staleness derivation of any kind (unlike the other
    // three bespoke list routes' now-collapsed heartbeat-or-updated_at
    // calc) — the worst of the four. Same seam as the other three.
    const projectBrainDescriptor = findSessionKindDescriptorSafe(ctx.forgeRoot, 'project-brain');
    const sessions = statuses.map((s) => {
      const rowLifecycle = projectBrainDescriptor
        ? deriveRowLifecycle(ctx, projectBrainDescriptor, s.phase, s.project, s.session_id).lifecycle
        : null;
      return {
        ...s,
        ...(rowLifecycle ? { lifecycle: rowLifecycle } : {}),
      };
    });
    sendJson(res, 200, { sessions }, origin);
    return true;
  }
  {
    const themesMatch = url.match(/^\/api\/project-brain\/themes\/([^/]+)\/([^/]+)$/);
    if (method === 'GET' && themesMatch) {
      // SEC-04 — the route regex captures `[^/]+` per segment, so a
      // `%2F`-smuggled `..` survives the real-slash boundary and only becomes a
      // `/` at decodeURIComponent time. DECODE FIRST, then guard the decoded
      // segments through the per-segment identity walk — an escaping
      // project/sessionId resolves to null and discloses no out-of-root theme.
      const project = decodeURIComponent(themesMatch[1]);
      const sessionId = decodeURIComponent(themesMatch[2]);
      const dir = guardedSessionDir(ctx.projectsRoot, project, '_project-brain', sessionId);
      if (!dir) {
        sendJson(res, 404, { error: 'session not found', project, sessionId }, origin);
        return true;
      }
      sendJson(res, 200, { themes: readStagedThemes(ctx.projectsRoot, [project, '_project-brain', sessionId]) }, origin);
      return true;
    }
  }
  if (method === 'POST' && url === '/api/project-brain/start') {
    try {
      const body = (await readJson(req)) as { project?: string; projectRepoPath?: string; modelTier?: unknown };
      if (!body.project) { sendJson(res, 400, { error: 'project is required' }, origin); return true; }
      // W7-B6 (sessions-kinds-02): roster check — no phantom project dirs.
      const unknownPbProject = unknownProjectReason(ctx, body.project);
      if (unknownPbProject !== null) {
        sendJson(res, 404, { error: unknownPbProject }, origin);
        return true;
      }
      // SEC-02 (forge-d1f) — reject BEFORE any mkdirSync/status write. See
      // invalidProjectRepoPath's header for the defect.
      const badRepoPath = invalidProjectRepoPath(body.projectRepoPath, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot });
      if (badRepoPath !== null) {
        sendJson(res, 400, { error: `projectRepoPath is not a valid project directory: ${badRepoPath}` }, origin);
        return true;
      }
      // ADR-043 §3 amendment (wave-6) — validated EARLY, against the real
      // project-brain-builder SKILL.md envelope.
      const modelTierResult = resolveKickoffModelTier('project-brain-builder', body.modelTier);
      if (!modelTierResult.ok) {
        sendJson(res, 400, { error: modelTierResult.error }, origin);
        return true;
      }
      const repoPath = body.projectRepoPath || join(ctx.projectsRoot, body.project);
      const sessionId = newArchitectSessionId();
      // SEC-04 — guard BEFORE the UNCONDITIONED mkdir+status write.
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_project-brain', sessionId);
      if (!dir) {
        sendJson(res, 400, { error: 'invalid project' }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — status.json WRITE through the guarded leaf sibling.
      if (guardedWriteSessionStatus<ProjectBrainStatus>(ctx.projectsRoot, [body.project, '_project-brain', sessionId], {
        session_id: sessionId, project: body.project, project_repo_path: repoPath,
        phase: 'briefing', prompt: '', updated_at: new Date().toISOString(),
        ...(modelTierResult.tier ? { modelTier: modelTierResult.tier } : {}),
      }) === null) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      ctx.broadcastProjectBrainChanged();
      sendJson(res, 200, { ok: true, sessionId }, origin);
    } catch (err) { sendJson(res, 500, { error: String(err) }, origin); }
    return true;
  }
  if (method === 'POST' && url === '/api/project-brain/brief') {
    try {
      const body = (await readJson(req)) as { project?: string; sessionId?: string; brief?: string };
      if (!body.project || !body.sessionId) { sendJson(res, 400, { error: 'project and sessionId are required' }, origin); return true; }
      // SEC-04 (bd forge-ebj) — guard the dir, and route each leaf (prompt.md,
      // status.json) through the guarded leaf siblings (leaf-symlink close).
      const dirSegs = [body.project, '_project-brain', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_project-brain', body.sessionId);
      if (!dir) { sendJson(res, 404, { error: 'session not found' }, origin); return true; }
      const status = guardedReadSessionStatus<ProjectBrainStatus>(ctx.projectsRoot, dirSegs);
      if (!status) { sendJson(res, 404, { error: 'session not found' }, origin); return true; }
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'prompt.md'], body.brief ?? '') === null ||
        guardedWriteSessionStatus<ProjectBrainStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'analyzing', prompt: body.brief ?? '' }) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      spawnAgentTurn(ctx.forgeRoot, 'project-brain', body.project, body.sessionId);
      ctx.broadcastProjectBrainChanged();
      sendJson(res, 200, { ok: true, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/project-brain/brief', body.sessionId) }, origin);
    } catch (err) { sendJson(res, 500, { error: String(err) }, origin); }
    return true;
  }
  if (method === 'POST' && (url === '/api/project-brain/approve' || url === '/api/project-brain/abandon')) {
    try {
      const approve = url.endsWith('/approve');
      const body = (await readJson(req)) as { project?: string; sessionId?: string };
      if (!body.project || !body.sessionId) { sendJson(res, 400, { error: 'project and sessionId are required' }, origin); return true; }
      // SEC-04 (bd forge-ebj) — guard the dir, and route status.json read+write
      // through the guarded leaf siblings (leaf-symlink close).
      const dirSegs = [body.project, '_project-brain', body.sessionId];
      const dir = guardedSessionDir(ctx.projectsRoot, body.project, '_project-brain', body.sessionId);
      if (!dir) { sendJson(res, 404, { error: 'session not found' }, origin); return true; }
      const status = guardedReadSessionStatus<ProjectBrainStatus>(ctx.projectsRoot, dirSegs);
      if (!status) { sendJson(res, 404, { error: 'session not found' }, origin); return true; }
      if (guardedWriteSessionStatus<ProjectBrainStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: approve ? 'committing' : 'abandoned' }) === null) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      if (approve) spawnAgentTurn(ctx.forgeRoot, 'project-brain', body.project, body.sessionId);
      ctx.broadcastProjectBrainChanged();
      // Only approve spawns — abandon is exempt-local and carries no marker.
      sendJson(res, 200, { ok: true, ...(approve ? dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/project-brain/approve', body.sessionId) : {}) }, origin);
    } catch (err) { sendJson(res, 500, { error: String(err) }, origin); }
    return true;
  }

  // POST /api/studio/onboarding/start {project, inputs?} — R4-17, the
  // onboarding session's kickoff route.
  //
  // D5 (BINDING — the headline finding this route's whole shape answers):
  // the campaign's recurring defect family is a route that accepts a
  // caller-supplied repo-path field and never re-validates it before using it
  // as a write/spawn target (SEC-02, SEC-03, the `/start`-family
  // `projectRepoPath` enumeration above `architectSessionDir`). This route's
  // answer is to have NO such field to guard at all — the body type below
  // pulls only `project`/`inputs`; an extra `projectRepoPath` (or anything
  // else) in the raw body is simply never read, so it is provably inert, not
  // merely undocumented (AT-3, cli/ui-bridge-onboarding-start.test.ts).
  //
  // `project` is validated (PROJECT_ID_RE + length cap, via the same
  // `invalidGenerationProjectReason` the demo-generation routes already use)
  // BEFORE any fs call, then resolved through the SAME
  // `resolveContainedProjectDir` (`cli/contract-stages.ts`) the sibling
  // `GET /api/studio/projects/:id/contract-stages` route already calls — by
  // IMPORT, not a second implementation (round-1 BLOCKER fix: this route
  // previously called bare `realpathSync` here, which resolves symlinks but
  // never checks the result lands inside `ctx.projectsRoot`, so a symlinked
  // project slug escaped containment entirely — see
  // `cli/ui-bridge-onboarding-start.test.ts` AT-7/AT-8 for the live-execution
  // reject/accept proof). `sessionId` is generated by THIS code
  // (`newArchitectSessionId`), never taken from the request, so the
  // `_onboarding/<sessionId>` join onto the now-verified real directory
  // cannot itself introduce a further escape.
  //
  // D6: spawns the IDENTICAL `spawnAgentDispatch(forgeRoot, 'onboarding-agent',
  // runId, project, inputs)` the generic `POST /api/agents/:slug/run` route
  // spawns, with `--session-dir` additionally threaded through (D7) so
  // `forge agent dispatch` can write the terminal phase into this session's
  // status.json when the run ends.
  if (method === 'POST' && url === '/api/studio/onboarding/start') {
    try {
      const body = (await readJson(req)) as { project?: unknown; inputs?: unknown };
      if (typeof body.project !== 'string') {
        sendJson(res, 400, { error: 'project is required' }, origin);
        return true;
      }
      const projectReason = invalidGenerationProjectReason(body.project);
      if (projectReason) {
        sendJson(res, 400, { error: projectReason }, origin);
        return true;
      }
      const project = body.project;

      const inputs: Record<string, string> = {};
      if (body.inputs !== undefined) {
        if (typeof body.inputs !== 'object' || body.inputs === null || Array.isArray(body.inputs)) {
          sendJson(res, 400, { error: 'inputs must be an object of string values' }, origin);
          return true;
        }
        for (const [k, v] of Object.entries(body.inputs as Record<string, unknown>)) {
          if (!SAFE_INPUT_KEY_RE.test(k)) {
            sendJson(res, 400, { error: `invalid input key: ${JSON.stringify(k)} (expected ${SAFE_INPUT_KEY_RE})` }, origin);
            return true;
          }
          if (typeof v !== 'string') {
            sendJson(res, 400, { error: `input "${k}" must be a string` }, origin);
            return true;
          }
          inputs[k] = v;
        }
      }

      const realProjectDir = resolveContainedProjectDir(ctx.projectsRoot, project);
      if (realProjectDir === null) {
        sendJson(res, 404, { error: `project not found: ${project}` }, origin);
        return true;
      }

      const sessionId = newArchitectSessionId();
      const runId = `_agent-onboarding-agent-${newRunStamp()}`;
      // `sessionId` is this code's own generated value (never request-
      // derived) and `_onboarding` is a fixed literal — joining it onto the
      // already realpath-verified `realProjectDir` cannot escape.
      // R4-17 round-2 BLOCKER: `resolveContainedProjectDir` proves the PROJECT
      // dir is contained — it says NOTHING about what is written beneath it.
      // `_onboarding` is a path segment inside a CHECKED-OUT REPO, so it is
      // attacker-supplied content: a commit carrying a symlink named
      // `_onboarding` redirects every write here, because
      // `mkdirSync(recursive:true)` transparently follows a symlinked
      // intermediate segment. Reproduced live before this guard existed —
      // `status.json` and `prompt.md` landed outside `projectsRoot` from a
      // project that passed containment. "Validating a root does not validate
      // what you write beneath it", one level deeper than the round-1 fix.
      //
      // The parent is therefore created and realpath-verified BEFORE the
      // session dir is created beneath it, and the session dir is verified in
      // turn — the same realpath + `startsWith(root + sep)` shape used
      // throughout, applied at every level that is written rather than only at
      // the root. A pre-existing REAL `_onboarding` directory (the second and
      // every later onboarding run) passes unchanged; only one whose realpath
      // leaves the verified project dir is refused.
      const onboardingParent = join(realProjectDir, '_onboarding');
      mkdirSync(onboardingParent, { recursive: true });
      const realOnboardingParent = realpathSync(onboardingParent);
      if (!realOnboardingParent.startsWith(realProjectDir + sep)) {
        sendJson(res, 400, { error: `onboarding session directory for project "${project}" resolves outside the project` }, origin);
        return true;
      }
      // R4-17 round-3 BLOCKER pin 5, item 1: the leaf writes below (session
      // dir + status.json + prompt.md) are guarded independently of the
      // realpath checks above — see writeOnboardingSession's own docstring
      // for the three closes (exclusive dir create, exclusive leaf writes,
      // sessionId entropy). A guessable, colliding sessionId directory could
      // otherwise be pre-planted with symlinked leaves that both writes
      // below would silently follow.
      const { sessionDir } = writeOnboardingSession(realOnboardingParent, sessionId, project, runId, inputs);

      // W7-B5 (agents-20/31 + projects-31): the SAME t0 `agent-run.dispatched`
      // marker the generic `POST /api/agents/:slug/run` host emits. This route
      // mints a runId on the SAME shared run identity space, so it must reach
      // the SAME state on the shared surfaces at t0 — without this event
      // `GET /api/agents/runs/<runId>` 404s here while the generic route's
      // runId already 200s (the AT-6 status-equivalence pin in
      // cli/ui-bridge-onboarding-start.test.ts is exactly that check), the
      // onboarding panel's first poll reads "no such run" for a run it just
      // started, and the drawer's `GET /api/events/<runId>` 404s at t0.
      // Guard symmetry with the generic host: the server-minted id is checked
      // before this, its FIRST write.
      if (!isSafeRunId(runId)) {
        throw new Error('refused to dispatch — unsafe server-minted run id');
      }
      createLogger(runId, ctx.logsRoot).emit({
        initiative_id: runId,
        phase: 'orchestrator',
        skill: 'onboarding-agent',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'agent-run.dispatched',
        metadata: { agent_slug: 'onboarding-agent', project },
      });
      // Bead forge-c6h: THIS is the route that actually produces a --session-dir,
      // so it is the one the projects-root snapshot has to reach. The session dir
      // was created under ctx.projectsRoot (resolved once at startBridge); handing
      // the same snapshot down means the subprocess's containment guard checks the
      // root the dir was created under, instead of re-deriving one from a config
      // file that may have changed inside this run's window.
      spawnAgentDispatch(ctx.forgeRoot, 'onboarding-agent', runId, project, inputs, sessionDir, undefined, ctx.projectsRoot);
      // R4-17 round-3 MAJOR pin 5, item 3: the dry-bridge classification row
      // for this route (cli/dry-bridge.ts) claims the agent dispatch is
      // "skipped with marker + event, exactly as the generic run host" — this
      // is the call that makes that claim true. spawnAgentDispatch already
      // no-ops under FORGE_DRY_BRIDGE=1 (and FORGE_ARCHITECT_NO_SPAWN=1); this
      // adds the explicit response marker + JSONL event the OTHER four
      // spawn-helper families already carry, so dry-bridge suppression is
      // never silent here either.
      sendJson(
        res, 200,
        { ok: true, sessionId, runId, project, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/studio/onboarding/start', sessionId) },
        origin,
      );
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // GET /api/studio/projects/:id/onboarding/active — W6-B14 reattach
  // discovery. `OnboardWithAgent` (forge-ui) only ever knew its dispatched
  // runId from its OWN component state — a nav-away (or reload) forgot it,
  // with no way back to a still-running server-side onboarding dispatch even
  // though the run's own `status.json` (written by `writeOnboardingSession`
  // above with `phase: 'running'`, then updated to a terminal phase by
  // `writeSessionTerminalPhase`, cli/agent-run.ts) already carries everything
  // needed to reattach. This is that tiny GET: find this project's most
  // recent `_onboarding/<sessionId>` (sessionId embeds a sortable
  // `newArchitectSessionId()` timestamp, above — a plain string sort picks
  // the latest) and report its own `runId`/`phase` — `sessionId: null` if
  // this project has never run onboarding. Read-only; no dispatch branch on
  // this URL, so nothing here can trigger a run (mirrors the ingest-activity
  // route's own GET-only contract, cli/bridge-studio-kbs.ts).
  if (method === 'GET' && url.startsWith('/api/studio/projects/') && url.endsWith('/onboarding/active')) {
    try {
      const project = decodeURIComponent(url.slice('/api/studio/projects/'.length, url.length - '/onboarding/active'.length));
      const projectReason = invalidGenerationProjectReason(project);
      if (projectReason) { sendJson(res, 400, { error: projectReason }, origin); return true; }
      const realProjectDir = resolveContainedProjectDir(ctx.projectsRoot, project);
      if (realProjectDir === null) { sendJson(res, 404, { error: `project not found: ${project}` }, origin); return true; }

      // SEC-04 — route the `_onboarding` LISTING itself through the shared
      // guard (`guardedReadDir`, same primitive `listInstructionsSessions`'s
      // per-session reads already use below): `realProjectDir` proves the
      // PROJECT dir is contained, but says nothing about a `_onboarding`
      // entry BENEATH it — a checked-out project repo is attacker-supplied
      // content, and a commit carrying a symlink named `_onboarding` would
      // otherwise redirect this enumeration outside `projectsRoot` (the
      // exact escape `writeOnboardingSession`'s own header above documents
      // for the WRITE side of this same directory).
      const sessionIds = (guardedReadDir(ctx.projectsRoot, [project, '_onboarding']) ?? [])
        .filter((name) => !name.startsWith('_'));
      if (sessionIds.length === 0) { sendJson(res, 200, { ok: true, sessionId: null, runId: null, phase: null }, origin); return true; }

      // "Most recent" is picked by each session's OWN `status.json.startedAt`
      // (millisecond-precision ISO, sorts correctly as a plain string), never
      // by sorting the sessionId strings themselves — `newArchitectSessionId()`
      // has only ONE-SECOND timestamp granularity plus a RANDOM (non-monotonic)
      // hex entropy suffix, so two sessions started within the same wall-clock
      // second (a real shape: an operator double-clicking, or two fast test
      // dispatches) sort in an ARBITRARY order by id alone.
      let latest: string | null = null;
      let latestStatus: { phase?: unknown; runId?: unknown; startedAt?: unknown } | null = null;
      let latestStartedAt = '';
      for (const sessionId of sessionIds) {
        const status = guardedReadSessionStatus<{ phase?: unknown; runId?: unknown; startedAt?: unknown }>(
          ctx.projectsRoot, [project, '_onboarding', sessionId],
        );
        const startedAt = typeof status?.startedAt === 'string' ? status.startedAt : '';
        if (latest === null || startedAt > latestStartedAt) {
          latest = sessionId;
          latestStatus = status;
          latestStartedAt = startedAt;
        }
      }
      if (!latest) { sendJson(res, 200, { ok: true, sessionId: null, runId: null, phase: null }, origin); return true; }

      sendJson(res, 200, {
        ok: true,
        sessionId: latest,
        runId: typeof latestStatus?.runId === 'string' ? latestStatus.runId : null,
        phase: typeof latestStatus?.phase === 'string' ? latestStatus.phase : null,
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // POST /api/studio/authoring/start {project, prompt} — R4-21, the
  // authoring session's kickoff route. Mirrors `POST /api/studio/onboarding/
  // start` EXACTLY: PROJECT_ID_RE + length-cap project validation via
  // `invalidGenerationProjectReason`, resolved through the SAME
  // `resolveContainedProjectDir`, a server-generated `sessionId` (never
  // request-derived), and the identical
  // mkdir-then-realpath-verify-the-parent-BEFORE-creating-the-session-dir
  // shape (see the onboarding route's own D5/D6 comments, directly above,
  // for the full security rationale — not restated here). `inputs` becomes
  // a single free-text `prompt` (creation-agent's session is seeded by one
  // operator description, not a multi-field form) written verbatim to
  // `prompt.md` AND into `status.json` — no fabricated interview question,
  // same D8 rationale as `renderOnboardingPrompt`.
  //
  // R4-21 phase 2, WI-2: the KNOWN GAP a prior round of this route disclosed
  // here — `spawnAgentDispatch` invoking the generic dispatch host, which
  // `resolveDispatchableAgent` refuses for `surface: interactive` defs like
  // `creation-agent` — is CLOSED. `spawnAgentTurn(forgeRoot, 'authoring',
  // project, sessionId)` below spawns `forge agent run authoring <sid>
  // --project <p>`, which reaches the generic `runInteractiveTurn` spine
  // (ADR-043 §3, `cli/agent-run.ts`'s `cmdAgentRun` dispatch fork) via the
  // `authoring` session-kind's `turnSpec` — the SAME bounded-turn shape
  // architect/instructions/demo-builder/project-brain already use, just
  // through the generic spine rather than a bespoke `*-runner.ts`.
  if (method === 'POST' && url === '/api/studio/authoring/start') {
    try {
      const body = (await readJson(req)) as { project?: unknown; prompt?: unknown; modelTier?: unknown };
      if (typeof body.project !== 'string') {
        sendJson(res, 400, { error: 'project is required' }, origin);
        return true;
      }
      const projectReason = invalidGenerationProjectReason(body.project);
      if (projectReason) {
        sendJson(res, 400, { error: projectReason }, origin);
        return true;
      }
      const project = body.project;

      if (typeof body.prompt !== 'string' || body.prompt.trim() === '') {
        sendJson(res, 400, { error: 'prompt is required and must be a non-empty string' }, origin);
        return true;
      }
      if (body.prompt.length > MAX_AUTHORING_PROMPT_LENGTH) {
        sendJson(res, 400, { error: `prompt exceeds the ${MAX_AUTHORING_PROMPT_LENGTH}-character cap` }, origin);
        return true;
      }
      const prompt = body.prompt;

      // ADR-043 §3 amendment (wave-6) — validated EARLY, against the real
      // creation-agent SKILL.md envelope.
      const modelTierResult = resolveKickoffModelTier('creation-agent', body.modelTier);
      if (!modelTierResult.ok) {
        sendJson(res, 400, { error: modelTierResult.error }, origin);
        return true;
      }

      const projectsRoot = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const realProjectDir = resolveContainedProjectDir(projectsRoot, project);
      if (realProjectDir === null) {
        sendJson(res, 404, { error: `project not found: ${project}` }, origin);
        return true;
      }

      const sessionId = newArchitectSessionId();
      const runId = `_agent-creation-agent-${newRunStamp()}`;
      // Same two-level containment shape as onboarding's start route: the
      // `_authoring` parent is created + realpath-verified BEFORE the
      // session dir is created beneath it (a project repo could carry a
      // committed symlink named `_authoring`, redirecting every write here —
      // "validating a root does not validate what you write beneath it").
      const authoringParent = join(realProjectDir, '_authoring');
      mkdirSync(authoringParent, { recursive: true });
      const realAuthoringParent = realpathSync(authoringParent);
      if (!realAuthoringParent.startsWith(realProjectDir + sep)) {
        sendJson(res, 400, { error: `authoring session directory for project "${project}" resolves outside the project` }, origin);
        return true;
      }
      writeAuthoringSession(realAuthoringParent, sessionId, project, runId, prompt, modelTierResult.tier);

      spawnAgentTurn(ctx.forgeRoot, 'authoring', project, sessionId);
      sendJson(
        res, 200,
        { ok: true, sessionId, runId, project, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/studio/authoring/start', sessionId) },
        origin,
      );
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // POST /api/studio/kbs/:id/cleanup/start — R4-19-F2, the kb-cleanup
  // session's kickoff route (ADR-043 §1/§3, brain-maintenance /
  // cleanup-plan). Mirrors `POST /api/studio/authoring/start` immediately
  // above where the shapes match: the KB id is validated with KB_ID_RE
  // BEFORE any fs call, a server-generated `sessionId` (never
  // request-derived), and `spawnAgentTurn` rides the SAME generic
  // `runInteractiveTurn` spine via the `kb-cleanup` SPAWN_AGENT_SPECS row
  // above.
  //
  // Session-dir anchor: mirrors the KB-create hand-off's own anchor rule
  // EXACTLY (cli/bridge-studio-kbs.ts ~:1189) — a project-bound KB anchors
  // its cleanup session under its OWN real, discovered project
  // (`binding.ref`); every OTHER binding kind (flow/band/unique) has no
  // natural project home, so it anchors under the dot-prefixed KB-seeding
  // anchor (`KB_SEEDING_ANCHOR_PREFIX + id`) instead — the SAME carve-out
  // that keeps `discoverProjects` from surfacing a phantom `projects/<id>/`
  // for a non-project KB (the MAJOR-2 defect that hand-off's own R1-06 WI-2
  // fix guards against).
  //
  // No `resolveContainedProjectDir`/mkdir-then-realpath-verify-parent shape
  // here (unlike authoring/start): `guardedWriteSessionStatus`
  // (orchestrator/interactive-session.ts) already realpath-guards the whole
  // `[sessionProject, '_kb-cleanup', sessionId, 'status.json']` path AND
  // creates the session dir (`mkdirSync(dirname(p), {recursive:true})`) as
  // part of the SAME guarded write — a project (or a fresh `.kb-<id>`
  // anchor) need not pre-exist, mirroring the KB-create hand-off's own
  // session write exactly.
  const kbCleanupStartMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/cleanup\/start$/);
  if (method === 'POST' && kbCleanupStartMatch) {
    try {
      const kbId = decodeURIComponent(kbCleanupStartMatch[1]);
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      const kb = loadKbDescriptors(ctx.forgeRoot).find((k) => k.id === kbId);
      if (!kb) {
        sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
        return true;
      }

      // W7-B2 (knowledge-05): a cleanup plan drafted against a KB a drain/
      // consolidate is actively mutating is stale on arrival — refuse with
      // the same reason the action group shows.
      const kbActiveJob = deriveKbActiveJob(ctx.forgeRoot, kbId);
      if (kbActiveJob) {
        sendJson(res, 409, { error: activeJobReason(kbActiveJob), runId: kbActiveJob.runId }, origin);
        return true;
      }

      // ADR-043 §3 amendment (wave-6) — validated EARLY, against the real
      // brain-maintenance SKILL.md envelope (the kb-cleanup session's agent —
      // see studio/session-kinds.yaml's `kb-cleanup` row).
      const body = (await readJson(req)) as { modelTier?: unknown };
      const modelTierResult = resolveKickoffModelTier('brain-maintenance', body.modelTier);
      if (!modelTierResult.ok) {
        sendJson(res, 400, { error: modelTierResult.error }, origin);
        return true;
      }

      const sessionProject = kb.binding.kind === 'project' ? kb.binding.ref : `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
      const sessionId = newArchitectSessionId();

      // A LIVE, KB-scoped brain-lint pass — the honest per-KB scoping
      // buildKbHealth uses (cli/bridge-studio-kbs.ts's
      // computeAgentCleanupFindings), never a fabricated/hardcoded []. This
      // IS the turn input the agent reads as read-only context
      // (orchestrator/interactive-runner.ts's `buildTurnPrompt` inlines the
      // whole status object) — it is NOT the cleanup-plan artifact's source
      // of truth: the artifact re-derives live from a FRESH scan at read
      // time (derive-don't-store, orchestrator/studio/session-transcript.ts's
      // `deriveCleanupPlan`). Never "optimise" the renderer into reading
      // this stored copy back — a resolved finding after this snapshot
      // would then never show as cleared.
      const findings = computeAgentCleanupFindings(ctx.forgeRoot, kbId);

      const projectsRoot = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));

      // W8-B3 (ON-5) — the operator's request, recorded as the session's
      // opening turn. Written through the SAME guarded leaf sibling as
      // status.json below, so a symlinked `prompt.md` planted inside a real
      // session dir is refused rather than followed (`guardedWriteFile`
      // creates the parent dir itself, so it does not need status.json to
      // have run first).
      //
      // ORDER IS LOAD-BEARING, and this is the second write on a path that
      // used to have exactly one: `status.json` is what makes a session dir a
      // SESSION. `readGuardedSessionIndexSummary` returns null without it and
      // `collectStudioSessionIndexRows` skips the row; the shell route 404s.
      // So the existence marker goes LAST, and any failure here leaves a
      // directory that no surface can see — rather than a live-looking
      // session at phase `drafting` with an empty record and no agent ever
      // spawned, which is unrecoverable except by hand. This needs no
      // rollback and adds no unguarded fs sink.
      if (guardedWriteFile(
        projectsRoot,
        [sessionProject, '_kb-cleanup', sessionId, 'prompt.md'],
        renderKbCleanupPrompt(kbId, kb.binding, findings.length),
      ) === null) {
        sendJson(res, 500, { error: `kb-cleanup start: session prompt.md for kb "${kbId}" failed containment` }, origin);
        return true;
      }

      const written = guardedWriteSessionStatus(
        projectsRoot,
        [sessionProject, '_kb-cleanup', sessionId],
        {
          session_id: sessionId,
          project: sessionProject,
          phase: 'drafting',
          kb_id: kbId,
          kb_binding: kb.binding,
          findings,
          ...(modelTierResult.tier ? { modelTier: modelTierResult.tier } : {}),
        },
      );
      if (written === null) {
        sendJson(res, 500, { error: `kb-cleanup start: hand-off session status.json for kb "${kbId}" failed containment` }, origin);
        return true;
      }

      spawnAgentTurn(ctx.forgeRoot, 'kb-cleanup', sessionProject, sessionId);
      sendJson(
        res, 200,
        { ok: true, sessionId, project: sessionProject, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/studio/kbs/:id/cleanup/start', sessionId) },
        origin,
      );
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // R4-16 round 2 (pin 3, Finding A) — every route below resolves its
  // session dir through `resolveDemoSessionDir`, the ONE choke point (see
  // its own header comment, above the GET generation route). Each rejects
  // with a 400 naming the offending value BEFORE any read, write,
  // `mkdirSync`, or spawn.
  if (method === 'POST' && url === '/api/demo-builder/start') {
    try {
      const body = (await readJson(req)) as { project?: string; mode?: 'create' | 'update'; projectRepoPath?: string; targetElement?: string; modelTier?: unknown };
      if (!body.project) {
        sendJson(res, 400, { error: 'project is required' }, origin);
        return true;
      }
      // W7-B6 (sessions-kinds-02): roster check — no phantom project dirs.
      const unknownDemoProject = unknownProjectReason(ctx, body.project);
      if (unknownDemoProject !== null) {
        sendJson(res, 404, { error: unknownDemoProject }, origin);
        return true;
      }
      // SEC-02 (forge-d1f) — reject BEFORE any mkdirSync/existsSync-through
      // read/status write. See invalidProjectRepoPath's header for the defect.
      const badRepoPath = invalidProjectRepoPath(body.projectRepoPath, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot });
      if (badRepoPath !== null) {
        sendJson(res, 400, { error: `projectRepoPath is not a valid project directory: ${badRepoPath}` }, origin);
        return true;
      }
      // ADR-043 §3 amendment (wave-6) — validated EARLY, against the real
      // demo-builder SKILL.md envelope.
      const modelTierResult = resolveKickoffModelTier('demo-builder', body.modelTier);
      if (!modelTierResult.ok) {
        sendJson(res, 400, { error: modelTierResult.error }, origin);
        return true;
      }
      // The CREATE case — `dirOutcome.dir` does not exist on disk yet;
      // `resolveDemoSessionDir` proves its closest EXISTING ancestor is
      // contained (see its header) rather than false-rejecting a brand new
      // session.
      const sessionId = newArchitectSessionId();
      const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, body.project, sessionId);
      if (!dirOutcome.ok) {
        sendJson(res, 400, { error: dirOutcome.reason }, origin);
        return true;
      }
      // dirOutcome.ok proved the DIR contained; the status.json WRITE below
      // goes through the guarded leaf sibling (leaf included).
      // forge-4vt — the `projectRepoPath || join(projectsRoot, project)`
      // fallback below reaches the demo.lock.json READ a few lines down with a
      // repoPath folded from the untrusted `body.project`. `resolveDemoSessionDir`
      // above DOES reject an out-of-root project today, but that containment is
      // an accident of SOURCE ORDER — it guards the session DIR, not this
      // independently re-derived repoPath, so a refactor that reorders or drops
      // it would silently reopen the read. Route `body.project` through the
      // SAME resolveGuardedPath choke point the sibling /start routes use,
      // BEFORE the read, so containment is structural (the guard's own output)
      // rather than order-dependent.
      let repoPath: string;
      if (body.projectRepoPath) {
        repoPath = body.projectRepoPath;
      } else {
        const guardedProject = resolveGuardedPath(ctx.projectsRoot, [body.project]);
        if (!guardedProject.ok) {
          sendJson(res, 400, { error: 'invalid project' }, origin);
          return true;
        }
        repoPath = guardedProject.realPath;
      }
      // Default the mode by whether a locked demo already exists.
      const mode: 'create' | 'update' =
        body.mode ?? (existsSync(join(repoPath, '.forge', 'demo', 'demo.lock.json')) ? 'update' : 'create');
      // SEC-04 (bd forge-ebj) — status.json WRITE through the guarded leaf
      // sibling (leaf included; mkdirs the parent, refuses a symlinked leaf).
      if (guardedWriteSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, [body.project, '_demo', sessionId], {
        session_id: sessionId,
        project: body.project,
        project_repo_path: repoPath,
        phase: 'briefing',
        mode,
        // Optional per-element iteration target (a demo-element kind id).
        ...(typeof body.targetElement === 'string' && body.targetElement ? { targetElement: body.targetElement } : {}),
        iteration: 1,
        prompt: '',
        updated_at: new Date().toISOString(),
        ...(modelTierResult.tier ? { modelTier: modelTierResult.tier } : {}),
      }) === null) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      ctx.broadcastDemoChanged();
      sendJson(res, 200, { ok: true, sessionId, mode }, origin);
    } catch (err) {
      // sanitizeError, not String(err) — the same helper 13 sibling routes in
      // this file already use. A genuine fs error on the status write (EACCES,
      // ENOSPC) otherwise echoes an absolute filesystem path into the response.
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // POST /api/demo-builder/brief {project, sessionId, brief} — record the
  // operator's look-and-feel / change-notes and kick off the agent
  // (briefing → generating).
  if (method === 'POST' && url === '/api/demo-builder/brief') {
    try {
      const body = (await readJson(req)) as { project?: string; sessionId?: string; brief?: string; targetElement?: string };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      if (!dirOutcome.ok) {
        sendJson(res, 400, { error: dirOutcome.reason }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — dirOutcome.ok above proved the DIR contained;
      // route each leaf (prompt.md, status.json) through the guarded leaf
      // siblings so the leaf itself is contained too (leaf-symlink close).
      const dirSegs = [body.project, '_demo', body.sessionId];
      const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const brief = body.brief ?? '';
      // `targetElement` narrows the turn to one demo element (per-element iteration);
      // omit/empty to compose the full demo.
      const targetElement = typeof body.targetElement === 'string' && body.targetElement ? body.targetElement : status.targetElement;
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'prompt.md'], brief) === null ||
        guardedWriteSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs, {
          ...status, phase: 'generating', iteration: 1, prompt: brief,
          ...(targetElement ? { targetElement } : {}),
        }) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      spawnAgentTurn(ctx.forgeRoot, 'demo-builder', body.project, body.sessionId);
      ctx.broadcastDemoChanged();
      sendJson(res, 200, { ok: true, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/demo-builder/brief', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/demo-builder/feedback {project, sessionId, feedback} — record the
  // operator's feedback + re-generate (iteration + 1).
  if (method === 'POST' && url === '/api/demo-builder/feedback') {
    try {
      const body = (await readJson(req)) as { project?: string; sessionId?: string; feedback?: string };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      if (!dirOutcome.ok) {
        sendJson(res, 400, { error: dirOutcome.reason }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — route each leaf (feedback.md, status.json)
      // through the guarded leaf siblings (leaf-symlink close).
      const dirSegs = [body.project, '_demo', body.sessionId];
      const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'feedback.md'], body.feedback ?? '') === null ||
        guardedWriteSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'generating', iteration: status.iteration + 1 }) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      spawnAgentTurn(ctx.forgeRoot, 'demo-builder', body.project, body.sessionId);
      ctx.broadcastDemoChanged();
      sendJson(res, 200, { ok: true, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/demo-builder/feedback', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/demo-builder/lock {project, sessionId, generation?} — lock the
  // current demo in. R4-16: an optional `generation` names which snapshot to
  // lock — structurally validated (integer ≥ 1) BEFORE any write, so a
  // rejected request never mutates status.json.
  if (method === 'POST' && url === '/api/demo-builder/lock') {
    try {
      const body = (await readJson(req)) as { project?: string; sessionId?: string; generation?: unknown };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      if (!dirOutcome.ok) {
        sendJson(res, 400, { error: dirOutcome.reason }, origin);
        return true;
      }
      const hasGeneration = Object.prototype.hasOwnProperty.call(body, 'generation') && body.generation !== undefined;
      if (hasGeneration && !(typeof body.generation === 'number' && Number.isInteger(body.generation) && body.generation >= 1)) {
        sendJson(res, 400, { error: `generation must be an integer >= 1, got ${JSON.stringify(body.generation)}` }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — status.json read+write through the guarded leaf
      // siblings (leaf-symlink close).
      const dirSegs = [body.project, '_demo', body.sessionId];
      const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      if (guardedWriteSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs, {
        ...status,
        phase: 'locking',
        ...(hasGeneration ? { selectedGeneration: body.generation as number } : {}),
      }) === null) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      spawnAgentTurn(ctx.forgeRoot, 'demo-builder', body.project, body.sessionId);
      ctx.broadcastDemoChanged();
      sendJson(res, 200, { ok: true, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/demo-builder/lock', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/demo-builder/abandon {project, sessionId} — abandon the session.
  if (method === 'POST' && url === '/api/demo-builder/abandon') {
    try {
      const body = (await readJson(req)) as { project?: string; sessionId?: string };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      if (!dirOutcome.ok) {
        sendJson(res, 400, { error: dirOutcome.reason }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — status.json read+write through the guarded leaf
      // siblings (leaf-symlink close).
      const dirSegs = [body.project, '_demo', body.sessionId];
      const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      if (guardedWriteSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'abandoned' }) === null) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      spawnAgentTurn(ctx.forgeRoot, 'demo-builder', body.project, body.sessionId);
      ctx.broadcastDemoChanged();
      sendJson(res, 200, { ok: true, ...dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/demo-builder/abandon', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  return false;
}

// ---- Reflection routes (the third human moment, in-UI) --------------------
//
// The reflector emits `_logs/<cycleId>/user-questions.json` (StructuredQuestion[])
// as its Stage-2 file handoff; the operator's answers land in
// `user-feedback.md`. The /reflect/<cycleId> page renders the questions and
// POSTs the answers here — converting the old reflect slash command into
// an in-UI page, consistent with the in-UI architect + review moments.
async function handleReflect(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HttpContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);

  if (method === 'GET' && url.startsWith('/api/reflect/') && !url.endsWith('/answer')) {
    const cycleId = decodeURIComponent(url.slice('/api/reflect/'.length));
    if (!cycleId) { sendJson(res, 400, { error: 'expected /api/reflect/<cycleId>' }, origin); return true; }
    // SEC-04 (bd forge-ebj) — cycleId was folded raw into `join(logsRoot,
    // cycleId)` and each leaf raw-appended: a `%2F`-smuggled `../..` cycleId
    // disclosed an out-of-root user-questions.json, and a symlinked leaf inside
    // a real cycle dir was followed. Gate the request-derived cycleId (its OWN
    // segment under the trusted logsRoot) through the per-segment identity
    // guard first — a traversed/symlinked cycle dir is a 400 with NO read —
    // then route every leaf read through the guard too (leaf-symlink close).
    const reflectCycleGuard = resolveGuardedPath(ctx.logsRoot, [cycleId]);
    if (!reflectCycleGuard.ok) {
      sendJson(res, 400, { error: 'invalid cycleId' }, origin);
      return true;
    }
    const questionsRaw = guardedReadFile(ctx.logsRoot, [cycleId, 'user-questions.json']);
    const questions = questionsRaw !== null ? (safeParseJson<unknown[]>(questionsRaw) ?? []) : [];
    const answered = guardedFile(ctx.logsRoot, [cycleId, 'user-feedback.md'], 'read') !== null;
    // R4-09-F3: the durable reflect mode (REFLECT_MODE_FILE) — the authoritative
    // signal the UI uses to render the automated read-only view, independent of
    // per-question inferred-marker compliance.
    const modeRaw = guardedReadFile(ctx.logsRoot, [cycleId, 'reflect-mode.json']);
    const modeDoc = modeRaw !== null ? safeParseJson<{ mode?: string }>(modeRaw) : null;
    const mode = modeDoc?.mode === 'automated' ? 'automated' : modeDoc?.mode === 'interactive' ? 'interactive' : undefined;
    sendJson(res, 200, { cycleId, questions, answered, ...(mode ? { mode } : {}) }, origin);
    return true;
  }

  if (method === 'POST' && url.startsWith('/api/reflect/') && url.endsWith('/answer')) {
    // R5-01-F1 (task A-finalfix FIX 1): reflect-answer is `stub-actions`, not
    // `refuse` — it does two things, writing user-feedback.md (bookkeeping)
    // and detached-firing rerunReflector (the real agent turn). Only the
    // latter is dry-bridge-gated below; the write always proceeds so the
    // route's normal 200 stays truthful ("feedback captured").
    const cycleId = decodeURIComponent(url.slice('/api/reflect/'.length, url.length - '/answer'.length));
    try {
      const body = (await readJson(req)) as { answers?: { question: string; answer: string }[]; freeform?: string };
      // SEC-04 (bd forge-ebj) — the WRITE twin of the reflect GET read. cycleId
      // was folded raw into `join(logsRoot, cycleId)` and `user-feedback.md`
      // raw-appended: a `%2F`-smuggled `../..` cycleId overwrote an out-of-root
      // user-feedback.md, and a symlinked leaf was followed. Gate the cycleId
      // (its OWN segment under the trusted logsRoot) first — reject a
      // traversed/symlinked dir (400, no write) and keep the "cycle not found"
      // 404 for a genuinely absent in-root cycle.
      const dirGuard = resolveGuardedPath(ctx.logsRoot, [cycleId]);
      if (!dirGuard.ok) { sendJson(res, 400, { error: 'invalid cycleId', cycleId }, origin); return true; }
      if (!dirGuard.exists) { sendJson(res, 404, { error: 'cycle not found', cycleId }, origin); return true; }
      const dir = dirGuard.realPath;
      const lines = [`# Reflection feedback — ${cycleId}`, '', '## Answers to numbered questions', ''];
      for (const a of body.answers ?? []) {
        lines.push(`### ${a.question}`, '', a.answer || '_(skipped)_', '');
      }
      lines.push('## Free-form feedback', '', (body.freeform ?? '').trim() || '_(none)_', '');
      // Route the leaf through the guard too: a symlinked user-feedback.md
      // inside the (now identity-verified) real cycle dir is refused, never
      // followed out of root. A rejected leaf writes NOTHING (fail closed).
      if (guardedWriteFile(ctx.logsRoot, [cycleId, 'user-feedback.md'], lines.join('\n')) === null) {
        sendJson(res, 400, { error: 'invalid cycle path', cycleId }, origin);
        return true;
      }
      const dryMarker = dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/reflect/:cycleId/answer', cycleId);
      sendJson(res, 200, { ok: true, ...dryMarker }, origin);
      if (!isDryBridge()) {
        // D — auto-rerun the reflector so the feedback is distilled into retro.md +
        // brain themes. Detached (don't block the HTTP response on a full reflector
        // pass), but observable: success AND failure emit an event into the cycle's
        // events.jsonl (not console), so a lost rerun is visible and the startup
        // reconcile can recover it. The UI owns reflection without the CLI.
        const reflectLogger = createLogger(cycleId, ctx.logsRoot);
        ctx
          .rerunReflector({ cycleId, logsRoot: ctx.logsRoot, queueRoot: ctx.queueRoot })
          .then(() =>
            reflectLogger.emit({
              initiative_id: cycleId,
              phase: 'reflection',
              skill: 'bridge',
              event_type: 'log',
              input_refs: [join(dir, 'user-feedback.md')],
              output_refs: [],
              message: 'bridge.reflect-rerun-fired',
              metadata: { trigger: 'feedback-submit' },
            }),
          )
          .catch((err) =>
            reflectLogger.emit({
              initiative_id: cycleId,
              phase: 'reflection',
              skill: 'bridge',
              event_type: 'log',
              input_refs: [],
              output_refs: [],
              message: 'bridge.reflect-rerun-failed',
              metadata: { error: String(err) },
            }),
          );
      }
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  return false;
}

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, rejectJson) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        rejectJson(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolveJson(raw ? JSON.parse(raw) : {}); } catch (err) { rejectJson(err); }
    });
    req.on('error', rejectJson);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Tail mechanics --------------------------------------------------------

function pumpTail(state: TailState, emit: (event: EventLogEntry) => void): void {
  try {
    const size = statSync(state.filePath).size;
    if (size <= state.offset) return;
    const chunk = readPartial(state.filePath, state.offset, size);
    state.offset = size;
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      try { emit(JSON.parse(line) as EventLogEntry); } catch { /* skip malformed */ }
    }
  } catch { /* file rotated / removed */ }
}

function readPartial(filePath: string, from: number, to: number): string {
  const length = to - from;
  if (length <= 0) return '';
  const buffer = Buffer.alloc(length);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buffer, 0, length, from);
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8');
}
