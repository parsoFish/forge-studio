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
import lockfile from 'proper-lockfile';
import { WebSocketServer, type WebSocket } from 'ws';

import { getPaths, listInFlight } from '../orchestrator/queue.ts';
import { parseManifest, persistManifestResumeFromUnifier } from '../orchestrator/manifest.ts';
import { parseWorkItem } from '../orchestrator/work-item.ts';
import {
  appendReviewUnifierItems,
  UnifierItemsCapError,
  ReviewConcernInvalidError,
} from '../orchestrator/unifier-items.ts';
import { UNIFIER_DEFAULT_ITERATION_CAP } from '../orchestrator/unifier-invocation.ts';
import { loadProjectConfig } from '../orchestrator/project-config.ts';
import { daemonState, setPaused, readPid, isAlive, clearPidFile, daemonPaths } from '../orchestrator/daemon.ts';
import { mergePullRequest } from '../orchestrator/pr.ts';
import { finalizeMergedReadyForReview } from '../orchestrator/finalize-merged.ts';
import type { EventLogEntry } from '../orchestrator/logging.ts';
import {
  listArchitectSessions,
  readStatus,
  writeStatus,
  type ArchitectStatus,
  type ArchitectQuestion,
} from '../orchestrator/architect-runner.ts';

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
  status: 'in-flight' | 'ready-for-review' | 'done' | 'failed' | 'pending';
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
  | { type: 'architect-list-changed' };

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
};

type TailState = {
  cycleId: string;
  filePath: string;
  offset: number;
  timer?: NodeJS.Timeout;
};

export async function startBridge(opts: BridgeOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const { forgeRoot } = opts;
  const port = opts.port ?? 0; // 0 = OS-assigned
  // getPaths takes the QUEUE ROOT, not the forge root — _queue/ is a
  // child of forgeRoot.
  const queuePaths = getPaths(resolve(forgeRoot, '_queue'));
  const logsRoot = resolve(forgeRoot, '_logs');
  const projectsRoot = resolve(forgeRoot, 'projects');
  const mergePrFn = opts.mergePr ?? mergePullRequest;
  const finalizeAfterMergeFn = opts.finalizeAfterMerge ?? finalizeMergedReadyForReview;

  const clients = new Set<WebSocket>();
  const tails = new Map<string, TailState>();
  const queueWatchers: FSWatcher[] = [];
  const architectWatchers: FSWatcher[] = [];

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
    const dirs = [queuePaths.pending, queuePaths.inFlight, queuePaths.readyForReview, queuePaths.done, queuePaths.failed];
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

  const http = createServer((req, res) => {
    void handleHttp(req, res, {
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
      mergePr: mergePrFn,
      finalizeAfterMerge: finalizeAfterMergeFn,
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

  const close = async (): Promise<void> => {
    for (const w of queueWatchers) { try { w.close(); } catch { /* ignore */ } }
    for (const w of architectWatchers) { try { w.close(); } catch { /* ignore */ } }
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
  /** Merge the remote PR. Injectable for tests; defaults to mergePullRequest. */
  mergePr: (worktreePath: string) => boolean;
  /** Fire finalization after merge. Injectable for tests; defaults to finalizeMergedReadyForReview. */
  finalizeAfterMerge: (deps: { queueRoot: string; logsRoot: string }) => Promise<unknown>;
};

/** Content-type by extension for served artifacts. `.html` → `text/html` so the
 *  PLAN/DEMO pages render in the operator's browser (ADR 020 + Phase E); all
 *  else stays `text/plain`. */
function contentTypeFor(filename: string): string {
  return filename.toLowerCase().endsWith('.html')
    ? 'text/html; charset=utf-8'
    : 'text/plain; charset=utf-8';
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HttpContext,
): Promise<void> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // CORS preflight for the browser fetch with content-type JSON.
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  if (method === 'GET' && url === '/api/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (method === 'GET' && url === '/api/cycles') {
    sendJson(res, 200, ctx.scanCycles());
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
    sendJson(res, 200, ctx.liveness());
    return;
  }
  if (method === 'GET' && url.startsWith('/api/events/')) {
    const cycleId = decodeURIComponent(url.slice('/api/events/'.length));
    const filePath = join(ctx.logsRoot, cycleId, 'events.jsonl');
    if (!existsSync(filePath)) {
      sendJson(res, 404, { error: 'no events.jsonl for cycle', cycleId });
      return;
    }
    try {
      const raw = readFileSync(filePath, 'utf8');
      const events: EventLogEntry[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
      sendJson(res, 200, { cycleId, events });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
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
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
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
      sendJson(res, 404, { error: 'no _graph.md for cycle', cycleId });
      return;
    }
    try {
      const raw = readFileSync(filePath, 'utf8');
      sendJson(res, 200, { cycleId, mermaid: raw });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
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
      sendJson(res, 400, { error: 'expected /api/work-item/<cycleId>/<wiId>' });
      return;
    }
    const cycleId = rest.slice(0, slash);
    const wiId = rest.slice(slash + 1);
    if (!cycleId || !wiId || !/^WI-\d+$/.test(wiId)) {
      sendJson(res, 400, { error: 'cycleId and a WI-<n> wiId are required' });
      return;
    }
    const snapshotPath = join(ctx.logsRoot, cycleId, 'work-items-snapshot', `${wiId}.md`);
    const initiativeId = (cycleId.match(/_(INIT-.+)$/) ?? [, cycleId])[1] as string;
    const livePath = join(ctx.forgeRoot, '_worktrees', initiativeId, '.forge', 'work-items', `${wiId}.md`);
    const found = existsSync(snapshotPath) ? snapshotPath : existsSync(livePath) ? livePath : null;
    if (!found) {
      sendJson(res, 404, { error: 'work item not found in snapshot or live worktree', cycleId, wiId });
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
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
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
      sendJson(res, 400, { error: 'expected /api/artifact/<cycleId>/<filename>' });
      return;
    }
    const cycleId = rest.slice(0, slash);
    const filename = rest.slice(slash + 1);
    if (!cycleId || !filename) {
      sendJson(res, 400, { error: 'cycleId and filename are required' });
      return;
    }
    const requested = join(ctx.logsRoot, cycleId, 'artifacts', filename);
    const safeBase = join(ctx.logsRoot, cycleId, 'artifacts') + sep;
    if (!requested.startsWith(safeBase)) {
      sendJson(res, 400, { error: 'path escape rejected' });
      return;
    }
    if (!existsSync(requested)) {
      sendJson(res, 404, { error: 'artifact not found', cycleId, filename });
      return;
    }
    try {
      const body = readFileSync(requested, 'utf8');
      res.writeHead(200, {
        'content-type': contentTypeFor(filename),
        'access-control-allow-origin': '*',
      });
      res.end(body);
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // ---- Architect (ADR 020) ----------------------------------------------
  if (await handleArchitect(req, res, ctx, url, method)) return;
  if (await handleReflect(req, res, ctx, url, method)) return;

  // Scheduler lifecycle.
  if (method === 'GET' && url === '/api/scheduler/status') {
    const state = daemonState(ctx.forgeRoot, ctx.queueRoot);
    sendJson(res, 200, state);
    return;
  }
  if (method === 'POST' && url === '/api/scheduler/start') {
    try {
      const before = daemonState(ctx.forgeRoot, ctx.queueRoot);
      if (before.running) {
        sendJson(res, 200, { ok: true, alreadyRunning: true, state: before });
        return;
      }
      // Spawn detached so the daemon outlives the forge-watch process.
      const proc = spawn(process.execPath, ['--experimental-strip-types', 'orchestrator/cli.ts', 'start'], {
        cwd: ctx.forgeRoot,
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();
      // Best-effort wait for the pid file to appear.
      await sleep(800);
      const after = daemonState(ctx.forgeRoot, ctx.queueRoot);
      sendJson(res, 200, { ok: true, started: true, state: after });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }
  // Pause / resume — toggle the `<queueRoot>/.paused` flag the scheduler
  // reads each poll. In-flight cycles keep running; only new claims stop.
  if (method === 'POST' && (url === '/api/scheduler/pause' || url === '/api/scheduler/resume')) {
    try {
      const pause = url.endsWith('/pause');
      setPaused(pause, ctx.queueRoot, pause ? 'paused from UI' : '');
      sendJson(res, 200, { ok: true, state: daemonState(ctx.forgeRoot, ctx.queueRoot) });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }
  // Stop — SIGTERM the daemon; it drains in-flight cycles then exits. We
  // don't block the request on the drain — the status poll reflects
  // `running:false` once it's down.
  if (method === 'POST' && url === '/api/scheduler/stop') {
    try {
      const pid = readPid(daemonPaths(ctx.forgeRoot).pidFile);
      if (pid === null || !isAlive(pid)) {
        clearPidFile(ctx.forgeRoot);
        sendJson(res, 200, { ok: true, alreadyStopped: true, state: daemonState(ctx.forgeRoot, ctx.queueRoot) });
        return;
      }
      process.kill(pid, 'SIGTERM');
      sendJson(res, 200, { ok: true, stopping: true, state: daemonState(ctx.forgeRoot, ctx.queueRoot) });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // Review verdict — the M2-C intervention surface.
  if (method === 'POST' && url === '/api/verdict') {
    try {
      const body = await readJson(req);
      const { initiativeId, kind, rationale } = body as {
        initiativeId?: string;
        kind?: 'approve' | 'send-back';
        rationale?: string;
        acceptanceCriteria?: Array<{ given: string; when: string; then: string }>;
      };
      if (!initiativeId || !kind || !rationale) {
        sendJson(res, 400, { error: 'initiativeId, kind, rationale required' });
        return;
      }
      if (kind !== 'approve' && kind !== 'send-back') {
        sendJson(res, 400, { error: `unknown kind: ${kind}` });
        return;
      }
      const acs = (body as { acceptanceCriteria?: Array<{ given: string; when: string; then: string }> }).acceptanceCriteria ?? [];
      if (kind === 'send-back' && acs.length === 0) {
        sendJson(res, 400, { error: 'send-back requires at least one acceptanceCriteria' });
        return;
      }
      // Accept the verdict for a manifest in EITHER in-flight/ OR
      // ready-for-review/ (closure moves it to ready-for-review/ once the PR is
      // open, which is the common case by the time the operator opens the form).
      const inFlightPath = join(ctx.queueRoot, 'in-flight', `${initiativeId}.md`);
      const readyForReviewPath = join(ctx.queueRoot, 'ready-for-review', `${initiativeId}.md`);
      if (!existsSync(inFlightPath) && !existsSync(readyForReviewPath)) {
        sendJson(res, 409, {
          error: 'no manifest for initiative in in-flight/ or ready-for-review/ (already resolved?)',
          initiativeId,
        });
        return;
      }
      const manifestPath = existsSync(inFlightPath) ? inFlightPath : readyForReviewPath;

      if (kind === 'approve') {
        // Supersedes G9: the in-UI approve IS the merge gate (ADR-023 "UI is the
        // sole operator surface"; operator never leaves forge UI). Read the
        // manifest — same pattern as the send-back branch — to get the worktree
        // path, merge the remote PR via `gh pr merge`, then immediately fire the
        // finalize sweep so closure → done → reflection runs without waiting for
        // the next 5-minute sweep.
        const approveManifest = parseManifest(readFileSync(manifestPath, 'utf8'));
        const approveWorktreePath = approveManifest.worktree_path ?? '';
        if (!approveWorktreePath || !existsSync(approveWorktreePath)) {
          sendJson(res, 409, {
            error: 'worktree gone — merge the PR on GitHub; the sweep will detect it in ≤5 min',
            initiativeId,
          });
          return;
        }
        const merged = ctx.mergePr(approveWorktreePath);
        if (!merged) {
          sendJson(res, 409, {
            error: 'gh pr merge failed — merge the PR manually on GitHub',
            initiativeId,
          });
          return;
        }
        // Fire finalization in the background — must NOT throw or await here so
        // the HTTP response is always sent promptly. Closure moves the manifest to
        // done/, aligns local↔remote, and triggers reflection.
        void ctx.finalizeAfterMerge({ queueRoot: ctx.queueRoot, logsRoot: ctx.logsRoot });
        sendJson(res, 200, {
          ok: true,
          kind,
          note: 'PR merged and finalization triggered',
        });
        return;
      }

      // send-back (ADR 026): the cycle NEVER leaves. Append the operator's
      // concern to the unifier's own work-item queue in the LIVE worktree; the
      // drain (a scheduler sweep, sibling of finalize-merged) re-claims this
      // ready-for-review manifest threading the SAME cycle_id and re-runs the
      // post-unifier spine over the appended UWIs. One cycleId ⇒ the cost/status
      // lineage + WI-hex list never blank (no requeue, no sibling cycle).
      //
      // Resolve the live worktree + the project gate that backs a packaging UWI.
      const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
      const worktreePath = manifest.worktree_path ?? '';
      if (!worktreePath || !existsSync(worktreePath)) {
        sendJson(res, 409, { error: 'no live worktree for this cycle (already cleaned up?) — cannot append review work items', initiativeId });
        return;
      }
      let projectGateCmd: string[] = manifest.quality_gate_cmd && manifest.quality_gate_cmd.length > 0 ? manifest.quality_gate_cmd : [];
      try {
        const cfg = loadProjectConfig(manifest.project_repo_path);
        if (cfg?.quality_gate_cmd && cfg.quality_gate_cmd.length > 0) projectGateCmd = cfg.quality_gate_cmd;
      } catch { /* fall back to the manifest gate / npm test below */ }
      if (projectGateCmd.length === 0) {
        projectGateCmd = existsSync(join(worktreePath, 'package.json')) ? ['npm', 'test'] : ['true'];
      }
      const concernKind = (body as { concernKind?: 'packaging' | 'code-fix' }).concernKind;
      const concernGateCmd = (body as { qualityGateCmd?: string[] }).qualityGateCmd;

      // Lock the manifest to serialise concurrent verdict submissions (the
      // append reads + bumps the next UWI id). The append itself writes only to
      // the worktree, so the manifest stays in ready-for-review/ for the drain.
      let release: (() => Promise<void>) | null = null;
      try {
        release = await lockfile.lock(manifestPath, { retries: { retries: 5, minTimeout: 50 } });
      } catch (lockErr) {
        sendJson(res, 503, { error: 'manifest is locked by another writer', detail: String(lockErr) });
        return;
      }
      try {
        const { appended } = appendReviewUnifierItems({
          worktreePath,
          initiativeId,
          concern: { rationale, acceptanceCriteria: acs, kind: concernKind, qualityGateCmd: concernGateCmd },
          projectGateCmd,
          estimatedIterations: UNIFIER_DEFAULT_ITERATION_CAP,
        });
        // ADR 026 (crash recovery): mark the manifest so a daemon crash mid-drain
        // recovers as a unifier resume (reuse the worktree) rather than a full re-run.
        persistManifestResumeFromUnifier(manifestPath);
        sendJson(res, 200, {
          ok: true,
          kind,
          appendedUnifierItems: appended,
          note: 'work items appended to the unifier queue; the drain re-runs them in the same cycle',
        });
      } catch (appendErr) {
        if (appendErr instanceof UnifierItemsCapError) {
          sendJson(res, 409, { error: appendErr.message });
        } else if (appendErr instanceof ReviewConcernInvalidError) {
          sendJson(res, 400, { error: appendErr.message });
        } else {
          sendJson(res, 500, { error: `append review work items failed: ${String(appendErr)}` });
        }
      } finally {
        if (release) { try { await release(); } catch { /* ignore */ } }
      }
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  res.writeHead(404);
  res.end();
}

// ---- Architect routes (ADR 020) -------------------------------------------

/** Spawn one architect-runner turn as a detached child (the scheduler-daemon
 *  spawn pattern). Best-effort + fire-and-forget — the runner checkpoints to
 *  the session dir and the fsWatch/`architect-list-changed` signal drives the
 *  UI re-fetch. `FORGE_ARCHITECT_NO_SPAWN=1` disables the spawn for harness /
 *  curl runs that pre-seed session state (mirrors `FORGE_BRIDGE_DEBUG`).
 *
 *  The runner's stderr (uncaught exceptions, SDK errors) is captured to
 *  `_logs/_architect-<sid>/stderr.log` so stalls are diagnosable via the
 *  existing GET /api/architect/file/<project>/<sid>/stderr.log endpoint. */
function spawnArchitectTurn(forgeRoot: string, project: string, sessionId: string): void {
  if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1') return;
  try {
    const logDir = join(forgeRoot, '_logs', `_architect-${sessionId}`);
    mkdirSync(logDir, { recursive: true });
    const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
    const proc = spawn(
      process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', 'architect', 'run', sessionId, '--project', project],
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
      };
    });
    sendJson(res, 200, { sessions });
    return true;
  }

  // GET /api/architect/file/<project>/<sid>/<filename> — serve a session-dir
  // file (PLAN.html etc.) with a path-escape guard + content-type sniff.
  if (method === 'GET' && url.startsWith('/api/architect/file/')) {
    const rest = url.slice('/api/architect/file/'.length).split('/').map(decodeURIComponent);
    const [project, sessionId, ...fileParts] = rest;
    const filename = fileParts.join('/');
    if (!project || !sessionId || !filename) {
      sendJson(res, 400, { error: 'expected /api/architect/file/<project>/<sid>/<filename>' });
      return true;
    }
    const base = architectSessionDir(ctx.projectsRoot, project, sessionId) + sep;
    const requested = join(architectSessionDir(ctx.projectsRoot, project, sessionId), filename);
    if (!requested.startsWith(base)) {
      sendJson(res, 400, { error: 'path escape rejected' });
      return true;
    }
    if (!existsSync(requested)) {
      sendJson(res, 404, { error: 'file not found', project, sessionId, filename });
      return true;
    }
    try {
      res.writeHead(200, {
        'content-type': contentTypeFor(filename),
        'access-control-allow-origin': '*',
      });
      res.end(readFileSync(requested, 'utf8'));
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // POST /api/architect/start {project, idea, projectRepoPath?} — create a new
  // session and kick off the first interview turn.
  if (method === 'POST' && url === '/api/architect/start') {
    try {
      const body = (await readJson(req)) as { project?: string; idea?: string; projectRepoPath?: string };
      if (!body.project || !body.idea) {
        sendJson(res, 400, { error: 'project and idea are required' });
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
      spawnArchitectTurn(ctx.forgeRoot, body.project, sessionId);
      ctx.broadcastArchitectChanged();
      sendJson(res, 200, { ok: true, sessionId });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
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
        sendJson(res, 400, { error: 'project, sessionId, answers[] are required' });
        return true;
      }
      const dir = architectSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      const status = readStatus(dir);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId });
        return true;
      }
      const answersPath = join(dir, 'answers.json');
      const prior = readJsonFile<{ round: number; answers: unknown[] }[]>(answersPath) ?? [];
      const round = prior.length + 1;
      writeFileSync(answersPath, JSON.stringify([...prior, { round, answers: body.answers }], null, 2));
      writeStatus(dir, { ...status, phase: 'interviewing', round: round + 1 });
      spawnArchitectTurn(ctx.forgeRoot, body.project, body.sessionId);
      ctx.broadcastArchitectChanged();
      sendJson(res, 200, { ok: true, round });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // POST /api/plan-verdict {project, sessionId, kind, selections?, rationale?}
  //   approve → write selections + resolved-decisions feedback, finalize turn
  //   revise  → write feedback, re-open the interview
  //   reject  → mark rejected
  if (method === 'POST' && url === '/api/plan-verdict') {
    try {
      const body = (await readJson(req)) as {
        project?: string;
        sessionId?: string;
        kind?: 'approve' | 'revise' | 'reject';
        rationale?: string;
      };
      if (!body.project || !body.sessionId || !body.kind) {
        sendJson(res, 400, { error: 'project, sessionId, kind are required' });
        return true;
      }
      if (!['approve', 'revise', 'reject'].includes(body.kind)) {
        sendJson(res, 400, { error: `unknown kind: ${body.kind}` });
        return true;
      }
      const dir = architectSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      const status = readStatus(dir);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId });
        return true;
      }

      if (body.kind === 'approve') {
        if (body.rationale) {
          writeFileSync(join(dir, 'feedback.md'), body.rationale.trim() + '\n');
        }
        writeStatus(dir, { ...status, phase: 'finalizing' });
        spawnArchitectTurn(ctx.forgeRoot, body.project, body.sessionId);
      } else if (body.kind === 'revise') {
        writeFileSync(join(dir, 'feedback.md'), (body.rationale ?? '').trim() + '\n');
        writeStatus(dir, { ...status, phase: 'interviewing', round: status.round + 1 });
        spawnArchitectTurn(ctx.forgeRoot, body.project, body.sessionId);
      } else {
        writeStatus(dir, { ...status, phase: 'rejected' });
      }
      ctx.broadcastArchitectChanged();
      sendJson(res, 200, { ok: true, kind: body.kind });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
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
  if (method === 'GET' && url.startsWith('/api/reflect/') && !url.endsWith('/answer')) {
    const cycleId = decodeURIComponent(url.slice('/api/reflect/'.length));
    if (!cycleId) { sendJson(res, 400, { error: 'expected /api/reflect/<cycleId>' }); return true; }
    const dir = join(ctx.logsRoot, cycleId);
    const questions = readJsonFile<unknown[]>(join(dir, 'user-questions.json')) ?? [];
    const answered = existsSync(join(dir, 'user-feedback.md'));
    sendJson(res, 200, { cycleId, questions, answered });
    return true;
  }

  if (method === 'POST' && url.startsWith('/api/reflect/') && url.endsWith('/answer')) {
    const cycleId = decodeURIComponent(url.slice('/api/reflect/'.length, url.length - '/answer'.length));
    try {
      const body = (await readJson(req)) as { answers?: { question: string; answer: string }[]; freeform?: string };
      const dir = join(ctx.logsRoot, cycleId);
      if (!existsSync(dir)) { sendJson(res, 404, { error: 'cycle not found', cycleId }); return true; }
      const lines = [`# Reflection feedback — ${cycleId}`, '', '## Answers to numbered questions', ''];
      for (const a of body.answers ?? []) {
        lines.push(`### ${a.question}`, '', a.answer || '_(skipped)_', '');
      }
      lines.push('## Free-form feedback', '', (body.freeform ?? '').trim() || '_(none)_', '');
      writeFileSync(join(dir, 'user-feedback.md'), lines.join('\n'));
      sendJson(res, 200, { ok: true });
      // Parity with `forge reflect --rerun`: the reflector ingests the feedback
      // file on rerun. Detached (don't block the HTTP response on a full
      // reflector pass) + log-and-continue, so the UI owns reflection
      // end-to-end without the operator touching the CLI.
      void import('../orchestrator/forge-reflect-rerun.ts')
        .then(({ rerunReflector }) =>
          rerunReflector({ cycleId, logsRoot: ctx.logsRoot, queueRoot: ctx.queueRoot }),
        )
        .catch((err) =>
          console.error(`[bridge] reflect rerun failed for ${cycleId}: ${String(err)}`),
        );
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  return false;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, rejectJson) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(payload);
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
