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

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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
import { dirname, join, relative, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import { getPaths, listInFlight } from '../orchestrator/queue.ts';
import { parseManifest } from '../orchestrator/manifest.ts';
import { enqueueDevelopRun } from '../orchestrator/enqueue-develop-run.ts';
import { enqueuePlanRun } from '../orchestrator/enqueue-plan-run.ts';
import {
  readReviewComments,
  writeReviewComments,
  appendReviewComment,
  resolveComment,
  deriveVerdictFromComments,
  reviewCommentsPath,
  isSafeCycleId,
  REVIEW_COMMENTS_MAX,
} from '../orchestrator/review-comments.ts';
import lockfile from 'proper-lockfile';
import {
  handleStudioRoutes,
  handleStudioWriteRoutes,
  sanitizeError,
  sendJson,
  allowedOrigin,
  CSRF_HEADER,
  SAFE_ID_RE,
} from './bridge-studio.ts';
import { SLUG_RE } from '../orchestrator/studio/validate.ts';
import { handleStudioKbRoutes } from './bridge-studio-kbs.ts';
import { handleStudioSkillsRoutes } from './bridge-studio-skills.ts';
import { handleStudioHooksRoutes } from './bridge-studio-hooks.ts';
import { handleStudioTemplatesRoutes } from './bridge-studio-templates.ts';
import { handleStudioSessionsRoutes } from './bridge-studio-sessions.ts';
import { handleStudioInstructionsRoutes } from './bridge-studio-instructions.ts';
import { handleStudioConnectionsRoutes } from './bridge-studio-connections.ts';
import { handleStudioCommunityRoutes } from './bridge-studio-community.ts';
import { handleRecoveryRoutes } from './bridge-recovery.ts';
import { handleHookRoutes } from './bridge-hooks.ts';
import {
  handleStudioPostRoutes,
  applyReviewVerdict,
  applyPlanVerdict,
  type StudioPostContext,
  type ReleaseFinalizeHookInput,
} from './bridge-studio-runs.ts';
import { runReleaseFinalize } from '../orchestrator/phases/release-finalize.ts';
import { isDryBridge, refuseDryBridge, emitDryBridgeRefusal, dryBridgeAgentTurnMarker } from './dry-bridge.ts';
import { parseWorkItem } from '../orchestrator/work-item.ts';
import { daemonState, setPaused, readPid, isAlive, clearPidFile, daemonPaths, spawnServeDetached } from '../orchestrator/daemon.ts';
import { mergePullRequest } from '../orchestrator/pr.ts';
import type { BridgeIdentity } from './forge-watch.ts';
import { finalizeMergedReadyForReview } from '../orchestrator/finalize-merged.ts';
import { createLogger, type EventLogEntry } from '../orchestrator/logging.ts';
import { reconcileReflectFeedback, type RerunReflectorFn } from './reflect-reconcile.ts';
import {
  listArchitectSessions,
  readStatus,
  writeStatus,
  type ArchitectStatus,
  type ArchitectQuestion,
} from '../orchestrator/architect-runner.ts';
import {
  instructionsSessionDir,
  DRAFT_FILENAME,
  type InstructionsStatus,
} from '../orchestrator/instructions-runner.ts';
import {
  demoSessionDir,
  DEMO_HTML_REL_PATH,
  GENERATIONS_DIRNAME,
  type DemoBuilderStatus,
} from '../orchestrator/demo-builder-runner.ts';
import { safeReadFileInSession } from '../orchestrator/studio/session-transcript.ts';
import { resolveContainedProjectDir } from './contract-stages.ts';
import {
  projectBrainSessionDir,
  type ProjectBrainStatus,
} from '../orchestrator/project-brain-builder-runner.ts';
import { isSafeRunId } from '../orchestrator/run-agent.ts';
import { resolveDispatchableAgent } from '../orchestrator/agent-dispatch.ts';
import { listAgentDefinitions } from '../orchestrator/studio/registry.ts';
import {
  agentAcceptsMaterial,
  materialKindForFilename,
  MAX_MATERIALS_COUNT,
  MAX_MATERIAL_BYTES,
  MAX_MATERIALS_TOTAL_BYTES,
} from '../orchestrator/studio/materials.ts';
import { stageMaterials, MaterialsStagingError } from './materials-staging.ts';
import type { AgentDefinition } from '../orchestrator/studio/types.ts';
import { skillsDir, MAX_SKILL_ID_LENGTH } from '../orchestrator/skill-path.ts';
import { unreadyConnectionsFor, formatUnreadyConnections } from '../orchestrator/studio/connection-run-gate.ts';
import {
  readSessionStatus,
  writeSessionStatus,
  type InterviewQuestion,
} from '../orchestrator/interactive-session.ts';
import { readAgentInstructionsFile } from '../orchestrator/project-config.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir, MAX_KICKOFF_COST_CEILING_USD } from '../orchestrator/config.ts';
import { isContainedProjectRepoPath } from './manifest-path-guard.ts';

const TAIL_POLL_MS = 200;
const RECENT_CYCLES_MAX = 20;
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
   * orchestrator/forge-reflect-rerun.ts. Fired (non-blocking) when operator
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
    ((input) => import('../orchestrator/forge-reflect-rerun.ts').then((m) => m.rerunReflector(input)));
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
    const filePath = join(logsRoot, cycleId, 'events.jsonl');
    if (!existsSync(filePath)) return;
    const state: TailState = { cycleId, filePath, offset: 0 };
    state.timer = setInterval(() => pumpTail(state, (event) => broadcast({ type: 'event', cycleId, event })), TAIL_POLL_MS);
    tails.set(cycleId, state);
  };

  // Tail only LIVE cycles (in-flight / ready-for-review), and only while at
  // least one browser is connected: a terminal cycle's log is immutable and
  // served on demand via /api/events, and with no client there is nobody to
  // stream to. This drops the idle cost from ~RECENT_CYCLES_MAX statSync polls
  // every TAIL_POLL_MS to zero when no UI is open, and to just the live set
  // otherwise. (Architect-session tails are driven separately by
  // ensureArchitectTail when the architect screen is open.)
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
      // ADR 020 — live-tail an architect session's event log so its tool_use
      // bursts stream to the dedicated screen's hex. The runner writes to
      // `_logs/_architect-<sid>/events.jsonl`; ensureTailFor no-ops if absent.
      ensureArchitectTail: (sessionId: string) => ensureTailFor(`_architect-${sessionId}`),
      broadcastInstructionsChanged: () => broadcast({ type: 'instructions-list-changed' }),
      // Stage A — live-tail an instructions session's event log. The runner
      // writes to `_logs/_instructions-<sid>/events.jsonl`; ensureTailFor no-ops if absent.
      ensureInstructionsTail: (sessionId: string) => ensureTailFor(`_instructions-${sessionId}`),
      broadcastDemoChanged: () => broadcast({ type: 'demo-list-changed' }),
      // Stage B — live-tail a demo-builder session's event log. The runner
      // writes to `_logs/_demo-<sid>/events.jsonl`; ensureTailFor no-ops if absent.
      ensureDemoTail: (sessionId: string) => ensureTailFor(`_demo-${sessionId}`),
      broadcastProjectBrainChanged: () => broadcast({ type: 'project-brain-list-changed' }),
      ensureProjectBrainTail: (sessionId: string) => ensureTailFor(`_project-brain-${sessionId}`),
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
  /** Start (idempotently) live-tailing an architect session's event log so its
   *  tool_use bursts stream to the dedicated screen. */
  ensureArchitectTail: (sessionId: string) => void;
  /** Broadcast an `instructions-list-changed` WS message (fsWatch may miss
   *  same-tick writes; the routes call this after they mutate session state). */
  broadcastInstructionsChanged: () => void;
  /** Start (idempotently) live-tailing an instructions session's event log. */
  ensureInstructionsTail: (sessionId: string) => void;
  /** Broadcast a `demo-list-changed` WS message (fsWatch may miss same-tick
   *  writes; the routes call this after they mutate session state). */
  broadcastDemoChanged: () => void;
  /** Start (idempotently) live-tailing a demo-builder session's event log. */
  ensureDemoTail: (sessionId: string) => void;
  /** R1-3b — broadcast a `project-brain-list-changed` WS message. */
  broadcastProjectBrainChanged: () => void;
  /** R1-3b — live-tail a project-brain session's event log. */
  ensureProjectBrainTail: (sessionId: string) => void;
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
 *  else stays `text/plain`. */
function contentTypeFor(filename: string): string {
  return filename.toLowerCase().endsWith('.html')
    ? 'text/html; charset=utf-8'
    : 'text/plain; charset=utf-8';
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
    const filePath = join(ctx.logsRoot, cycleId, 'events.jsonl');
    if (!existsSync(filePath)) {
      sendJson(res, 404, { error: 'no events.jsonl for cycle', cycleId }, origin);
      return;
    }
    try {
      const raw = readFileSync(filePath, 'utf8');
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
    try {
      const { summariseCycle } = await import('./metrics.ts');
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
    const snapshotPath = join(ctx.logsRoot, cycleId, 'work-items-snapshot', '_graph.md');
    const initiativeId = (cycleId.match(/_(INIT-.+)$/) ?? [, cycleId])[1] as string;
    const livePath = join(ctx.forgeRoot, '_worktrees', initiativeId, '.forge', 'work-items', '_graph.md');
    const filePath = existsSync(snapshotPath) ? snapshotPath : existsSync(livePath) ? livePath : null;
    if (!filePath) {
      sendJson(res, 404, { error: 'no _graph.md for cycle', cycleId }, origin);
      return;
    }
    try {
      const raw = readFileSync(filePath, 'utf8');
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
    if (!cycleId || !wiId || !/^WI-\d+$/.test(wiId)) {
      sendJson(res, 400, { error: 'cycleId and a WI-<n> wiId are required' }, origin);
      return;
    }
    const snapshotPath = join(ctx.logsRoot, cycleId, 'work-items-snapshot', `${wiId}.md`);
    const initiativeId = (cycleId.match(/_(INIT-.+)$/) ?? [, cycleId])[1] as string;
    const livePath = join(ctx.forgeRoot, '_worktrees', initiativeId, '.forge', 'work-items', `${wiId}.md`);
    const found = existsSync(snapshotPath) ? snapshotPath : existsSync(livePath) ? livePath : null;
    if (!found) {
      sendJson(res, 404, { error: 'work item not found in snapshot or live worktree', cycleId, wiId }, origin);
      return;
    }
    try {
      const w = parseWorkItem(readFileSync(found, 'utf8'));
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
    const requested = join(ctx.logsRoot, cycleId, 'artifacts', filename);
    const safeBase = join(ctx.logsRoot, cycleId, 'artifacts') + sep;
    if (!requested.startsWith(safeBase)) {
      sendJson(res, 400, { error: 'path escape rejected' }, origin);
      return;
    }
    if (!existsSync(requested)) {
      sendJson(res, 404, { error: 'artifact not found', cycleId, filename }, origin);
      return;
    }
    try {
      const body = readFileSync(requested, 'utf8');
      res.writeHead(200, {
        'content-type': contentTypeFor(filename),
        'access-control-allow-origin': origin,
        'vary': 'origin',
      });
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
  if (await handleStudioRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioWriteRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioKbRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioSkillsRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioHooksRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioTemplatesRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioSessionsRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioInstructionsRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
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
      const result = spawnServeDetached(ctx.forgeRoot);
      if (result === null) {
        const state = daemonState(ctx.forgeRoot, ctx.queueRoot);
        sendJson(res, 200, { ok: true, alreadyRunning: true, state }, origin);
        return;
      }
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
  // `running:false` once it's down.
  if (method === 'POST' && url === '/api/scheduler/stop') {
    if (isDryBridge()) {
      refuseDryBridge(res, origin, { route: '/api/scheduler/stop', method, action: 'daemon', logsRoot: ctx.logsRoot });
      return;
    }
    try {
      const pid = readPid(daemonPaths(ctx.forgeRoot).pidFile);
      if (pid === null || !isAlive(pid)) {
        clearPidFile(ctx.forgeRoot);
        sendJson(res, 200, { ok: true, alreadyStopped: true, state: daemonState(ctx.forgeRoot, ctx.queueRoot) }, origin);
        return;
      }
      process.kill(pid, 'SIGTERM');
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
      const results = initiativeIds.map((initiativeId) => {
        // Per-item isolation: a throw on one item must not 500 away the
        // results of items whose side effects already applied.
        try {
          const result = enqueueDevelopRun(initiativeId, { queueRoot: ctx.queueRoot });
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
  if (method === 'GET' && url.startsWith('/api/agents/runs/')) {
    const runId = decodeURIComponent(url.slice('/api/agents/runs/'.length));
    if (!isSafeRunId(runId)) {
      sendJson(res, 400, { error: `invalid runId: ${JSON.stringify(runId)}` }, origin);
      return;
    }
    const eventsPath = join(ctx.logsRoot, runId, 'events.jsonl');
    if (!existsSync(eventsPath)) {
      // Dispatched but no event yet (or spawn suppressed with no log dir).
      sendJson(res, 200, { ok: true, state: 'running', costUsd: 0, events: 0 }, origin);
      return;
    }
    try {
      const parsed = readFileSync(eventsPath, 'utf8')
        .trim().split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
        .filter((e): e is Record<string, unknown> => e !== null);
      const suppressed = parsed.some((e) => e['message'] === 'run-agent.spawn-suppressed');
      // `runAgent` emits `end` only on success; a crashed dispatch writes a
      // terminal 'agent-dispatch.failed' marker (cli/agent-run.ts) instead —
      // without it the run would read 'running' forever and the RunPanel would
      // poll a dead run indefinitely.
      const failed = parsed.some((e) => e['message'] === 'agent-dispatch.failed');
      const endEvent = parsed.find((e) => e['event_type'] === 'end');
      // R6-04 (WI-2): a ceiling-stop (SDK `result_subtype:
      // 'error_max_budget_usd'`, recorded into the end event's metadata by
      // runAgent) must be a DISTINCT terminal state, never collapsed into an
      // ordinary successful 'done' — a budget-stopped run reported as a
      // clean success is the exact defect this pins.
      const endMetadata = endEvent?.['metadata'] as Record<string, unknown> | undefined;
      const ceilingStopped = endMetadata?.['result_subtype'] === 'error_max_budget_usd';
      const state = failed ? 'failed' : suppressed ? 'suppressed' : ceilingStopped ? 'budget-exceeded' : endEvent ? 'done' : 'running';
      const costUsd = typeof endEvent?.['cost_usd'] === 'number' ? (endEvent['cost_usd'] as number) : 0;
      sendJson(res, 200, { ok: true, state, costUsd, events: parsed.length }, origin);
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
        if (!existsSync(join(ctx.projectsRoot, body.project))) {
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
      // R6-04 WI-2 — the per-kickoff cost ceiling. Fail-closed: non-number,
      // NaN/non-finite, <= 0, or above MAX_KICKOFF_COST_CEILING_USD all 400
      // BEFORE runId is minted / spawnAgentDispatch is ever called — no run
      // is spawned on a refused ceiling. Exactly-at-the-max is accepted
      // (inclusive boundary); one unit over is refused.
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
          return;
        }
        costCeilingUsd = v;
        // R6-04 WI-2, round 7 (T1 ruling) — a ceiling that cannot be
        // enforced must be REFUSED, never silently accepted. Only agents
        // declaring `runtime.loopStrategy: 'one-shot'` are enforceable
        // (options.maxBudgetUsd, orchestrator/run-agent.ts's
        // runOneShotSpawn) — the legacy invocation path (no loopStrategy
        // declared; 14 of 19 real dispatchable roster agents) has no budget
        // concept at all, so an accepted ceiling there would be validated,
        // recorded, and shown in the UI while doing nothing. This mirrors
        // the SAME guard `runAgent` itself enforces (defense-in-depth: this
        // route is not the only entry point — `forge agent dispatch
        // --cost-ceiling-usd` never passes through it).
        if (def.runtime.loopStrategy !== 'one-shot') {
          sendJson(
            res,
            400,
            {
              error:
                `costCeilingUsd: ceiling not enforceable for this agent's loop strategy ` +
                `(agent "${slug}" declares ${JSON.stringify(def.runtime.loopStrategy)} — an operator ` +
                `cost ceiling can only be enforced for loopStrategy: 'one-shot')`,
            },
            origin,
          );
          return;
        }
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
        // Still applying `isSafeRunId` defensively before the mkdir below,
        // mirroring the SAME check this file already runs on this SAME
        // value at its other two sites (spawnAgentDispatch ~line 1789,
        // the run-status route ~line 1118) — guard-symmetry, so a future
        // change to `newRunStamp()`/the slug regex can't quietly turn this
        // THIRD site into the one that skips it. A server-minted id
        // failing its own safety check is a server anomaly, not a client
        // mistake, so it's raised as MaterialsStagingError -> the route's
        // existing 500 path, never a 400.
        if (!isSafeRunId(runId)) {
          throw new MaterialsStagingError('materials: refused to stage — unsafe run id');
        }
        // This is the run's FIRST artifact: under FORGE_DRY_BRIDGE,
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
      spawnAgentDispatch(ctx.forgeRoot, slug, runId, project, inputs, undefined, costCeilingUsd);
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
    try {
      const result = enqueuePlanRun(initiativeId, { queueRoot: ctx.queueRoot });
      const httpStatus =
        result.status === 'enqueued' ? 200 :
        result.status === 'not-found' ? 404 :
        result.status === 'already-running' ? 409 :
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

/** The 4 detached-runner turn families the bridge spawns — each `verb` maps
 *  1:1 to `orchestrator/cli.ts <verb> run <sid> --project <project>`, and
 *  `logPrefix` names the `_logs/_<logPrefix>-<sid>/` capture dir. `demo-builder`
 *  is the one case where the two diverge (verb `demo-builder`, log prefix
 *  `demo`) — preserved exactly from the pre-collapse per-agent functions. */
type SpawnableAgentId = 'architect' | 'instructions' | 'demo-builder' | 'project-brain';

const SPAWN_AGENT_SPECS: Record<SpawnableAgentId, { verb: string; logPrefix: string }> = {
  architect: { verb: 'architect', logPrefix: 'architect' },
  instructions: { verb: 'instructions', logPrefix: 'instructions' },
  'demo-builder': { verb: 'demo-builder', logPrefix: 'demo' },
  'project-brain': { verb: 'project-brain', logPrefix: 'project-brain' },
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
function spawnAgentTurn(forgeRoot: string, agentId: SpawnableAgentId, project: string, sessionId: string): void {
  if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge()) return;
  if (!isSafeRunId(sessionId)) {
    console.error(`spawnAgentTurn: unsafe sessionId (path-traversal risk), refusing to spawn: ${JSON.stringify(sessionId)}`);
    return;
  }
  const { verb, logPrefix } = SPAWN_AGENT_SPECS[agentId];
  try {
    const logDir = join(forgeRoot, '_logs', `_${logPrefix}-${sessionId}`);
    mkdirSync(logDir, { recursive: true });
    const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
    const proc = spawn(
      process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', verb, 'run', sessionId, '--project', project],
      { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] },
    );
    closeSync(stderrFd);
    proc.unref();
  } catch { /* best-effort */ }
}

/** Studio agent slug shape (skill dir names): lowercase alnum + hyphen, no
 *  leading hyphen (so a flag-shaped slug can't reach a detached spawn even from
 *  a future caller that skips roster resolution). The TRUE injection guard is
 *  `resolveDispatchableAgent` rejecting non-roster slugs + argv-array/no-shell
 *  spawn semantics; this regex is defense-in-depth, not the sole barrier. */
const SAFE_AGENT_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
/** Project dir name: real projects carry uppercase / `_` (e.g. `trafficGame`,
 *  `terraform-provider-betterado`), so this is broader than a slug — but still
 *  no `.`/`/` (traversal) and no leading `-` (flag shape). */
const SAFE_PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
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
 *  generation-serve route below are validated with the EXACT SLUG_RE/
 *  SAFE_ID_RE + length-cap contract `cli/bridge-studio-sessions.ts` already
 *  applies to its own session routes (imported, not re-declared): length cap
 *  THEN charset, BEFORE any fs call. Without this, `demoSessionDir(join(
 *  projectsRoot, project), sessionId)` — a plain `path.join`, no containment
 *  of its own — walks an attacker-chosen `project`/`sessionId` (e.g. ".." /
 *  "../OUTSIDE") straight out of `projectsRoot` before `safeReadFileInSession`
 *  ever runs; that choke point only proves containment relative to whatever
 *  `sessionDir` it is handed, so an escaping caller-supplied dir defeats it
 *  entirely (reproduced live: AT-36). */
const MAX_GENERATION_PROJECT_LENGTH = MAX_SKILL_ID_LENGTH;
const MAX_GENERATION_SESSION_ID_LENGTH = MAX_SKILL_ID_LENGTH;

function invalidGenerationProjectReason(id: string): string | null {
  if (id.length > MAX_GENERATION_PROJECT_LENGTH) {
    return `invalid project "${id.slice(0, 40)}…" — ${id.length} characters exceeds the ${MAX_GENERATION_PROJECT_LENGTH}-character length limit`;
  }
  if (!SLUG_RE.test(id)) {
    return `invalid project "${id}" — must match ${SLUG_RE} (a single lowercase-kebab slug; no "/", "\\", ".", or "..")`;
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
 *     charset, BEFORE any fs call) with the exact SLUG_RE/SAFE_ID_RE
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

  const projectDir = join(projectsRoot, project);
  let realProjectDir: string;
  try {
    realProjectDir = realpathSync(projectDir);
  } catch {
    return { ok: false, reason: `project "${project}" was not found under the projects root` };
  }

  // The candidate session dir may not exist yet (the CREATE case) — walk up
  // to the closest EXISTING ancestor and prove THAT is contained, per the
  // header note above.
  const candidate = demoSessionDir(projectDir, sessionId);
  let ancestor = candidate;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      return { ok: false, reason: `session dir for project "${project}", sessionId "${sessionId}" could not be resolved` };
    }
    ancestor = parent;
  }
  let realAncestor: string;
  try {
    realAncestor = realpathSync(ancestor);
  } catch {
    return { ok: false, reason: `session dir for project "${project}", sessionId "${sessionId}" could not be resolved` };
  }
  if (realAncestor !== realProjectDir && !realAncestor.startsWith(realProjectDir + sep)) {
    return { ok: false, reason: `sessionId "${sessionId}" for project "${project}" resolves outside the project directory` };
  }

  // Splice any not-yet-existing tail segments (plain literal names — see
  // header note) back onto the resolved ancestor, so a fresh `/start` gets a
  // real, fully-resolved dir it can `mkdirSync` under.
  const tail = relative(ancestor, candidate);
  return { ok: true, dir: tail === '' ? realAncestor : join(realAncestor, tail) };
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
): string[] {
  const args = [slug, '--run-id', runId];
  if (project) args.push('--project', project);
  for (const [k, v] of Object.entries(inputs ?? {})) {
    if (!SAFE_INPUT_KEY_RE.test(k)) continue;
    args.push('--input', `${k}=${v}`);
  }
  if (sessionDir) args.push('--session-dir', sessionDir);
  if (costCeilingUsd !== undefined) args.push('--cost-ceiling-usd', String(costCeilingUsd));
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
): void {
  // Argv construction is pure (no I/O, no side effects) — safe to build
  // above the spawn-suppression early-return below, so it stays observable
  // as ordinary function composition rather than something only a real spawn
  // attempt could exercise.
  const dispatchArgs = buildAgentDispatchArgs(slug, runId, project, inputs, sessionDir, costCeilingUsd);
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
  } catch { /* best-effort */ }
}

function architectSessionDir(projectsRoot: string, project: string, sessionId: string): string {
  return join(projectsRoot, project, '_architect', sessionId);
}

/** R4-17, D8 — renders the operator's own onboarding-start `inputs` verbatim
 *  as `prompt.md`'s body. No fabricated interview: form field labels are
 *  never re-cast as agent questions, mirroring the honest single-turn shape
 *  project-brain's `prompt.md` already has. */
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

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return null; }
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
      if (s.phase !== 'committed' && s.phase !== 'rejected') ctx.ensureArchitectTail(s.session_id);
    }
    const sessions = statuses.map((s) => {
      const dir = architectSessionDir(ctx.projectsRoot, s.project, s.session_id);
      const questions =
        s.phase === 'awaiting-answers'
          ? readJsonFile<ArchitectQuestion[]>(join(dir, 'questions.json'))
          : null;
      const planUrl = existsSync(join(dir, 'PLAN.html'))
        ? `/api/architect/file/${encodeURIComponent(s.project)}/${encodeURIComponent(s.session_id)}/PLAN.html`
        : null;

      // staleMs: ms since the last sign of life — heartbeat mtime if present,
      // else the status.json updated_at timestamp.
      const heartbeatPath = join(ctx.logsRoot, `_architect-${s.session_id}`, '.heartbeat');
      let staleMs: number;
      if (existsSync(heartbeatPath)) {
        staleMs = Date.now() - statSync(heartbeatPath).mtimeMs;
      } else {
        const parsedAt = Date.parse(s.updated_at);
        staleMs = Date.now() - (isNaN(parsedAt) ? 0 : parsedAt);
      }

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
        completenessCritic: s.completenessCritic ?? null,
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
    const base = architectSessionDir(ctx.projectsRoot, project, sessionId) + sep;
    const requested = join(architectSessionDir(ctx.projectsRoot, project, sessionId), filename);
    if (!requested.startsWith(base)) {
      sendJson(res, 400, { error: 'path escape rejected' }, origin);
      return true;
    }
    if (!existsSync(requested)) {
      sendJson(res, 404, { error: 'file not found', project, sessionId, filename }, origin);
      return true;
    }
    try {
      res.writeHead(200, {
        'content-type': contentTypeFor(filename),
        'access-control-allow-origin': origin,
        'vary': 'origin',
      });
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
      const body = (await readJson(req)) as { project?: string; idea?: string; projectRepoPath?: string };
      if (!body.project || !body.idea) {
        sendJson(res, 400, { error: 'project and idea are required' }, origin);
        return true;
      }
      // SEC-02 (forge-d1f) — reject BEFORE any mkdirSync/writeFileSync/status
      // write. See invalidProjectRepoPath's header for the defect.
      const badRepoPath = invalidProjectRepoPath(body.projectRepoPath, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot });
      if (badRepoPath !== null) {
        sendJson(res, 400, { error: `projectRepoPath is not a valid project directory: ${badRepoPath}` }, origin);
        return true;
      }
      const sessionId = newArchitectSessionId();
      const dir = architectSessionDir(ctx.projectsRoot, body.project, sessionId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'idea.md'), body.idea);
      const status: ArchitectStatus = {
        session_id: sessionId,
        project: body.project,
        project_repo_path: body.projectRepoPath || join(ctx.projectsRoot, body.project),
        phase: 'interviewing',
        round: 1,
        idea: body.idea,
        updated_at: new Date().toISOString(),
      };
      writeStatus(dir, status);
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
      const dir = architectSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      // R4-04 review finding: guard + serialize like applyPlanVerdict — the
      // interview→exploring→drafting turn is longer now, and an answer
      // landing mid-turn would yank a live session back to 'interviewing'
      // (a stray double-submit could previously do the same). The lock
      // serializes against the runner's own status writes; the phase guard
      // 409s anything that isn't actually waiting for answers.
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
        const status = readStatus(dir);
        if (!status) {
          sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
          return true;
        }
        if (status.phase !== 'awaiting-answers') {
          sendJson(res, 409, { error: `session is not awaiting answers (phase: ${status.phase})` }, origin);
          return true;
        }
        const answersPath = join(dir, 'answers.json');
        const prior = readJsonFile<{ round: number; answers: unknown[] }[]>(answersPath) ?? [];
        round = prior.length + 1;
        writeFileSync(answersPath, JSON.stringify([...prior, { round, answers: body.answers }], null, 2));
        writeStatus(dir, { ...status, phase: 'interviewing', round: round + 1 });
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
      const dir = architectSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      const status = readStatus(dir);
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
      const status = readSessionStatus<InstructionsStatus>(instructionsSessionDir(join(projectsRoot, project), sid));
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
      if (s.phase !== 'committed' && s.phase !== 'rejected') ctx.ensureInstructionsTail(s.session_id);
    }
    const sessions = statuses.map((s) => {
      const dir = instructionsSessionDir(join(ctx.projectsRoot, s.project), s.session_id);
      const questions =
        s.phase === 'awaiting-answers'
          ? readJsonFile<InterviewQuestion[]>(join(dir, 'questions.json'))
          : null;
      const draftUrl = existsSync(join(dir, DRAFT_FILENAME))
        ? `/api/instructions/file/${encodeURIComponent(s.project)}/${encodeURIComponent(s.session_id)}/${encodeURIComponent(DRAFT_FILENAME)}`
        : null;

      // staleMs: ms since the last sign of life — heartbeat mtime if present,
      // else the status.json updated_at timestamp.
      const heartbeatPath = join(ctx.logsRoot, `_instructions-${s.session_id}`, '.heartbeat');
      let staleMs: number;
      if (existsSync(heartbeatPath)) {
        staleMs = Date.now() - statSync(heartbeatPath).mtimeMs;
      } else {
        const parsedAt = Date.parse(s.updated_at);
        staleMs = Date.now() - (isNaN(parsedAt) ? 0 : parsedAt);
      }

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
    const base = instructionsSessionDir(join(ctx.projectsRoot, project), sessionId) + sep;
    const requested = join(instructionsSessionDir(join(ctx.projectsRoot, project), sessionId), filename);
    if (!requested.startsWith(base)) {
      sendJson(res, 400, { error: 'path escape rejected' }, origin);
      return true;
    }
    if (!existsSync(requested)) {
      sendJson(res, 404, { error: 'file not found', project, sessionId, filename }, origin);
      return true;
    }
    try {
      res.writeHead(200, {
        'content-type': contentTypeFor(filename),
        'access-control-allow-origin': origin,
        'vary': 'origin',
      });
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
      const body = (await readJson(req)) as { project?: string; mode?: 'init' | 'edit'; projectRepoPath?: string };
      if (!body.project) {
        sendJson(res, 400, { error: 'project is required' }, origin);
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
      const repoPath = body.projectRepoPath || join(ctx.projectsRoot, body.project);
      // Default the mode by whether an agent-instruction file already exists.
      const mode: 'init' | 'edit' =
        body.mode ?? (readAgentInstructionsFile(repoPath) ? 'edit' : 'init');
      const sessionId = newArchitectSessionId();
      const dir = instructionsSessionDir(join(ctx.projectsRoot, body.project), sessionId);
      mkdirSync(dir, { recursive: true });
      writeSessionStatus<InstructionsStatus>(dir, {
        session_id: sessionId,
        project: body.project,
        project_repo_path: repoPath,
        phase: 'briefing',
        mode,
        round: 1,
        prompt: '',
        updated_at: new Date().toISOString(),
      });
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
      const dir = instructionsSessionDir(join(ctx.projectsRoot, body.project), body.sessionId);
      const status = readSessionStatus<InstructionsStatus>(dir);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const brief = body.brief ?? '';
      writeFileSync(join(dir, 'prompt.md'), brief);
      writeSessionStatus<InstructionsStatus>(dir, { ...status, phase: 'interviewing', round: 1, prompt: brief });
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
      const dir = instructionsSessionDir(join(ctx.projectsRoot, body.project), body.sessionId);
      const status = readSessionStatus<InstructionsStatus>(dir);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const answersPath = join(dir, 'answers.json');
      const prior = readJsonFile<{ round: number; answers: unknown[] }[]>(answersPath) ?? [];
      const round = prior.length + 1;
      writeFileSync(answersPath, JSON.stringify([...prior, { round, answers: body.answers }], null, 2));
      writeSessionStatus<InstructionsStatus>(dir, { ...status, phase: 'interviewing', round: round + 1 });
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
      const dir = instructionsSessionDir(join(ctx.projectsRoot, body.project), body.sessionId);
      const status = readSessionStatus<InstructionsStatus>(dir);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      if (body.kind === 'approve') {
        writeSessionStatus<InstructionsStatus>(dir, { ...status, phase: 'finalizing' });
      } else if (body.kind === 'revise') {
        writeFileSync(join(dir, 'feedback.md'), body.feedback ?? '');
        writeSessionStatus<InstructionsStatus>(dir, { ...status, phase: 'drafting' });
      } else {
        writeSessionStatus<InstructionsStatus>(dir, { ...status, phase: 'rejected' });
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
      const status = readSessionStatus<ProjectBrainStatus>(projectBrainSessionDir(join(projectsRoot, project), sid));
      if (status) out.push(status);
    }
  }
  return out;
}

/** R1-3b — the staged theme files (name + content) for a session under review. */
function readStagedThemes(projectsRoot: string, project: string, sessionId: string): Array<{ name: string; content: string }> {
  const dir = join(projectBrainSessionDir(join(projectsRoot, project), sessionId), 'themes');
  if (!existsSync(dir)) return [];
  const out: Array<{ name: string; content: string }> = [];
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { return out; }
  for (const name of files) {
    try { out.push({ name, content: readFileSync(join(dir, name), 'utf8') }); } catch { /* skip */ }
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
      const status = readSessionStatus<DemoBuilderStatus>(demoSessionDir(join(projectsRoot, project), sid));
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
      if (s.phase !== 'locked' && s.phase !== 'abandoned') ctx.ensureDemoTail(s.session_id);
    }
    const sessions = statuses.map((s) => {
      // DEMO.html lives in the PROJECT REPO under .forge/demo/, not the session dir.
      const demoUrl = existsSync(join(s.project_repo_path, DEMO_HTML_REL_PATH))
        ? `/api/demo-builder/demo/${encodeURIComponent(s.project)}/${encodeURIComponent(s.session_id)}`
        : null;
      // Per-element rendered fragments present in the repo (element ids) — so the
      // operator can view each part's output independently.
      const fragmentsDir = join(s.project_repo_path, '.forge', 'demo', 'fragments');
      let fragments: string[] = [];
      if (existsSync(fragmentsDir)) {
        try {
          fragments = readdirSync(fragmentsDir)
            .filter((f) => f.endsWith('.html'))
            .map((f) => f.slice(0, -'.html'.length));
        } catch { fragments = []; }
      }

      // staleMs: ms since the last sign of life — heartbeat mtime if present,
      // else the status.json updated_at timestamp.
      const heartbeatPath = join(ctx.logsRoot, `_demo-${s.session_id}`, '.heartbeat');
      let staleMs: number;
      if (existsSync(heartbeatPath)) {
        staleMs = Date.now() - statSync(heartbeatPath).mtimeMs;
      } else {
        const parsedAt = Date.parse(s.updated_at);
        staleMs = Date.now() - (isNaN(parsedAt) ? 0 : parsedAt);
      }

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
        hasLockedDemo: existsSync(join(s.project_repo_path, '.forge', 'demo', 'demo.lock.json')),
        staleMs,
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
    const status = readSessionStatus<DemoBuilderStatus>(dirOutcome.dir);
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
    // DEMO_HTML_REL_PATH is a fixed constant ('.forge/demo/DEMO.html', no
    // caller input), so once project_repo_path itself is proven contained,
    // no further base/requested check is needed to reach it.
    const requested = join(status.project_repo_path, DEMO_HTML_REL_PATH);
    if (!existsSync(requested)) {
      sendJson(res, 404, { error: 'DEMO.html not found', project, sessionId }, origin);
      return true;
    }
    try {
      res.writeHead(200, {
        'content-type': contentTypeFor('DEMO.html'),
        'access-control-allow-origin': origin,
        'vary': 'origin',
      });
      res.end(readFileSync(requested, 'utf8'));
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
    const status = readSessionStatus<DemoBuilderStatus>(dirOutcome.dir);
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
    const base = join(status.project_repo_path, '.forge', 'demo', 'fragments') + sep;
    const requested = join(status.project_repo_path, '.forge', 'demo', 'fragments', `${element}.html`);
    if (!requested.startsWith(base)) {
      sendJson(res, 400, { error: 'path escape rejected' }, origin);
      return true;
    }
    if (!existsSync(requested)) {
      sendJson(res, 404, { error: 'fragment not found', project, sessionId, element }, origin);
      return true;
    }
    try {
      // A fragment is just the element's `<section>` slice. Wrap it in the Forge
      // demo base stylesheet so the component view is a styled slice of the full
      // demo (the composer inlines the same CSS into DEMO.html). If the fragment
      // is already a full HTML doc, serve it untouched.
      const raw = readFileSync(requested, 'utf8');
      const isFullDoc = /^\s*<!doctype|^\s*<html[\s>]/i.test(raw);
      const out = isFullDoc ? raw : wrapDemoFragment(ctx.forgeRoot, element, raw);
      res.writeHead(200, { 'content-type': contentTypeFor('f.html'), 'access-control-allow-origin': origin, 'vary': 'origin' });
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
    res.writeHead(200, { 'content-type': contentTypeFor(filename), 'access-control-allow-origin': origin, 'vary': 'origin' });
    res.end(fileBody);
    return true;
  }

  // GET /api/demo-builder/history/<project> — list previously-locked demos
  // (snapshots under <repo>/.forge/demo/history/<id>/), newest first.
  const histListMatch = url.match(/^\/api\/demo-builder\/history\/([^/]+)$/);
  if (method === 'GET' && histListMatch) {
    const project = decodeURIComponent(histListMatch[1]);
    const histRoot = join(ctx.projectsRoot, project, '.forge', 'demo', 'history');
    const entries: Array<Record<string, unknown>> = [];
    if (existsSync(histRoot)) {
      let ids: string[];
      try {
        ids = readdirSync(histRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      } catch { ids = []; }
      for (const id of ids) {
        if (!existsSync(join(histRoot, id, 'DEMO.html'))) continue;
        const meta = readJsonFile<Record<string, unknown>>(join(histRoot, id, 'meta.json')) ?? {};
        entries.push({
          id,
          demoUrl: `/api/demo-builder/history/${encodeURIComponent(project)}/${encodeURIComponent(id)}`,
          lockedAt: typeof meta.locked_at === 'string' ? meta.locked_at : null,
          prompt: typeof meta.prompt === 'string' ? meta.prompt : '',
          iterations: typeof meta.iterations === 'number' ? meta.iterations : null,
        });
      }
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
    const base = join(ctx.projectsRoot, project, '.forge', 'demo', 'history') + sep;
    const requested = join(ctx.projectsRoot, project, '.forge', 'demo', 'history', id, 'DEMO.html');
    if (!requested.startsWith(base)) {
      sendJson(res, 400, { error: 'path escape rejected' }, origin);
      return true;
    }
    if (!existsSync(requested)) {
      sendJson(res, 404, { error: 'demo not found', project, id }, origin);
      return true;
    }
    try {
      res.writeHead(200, {
        'content-type': contentTypeFor('DEMO.html'),
        'access-control-allow-origin': origin,
        'vary': 'origin',
      });
      res.end(readFileSync(requested, 'utf8'));
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
      if (s.phase !== 'committed' && s.phase !== 'abandoned') ctx.ensureProjectBrainTail(s.session_id);
    }
    sendJson(res, 200, { sessions: statuses }, origin);
    return true;
  }
  {
    const themesMatch = url.match(/^\/api\/project-brain\/themes\/([^/]+)\/([^/]+)$/);
    if (method === 'GET' && themesMatch) {
      const project = decodeURIComponent(themesMatch[1]);
      const sessionId = decodeURIComponent(themesMatch[2]);
      sendJson(res, 200, { themes: readStagedThemes(ctx.projectsRoot, project, sessionId) }, origin);
      return true;
    }
  }
  if (method === 'POST' && url === '/api/project-brain/start') {
    try {
      const body = (await readJson(req)) as { project?: string; projectRepoPath?: string };
      if (!body.project) { sendJson(res, 400, { error: 'project is required' }, origin); return true; }
      // SEC-02 (forge-d1f) — reject BEFORE any mkdirSync/status write. See
      // invalidProjectRepoPath's header for the defect.
      const badRepoPath = invalidProjectRepoPath(body.projectRepoPath, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot });
      if (badRepoPath !== null) {
        sendJson(res, 400, { error: `projectRepoPath is not a valid project directory: ${badRepoPath}` }, origin);
        return true;
      }
      const repoPath = body.projectRepoPath || join(ctx.projectsRoot, body.project);
      const sessionId = newArchitectSessionId();
      const dir = projectBrainSessionDir(join(ctx.projectsRoot, body.project), sessionId);
      mkdirSync(dir, { recursive: true });
      writeSessionStatus<ProjectBrainStatus>(dir, {
        session_id: sessionId, project: body.project, project_repo_path: repoPath,
        phase: 'briefing', prompt: '', updated_at: new Date().toISOString(),
      });
      ctx.broadcastProjectBrainChanged();
      sendJson(res, 200, { ok: true, sessionId }, origin);
    } catch (err) { sendJson(res, 500, { error: String(err) }, origin); }
    return true;
  }
  if (method === 'POST' && url === '/api/project-brain/brief') {
    try {
      const body = (await readJson(req)) as { project?: string; sessionId?: string; brief?: string };
      if (!body.project || !body.sessionId) { sendJson(res, 400, { error: 'project and sessionId are required' }, origin); return true; }
      const dir = projectBrainSessionDir(join(ctx.projectsRoot, body.project), body.sessionId);
      const status = readSessionStatus<ProjectBrainStatus>(dir);
      if (!status) { sendJson(res, 404, { error: 'session not found' }, origin); return true; }
      writeFileSync(join(dir, 'prompt.md'), body.brief ?? '');
      writeSessionStatus<ProjectBrainStatus>(dir, { ...status, phase: 'analyzing', prompt: body.brief ?? '' });
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
      const dir = projectBrainSessionDir(join(ctx.projectsRoot, body.project), body.sessionId);
      const status = readSessionStatus<ProjectBrainStatus>(dir);
      if (!status) { sendJson(res, 404, { error: 'session not found' }, origin); return true; }
      writeSessionStatus<ProjectBrainStatus>(dir, { ...status, phase: approve ? 'committing' : 'abandoned' });
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
  // `project` is validated (SLUG_RE + length cap, via the same
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

      spawnAgentDispatch(ctx.forgeRoot, 'onboarding-agent', runId, project, inputs, sessionDir);
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

  // R4-16 round 2 (pin 3, Finding A) — every route below resolves its
  // session dir through `resolveDemoSessionDir`, the ONE choke point (see
  // its own header comment, above the GET generation route). Each rejects
  // with a 400 naming the offending value BEFORE any read, write,
  // `mkdirSync`, or spawn.
  if (method === 'POST' && url === '/api/demo-builder/start') {
    try {
      const body = (await readJson(req)) as { project?: string; mode?: 'create' | 'update'; projectRepoPath?: string; targetElement?: string };
      if (!body.project) {
        sendJson(res, 400, { error: 'project is required' }, origin);
        return true;
      }
      // SEC-02 (forge-d1f) — reject BEFORE any mkdirSync/existsSync-through
      // read/status write. See invalidProjectRepoPath's header for the defect.
      const badRepoPath = invalidProjectRepoPath(body.projectRepoPath, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot });
      if (badRepoPath !== null) {
        sendJson(res, 400, { error: `projectRepoPath is not a valid project directory: ${badRepoPath}` }, origin);
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
      const dir = dirOutcome.dir;
      const repoPath = body.projectRepoPath || join(ctx.projectsRoot, body.project);
      // Default the mode by whether a locked demo already exists.
      const mode: 'create' | 'update' =
        body.mode ?? (existsSync(join(repoPath, '.forge', 'demo', 'demo.lock.json')) ? 'update' : 'create');
      mkdirSync(dir, { recursive: true });
      writeSessionStatus<DemoBuilderStatus>(dir, {
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
      });
      ctx.broadcastDemoChanged();
      sendJson(res, 200, { ok: true, sessionId, mode }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
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
      const dir = dirOutcome.dir;
      const status = readSessionStatus<DemoBuilderStatus>(dir);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const brief = body.brief ?? '';
      writeFileSync(join(dir, 'prompt.md'), brief);
      // `targetElement` narrows the turn to one demo element (per-element iteration);
      // omit/empty to compose the full demo.
      const targetElement = typeof body.targetElement === 'string' && body.targetElement ? body.targetElement : status.targetElement;
      writeSessionStatus<DemoBuilderStatus>(dir, {
        ...status, phase: 'generating', iteration: 1, prompt: brief,
        ...(targetElement ? { targetElement } : {}),
      });
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
      const dir = dirOutcome.dir;
      const status = readSessionStatus<DemoBuilderStatus>(dir);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      writeFileSync(join(dir, 'feedback.md'), body.feedback ?? '');
      writeSessionStatus<DemoBuilderStatus>(dir, { ...status, phase: 'generating', iteration: status.iteration + 1 });
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
      const dir = dirOutcome.dir;
      const hasGeneration = Object.prototype.hasOwnProperty.call(body, 'generation') && body.generation !== undefined;
      if (hasGeneration && !(typeof body.generation === 'number' && Number.isInteger(body.generation) && body.generation >= 1)) {
        sendJson(res, 400, { error: `generation must be an integer >= 1, got ${JSON.stringify(body.generation)}` }, origin);
        return true;
      }
      const status = readSessionStatus<DemoBuilderStatus>(dir);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      writeSessionStatus<DemoBuilderStatus>(dir, {
        ...status,
        phase: 'locking',
        ...(hasGeneration ? { selectedGeneration: body.generation as number } : {}),
      });
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
      const dir = dirOutcome.dir;
      const status = readSessionStatus<DemoBuilderStatus>(dir);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      writeSessionStatus<DemoBuilderStatus>(dir, { ...status, phase: 'abandoned' });
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
// POSTs the answers here — converting the `/forge-reflect` slash command into
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
    const dir = join(ctx.logsRoot, cycleId);
    const questions = readJsonFile<unknown[]>(join(dir, 'user-questions.json')) ?? [];
    const answered = existsSync(join(dir, 'user-feedback.md'));
    // R4-09-F3: the durable reflect mode (REFLECT_MODE_FILE) — the authoritative
    // signal the UI uses to render the automated read-only view, independent of
    // per-question inferred-marker compliance.
    const modeDoc = readJsonFile<{ mode?: string }>(join(dir, 'reflect-mode.json'));
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
      const dir = join(ctx.logsRoot, cycleId);
      if (!existsSync(dir)) { sendJson(res, 404, { error: 'cycle not found', cycleId }, origin); return true; }
      const lines = [`# Reflection feedback — ${cycleId}`, '', '## Answers to numbered questions', ''];
      for (const a of body.answers ?? []) {
        lines.push(`### ${a.question}`, '', a.answer || '_(skipped)_', '');
      }
      lines.push('## Free-form feedback', '', (body.freeform ?? '').trim() || '_(none)_', '');
      writeFileSync(join(dir, 'user-feedback.md'), lines.join('\n'));
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
