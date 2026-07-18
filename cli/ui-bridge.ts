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
  statSync,
  watch as fsWatch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
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
} from './bridge-studio.ts';
import { handleStudioKbRoutes } from './bridge-studio-kbs.ts';
import { handleRecoveryRoutes } from './bridge-recovery.ts';
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
  type DemoBuilderStatus,
} from '../orchestrator/demo-builder-runner.ts';
import {
  projectBrainSessionDir,
  type ProjectBrainStatus,
} from '../orchestrator/project-brain-builder-runner.ts';
import { isSafeRunId } from '../orchestrator/run-agent.ts';
import {
  readSessionStatus,
  writeSessionStatus,
  type InterviewQuestion,
} from '../orchestrator/interactive-session.ts';
import { readAgentInstructionsFile } from '../orchestrator/project-config.ts';

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
  const projectsRoot = resolve(forgeRoot, 'projects');
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
  if (await handleRecoveryRoutes(req, res, { forgeRoot: ctx.forgeRoot, queueRoot: ctx.queueRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioWriteRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  if (await handleStudioKbRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
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

function architectSessionDir(projectsRoot: string, project: string, sessionId: string): string {
  return join(projectsRoot, project, '_architect', sessionId);
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return null; }
}

function newArchitectSessionId(): string {
  // YYYY-MM-DDTHH-mm-ss (matches ArchitectSession.session_id elsewhere).
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+$/, '');
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
      const sessionId = newArchitectSessionId();
      const dir = architectSessionDir(ctx.projectsRoot, body.project, sessionId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'idea.md'), body.idea);
      const status: ArchitectStatus = {
        session_id: sessionId,
        project: body.project,
        project_repo_path: body.projectRepoPath ?? join(ctx.projectsRoot, body.project),
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
      const status = readStatus(dir);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const answersPath = join(dir, 'answers.json');
      const prior = readJsonFile<{ round: number; answers: unknown[] }[]>(answersPath) ?? [];
      const round = prior.length + 1;
      writeFileSync(answersPath, JSON.stringify([...prior, { round, answers: body.answers }], null, 2));
      writeStatus(dir, { ...status, phase: 'interviewing', round: round + 1 });
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
      const repoPath = body.projectRepoPath ?? join(ctx.projectsRoot, body.project);
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
    const status = readSessionStatus<DemoBuilderStatus>(
      demoSessionDir(join(ctx.projectsRoot, project), sessionId),
    );
    if (!status) {
      sendJson(res, 404, { error: 'session not found', project, sessionId }, origin);
      return true;
    }
    const base = join(status.project_repo_path, '.forge', 'demo') + sep;
    const requested = join(status.project_repo_path, DEMO_HTML_REL_PATH);
    if (!requested.startsWith(base)) {
      sendJson(res, 400, { error: 'path escape rejected' }, origin);
      return true;
    }
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
    const status = readSessionStatus<DemoBuilderStatus>(demoSessionDir(join(ctx.projectsRoot, project), sessionId));
    if (!status) {
      sendJson(res, 404, { error: 'session not found', project, sessionId }, origin);
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
      const repoPath = body.projectRepoPath ?? join(ctx.projectsRoot, body.project);
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

  if (method === 'POST' && url === '/api/demo-builder/start') {
    try {
      const body = (await readJson(req)) as { project?: string; mode?: 'create' | 'update'; projectRepoPath?: string; targetElement?: string };
      if (!body.project) {
        sendJson(res, 400, { error: 'project is required' }, origin);
        return true;
      }
      const repoPath = body.projectRepoPath ?? join(ctx.projectsRoot, body.project);
      // Default the mode by whether a locked demo already exists.
      const mode: 'create' | 'update' =
        body.mode ?? (existsSync(join(repoPath, '.forge', 'demo', 'demo.lock.json')) ? 'update' : 'create');
      const sessionId = newArchitectSessionId();
      const dir = demoSessionDir(join(ctx.projectsRoot, body.project), sessionId);
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
      const dir = demoSessionDir(join(ctx.projectsRoot, body.project), body.sessionId);
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
      const dir = demoSessionDir(join(ctx.projectsRoot, body.project), body.sessionId);
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

  // POST /api/demo-builder/lock {project, sessionId} — lock the current demo in.
  if (method === 'POST' && url === '/api/demo-builder/lock') {
    try {
      const body = (await readJson(req)) as { project?: string; sessionId?: string };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      const dir = demoSessionDir(join(ctx.projectsRoot, body.project), body.sessionId);
      const status = readSessionStatus<DemoBuilderStatus>(dir);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      writeSessionStatus<DemoBuilderStatus>(dir, { ...status, phase: 'locking' });
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
      const dir = demoSessionDir(join(ctx.projectsRoot, body.project), body.sessionId);
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
    sendJson(res, 200, { cycleId, questions, answered }, origin);
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
