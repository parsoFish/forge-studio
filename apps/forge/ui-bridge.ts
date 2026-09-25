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
  openSync,
  readSync,
  statSync,
  type FSWatcher,
} from 'node:fs';
import { } from 'node:crypto';
import { join, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import { getPaths } from '@forge/flows/queue.ts';
import {
  handleStudioRoutes,
  handleStudioWriteRoutes,
  sendJson,
  allowedOrigin,
  CSRF_HEADER,
} from './bridge-studio.ts';
import { makeRouteTable, dispatchRoute, type AssembledRouteTable } from './routes.ts';
// M4 §4 step 2 — the four `@forge/library` prefix dispatchers this file imported
// here (skills, hooks, authoring, templates) are GONE: every arm is now a
// per-route handler in `packages/library/routes.ts`, which the `routeTable`
// imported on the line above already carries and `dispatchRoute` claims first.
import { sessionIsReadable } from '@forge/sessions/session-resolution.ts';
// M4 §4 step 2 — instructions, connections and community carved the same way.
// This file's line COUNT is held constant across the carve on purpose: 18 audited
// rows in `scripts/check-raw-fs-guarded.mjs` are keyed to `ui-bridge.ts:<line>`.
import { handleRecoveryRoutes } from '@forge/flows/bridge-recovery.ts';
import { handleHookRoutes } from '@forge/flows/bridge-hooks.ts';
import {
  handleStudioPostRoutes,
  type StudioPostContext,
  type ReleaseFinalizeHookInput,
} from '@forge/flows/bridge-studio-runs.ts';
import { isDryBridge, emitDryBridgeRefusal, dryBridgeAgentTurnMarker } from '@forge/kernel';
import { bindReleaseFinalize } from './example-hooks.ts';
import { handleCycleDataRoutes, servedFileHeaders } from './bridge-cycle-data.ts';
import { handleSchedulerRoutes } from './bridge-scheduler.ts';
import { handleRunTriggerRoutes } from './bridge-run-triggers.ts';
import { handleReviewCommentRoutes } from './bridge-review-comments.ts';
import {
  handleArchitect,
  spawnAgentTurn,
  spawnAgentDispatch,
  SPAWN_AGENT_SPECS,
  SAFE_INPUT_KEY_RE,
  newRunStamp,
} from './bridge-agent-dispatch.ts';
import { handleReflect, safeParseJson } from './bridge-reflect.ts';
import { readJson } from './bridge-http.ts';
import {
  type Cycle,
  type LivenessReport,
  scanCyclesFromDisk,
  computeLivenessReport,
  watchDirsFlat,
  watchProjectSubdirs,
} from './bridge-cycle-scan.ts';
import { mergePullRequest } from '@forge/flows/pr.ts';
import type { BridgeIdentity } from './forge-watch.ts';
import { finalizeMergedReadyForReview } from '@forge/flows/finalize-merged.ts';
import type { EventLogEntry } from '@forge/kernel';
import { makeRecordingBroadcast } from './bridge-broadcast-log.ts';
import { makeTrailingCoalescer } from './broadcast-coalescer.ts';
type RerunReflectorFn = InstalledFactory['rerunReflector'];
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';
import {
  installedExample as example, peekInstalledFactory,
  resolveInstalledFactory, type InstalledFactory } from './factory-wiring.ts';



const TAIL_POLL_MS = 200;

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
  // ADR 048 clause 2, FIRST: every factory-backed default below reads this, and
  // the bridge must come up whether or not an example package is installed.
  await resolveInstalledFactory();
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
  // `FORGE_PROJECTS_DIR` and `forge.config.json`'s `projectsDir`,
  // packages/kernel/config.ts). With that config set, this producer and
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
  // ADR 048: flows declares the reflector port; the assembly binds it, here and in `factory-wiring.ts`.
  const finalizeAfterMergeFn = opts.finalizeAfterMerge ?? ((deps: { queueRoot: string; logsRoot: string }) =>
    finalizeMergedReadyForReview({ ...deps, runReflector: example().phaseWiring.runReflector }));
  // WS-A (release): the default release-finalize hook constructs a per-cycle
  // logger and delegates to the real phase. Opt-in + log-and-continue live
  // inside `runReleaseFinalize` itself; this wrapper only wires the logger.
  // Bound only when an example is installed — `example-hooks.ts` owns that
  // decision and its header carries the reasoning (ADR 048, rulings 485/488).
  const runReleaseFinalizeFn = bindReleaseFinalize(opts.runReleaseFinalize, logsRoot);
  // D — auto-rerun the reflector on operator feedback. Default delegates to the
  // real helper; the POST handler + startup reconcile both call this.
  const rerunReflectorFn: RerunReflectorFn =
    opts.rerunReflector ??
    ((input) => example().rerunReflector(input));
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
  } else if (process.env.FORGE_ARCHITECT_NO_SPAWN !== '1' && peekInstalledFactory() !== null) {
    // ADR 048: reconciling feedback is the EXAMPLE's work; with none installed
    // there is no reflector to re-run, so it is skipped, not swallowed.
    void example().reconcileReflectFeedback({
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

  // 7.6.35 — sends AND records (type, cycleId, timestamp, subscriber count) so
  // "did `cycle-list-changed` fire, and was anyone listening?" is answerable
  // from bytes. See `bridge-broadcast-log.ts` for why it opens at boot.
  const broadcast = makeRecordingBroadcast<WsOutbound>(clients, forgeRoot);
  // R27 (forge-6gv.5.2): collapses watchQueue's 6-dir fan-out into one trailing broadcast — see broadcast-coalescer.ts.
  const queueChangeCoalescer = makeTrailingCoalescer(() => broadcast({ type: 'cycle-list-changed' }));

  // forge-4zk: the default filesystem scan moved to
  // `scanCyclesFromDisk` (`./bridge-cycle-scan.ts`), parameterised on
  // logsRoot/queuePaths instead of closing over them (feature move, no
  // behaviour change).
  const scanCycles = opts.scanCycles ?? ((): { live: Cycle[]; recent: Cycle[] } => scanCyclesFromDisk(logsRoot, queuePaths));

  // Feature #8 — the derivation moved to `computeLivenessReport`
  // (`./bridge-cycle-scan.ts`), parameterised on queuePaths instead of
  // closing over it (feature move, no behaviour change).
  const computeLiveness = (): LivenessReport => computeLivenessReport(queuePaths);

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

  // forge-4zk: the dir-watch mechanics moved to `watchDirsFlat` /
  // `watchProjectSubdirs` (`./bridge-cycle-scan.ts`) — `watchArchitect` /
  // `watchInstructions` / `watchDemo` were three byte-identical bodies
  // differing only in the sub-directory name and the broadcast payload;
  // `watchProjectSubdirs` is that ONE body, parameterised (feature move +
  // de-duplication, no behaviour change: same fs.watch calls, same
  // recursive-then-fallback shape, same watcher arrays).
  const watchQueue = (): void => {
    queueWatchers.push(...watchDirsFlat(
      [queuePaths.pending, queuePaths.inFlight, queuePaths.readyForReview, queuePaths.merged, queuePaths.done, queuePaths.failed],
      () => {
        queueChangeCoalescer.trigger();
        // A new cycle may have appeared; pick up its log if so — uncoalesced,
        // so a live tail arms promptly regardless of the broadcast cadence.
        startTailsForLive();
      },
    ));
  };

  // ADR 020 — watch each project's `_architect/` dir (recursively where the
  // platform supports it) so the runner's file-checkpoint writes (questions,
  // PLAN, status) push a re-fetch signal to the UI. Mirrors `watchQueue`.
  const watchArchitect = (): void => {
    architectWatchers.push(...watchProjectSubdirs(projectsRoot, '_architect', () => broadcast({ type: 'architect-list-changed' })));
  };

  // Stage A — watch each project's `_instructions/` dir so the runner's
  // file-checkpoint writes (questions, AGENTS.draft.md, status) push a re-fetch
  // signal to the UI. Mirrors `watchArchitect`.
  const watchInstructions = (): void => {
    instructionsWatchers.push(...watchProjectSubdirs(projectsRoot, '_instructions', () => broadcast({ type: 'instructions-list-changed' })));
  };

  // Stage B — watch each project's `_demo/` dir so the runner's file-checkpoint
  // writes (status, DEMO.html generation) push a re-fetch signal to the UI.
  // Mirrors `watchInstructions`.
  const watchDemo = (): void => {
    demoWatchers.push(...watchProjectSubdirs(projectsRoot, '_demo', () => broadcast({ type: 'demo-list-changed' })));
  };

  /** W7-C2 (A12) — the one place that knows which kinds have a `*-list-changed` WS event; a kind with none honestly no-ops. */
  const KIND_LIST_CHANGED = { architect: 'architect-list-changed', instructions: 'instructions-list-changed', demo: 'demo-list-changed', 'project-brain': 'project-brain-list-changed' } as const;
  const broadcastKindChanged = (kind: string): void => { const t = KIND_LIST_CHANGED[kind as keyof typeof KIND_LIST_CHANGED]; if (t !== undefined) broadcast({ type: t }); };
  /** T1 ruling 59 — built ONCE here: the session routes' deps are this bridge's own closures. */
  const routeTable = makeRouteTable({
    ensureSessionTail,
    broadcastKindChanged,
    broadcastArchitectChanged: () => broadcast({ type: 'architect-list-changed' }),
    broadcastInstructionsChanged: () => broadcast({ type: 'instructions-list-changed' }),
    broadcastProjectBrainChanged: () => broadcast({ type: 'project-brain-list-changed' }),
    spawnAgentDispatch,
    newRunStamp,
    safeInputKeyRe: SAFE_INPUT_KEY_RE,
    broadcastDemoChanged: () => broadcast({ type: 'demo-list-changed' }),
    projectsRoot,
    // The spawn/serve surface the carved session routes still need from here.
    // These stay host-owned deliberately: `safeParseJson` is still called by
    // `handleReflect` and `servedFileHeaders` by `handleHttp`, so moving them
    // into the package would mint boundary rows in the wrong direction.
    spawnAgentTurn,
    spawnAgentSpecs: SPAWN_AGENT_SPECS,
    safeParseJson,
    servedFileHeaders,
    dryBridgeAgentTurnMarker,
    // M4 agents carve: the SAME tail closures `handleHttp`'s ctx already
    // carries — one registry, injected twice, never duplicated.
    ensureAgentRunTail: ensureTailFor,
    releaseAgentRunTail: stopTailFor,
  });

  const http = createServer((req, res) => {
    void handleHttp(req, res, {
      routeTable,
      broadcastKindChanged,
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
    queueChangeCoalescer.close();
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
  /** T1 ruling 59 — THIS bridge's route table (its session routes act on this bridge's WS fan-out, so two bridges must not share one). */
  routeTable: AssembledRouteTable;
  /** W7-C2 (A12) — the ONE per-kind live-refresh mapping, shared by the tabled cancel route and the affordance write route. */
  broadcastKindChanged: (kind: string) => void;
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
  /**
   * WS-A — finalise the release on the PR branch before merge (opt-in;
   * log-and-continue). OPTIONAL, and the `?` is the ADR 048 statement (ruling
   * 485): a required field could only be satisfied by a function that throws
   * when the example is absent, and that throw was being swallowed.
   */
  runReleaseFinalize?: (input: ReleaseFinalizeHookInput) => Promise<{ release_status: string }>;
  /** D — re-run the reflector on operator feedback. Injectable; defaults to the real helper. */
  rerunReflector: RerunReflectorFn;
};

// ---------------------------------------------------------------------------
// R6-06 WI-1 — agent run-history ledger (GET /api/agents/:slug/history) +
// the shared standalone-run status/cost derivation it reuses from the
// pre-existing GET /api/agents/runs/<runId> route (D3.5/shared-derivation:
// ONE function, never two independently-written copies that can drift).
// ---------------------------------------------------------------------------








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

  if (await dispatchRoute(ctx.routeTable, req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot, readBody: () => readJson(req) }, url, method)) return; // M4 §4 step 2 — carved tables win over legacy arms; `url` stays RAW; `readBody` hands down the RESULT of the host's body policy (CSRF checked just above), never the policy itself (ruling 30)
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
  // SURFACES the stall to the operator (see docs/reference/serve-supervision.md).
  if (method === 'GET' && url === '/api/liveness') {
    sendJson(res, 200, ctx.liveness(), origin);
    return;
  }
  // forge-4zk: the events/cost/graph/work-item/artifact GET family carved to
  // `./bridge-cycle-data.ts` (feature move, no behaviour change).
  if (await handleCycleDataRoutes(req, res, { logsRoot: ctx.logsRoot, forgeRoot: ctx.forgeRoot }, url, method)) return;

  // ---- Architect (ADR 020) ----------------------------------------------
  if (await handleArchitect(req, res, ctx, url, method)) return;
  if (await handleReflect(req, res, ctx, url, method)) return;
  // ---- Studio read routes (M1-2) + write routes (M2-2) -------------------
  // DEC-6 recovery surface (GET inspect + POST abandon/requeue/initiatives). GET is
  // read-only; the POSTs are gated by the x-forge-csrf guard above.
  if (await handleRecoveryRoutes(req, res, { forgeRoot: ctx.forgeRoot, queueRoot: ctx.queueRoot, logsRoot: ctx.logsRoot, projectsRoot: ctx.projectsRoot, readBody: () => readJson(req) }, url, method)) return;
  if (await handleStudioRoutes(req, res, {
    forgeRoot: ctx.forgeRoot,
    logsRoot: ctx.logsRoot,
    // W8-F6 (bead forge-6gv.27) — this file is the one place that imports BOTH
    // apps/forge/bridge-studio.ts and packages/sessions/bridge-studio-sessions.ts, so it wires the
    // readability predicate in rather than letting the runs routes import it
    // and close a module cycle. Same seam, same reason, as `ensureSessionTail`.
    sessionIsReadable: ({ kind, sessionId }) => sessionIsReadable({
      projectsRoot: ctx.projectsRoot, logsRoot: ctx.logsRoot, kind, sessionId,
    }),
  }, url, method)) return;
  if (await handleStudioWriteRoutes(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method)) return;
  // M4 §4 step 2 — skills (7 routes), hooks (8), authoring (1) and templates (5)
  // were dispatched here in this order. All 21 are entries in
  // `packages/library/routes.ts` now and the table dispatch at :2094 claims them
  // BEFORE this chain is reached, so nothing dispatches them but that table.
  // W6-B2 — the generic session-detail GET is the ONLY read route authoring
  // and kb-cleanup sessions have (no per-kind list route like architect/
  // instructions/demo-builder/project-brain); ensureSessionTail must be
  // threaded through here to close bd forge-2ee's "no consumer reads the
  // authoring spine's events dir" half.
  // W6-B11 — the aggregate sessions-index GET. Checked before the
  // single-session route immediately below: distinct URL shapes (no path
  // segments vs exactly two), so ordering doesn't affect matching, but this
  // keeps the two GET /api/studio/sessions... routes textually adjacent.
  // M4 §4 step 2 — GET /api/studio/sessions/:kind/:id carved to packages/sessions/routes.ts.
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
  // M4 §4 step 2 — POST …/:id/cancel and the generic session-affordance WRITE
  // endpoint (…/:kind/:sessionId/:affordance) are both carved to
  // packages/sessions/routes.ts; cancel's entry precedes the affordance's,
  // whose matcher would otherwise claim the cancel URL.
  // M4 §4 step 2 — carved to packages/library/routes.ts; the table dispatch above already claimed this route.
  // W6-B6 fix — the per-slug capability route, resolved against the
  // UNFILTERED agent defs (bypasses the library:false roster gate
  // /api/studio/agents applies). Adjacent to the instructions-draft route:
  // same /api/studio/agents/:slug/... URL family, same guarded-path posture.
  // M4 §4 step 2 — carved to packages/sessions/routes.ts.
  // M4 §4 step 2 — connections (4 routes) and community (5) dispatched here, last
  // of the seven. Both are in `packages/library/routes.ts` now.
  // ---- Studio POST write routes (M3-4): run start/resume + gate verdicts --
  const studioPostCtx: StudioPostContext = {
    readBody: () => readJson(req),
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

  // forge-4zk: the scheduler-lifecycle family carved to `./bridge-scheduler.ts`
  // (feature move, no behaviour change).
  if (await handleSchedulerRoutes(req, res, { forgeRoot: ctx.forgeRoot, queueRoot: ctx.queueRoot, logsRoot: ctx.logsRoot }, url, method)) return;

  // forge-4zk: the develop/plan/flow run-trigger family carved to
  // `./bridge-run-triggers.ts` (feature move, no behaviour change).
  if (await handleRunTriggerRoutes(req, res, { forgeRoot: ctx.forgeRoot, queueRoot: ctx.queueRoot }, url, method)) return;

  // forge-4zk: the review-comments + verdict family carved to
  // `./bridge-review-comments.ts` (feature move, no behaviour change).
  if (await handleReviewCommentRoutes(req, res, studioPostCtx, url, method)) return;

  res.writeHead(404);
  res.end();
}

// forge-4zk: the architect spawn machinery + the one remaining architect
// route (POST /api/plan-verdict) carved to `./bridge-agent-dispatch.ts`
// (feature move, no behaviour change).

// forge-4zk: the reflection routes carved to `./bridge-reflect.ts` (feature
// move, no behaviour change). readJson itself moved to `./bridge-http.ts`
// (forge-4zk follow-up) — the ONE implementation every bridge module now
// shares, instead of a same-directory mirror.

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
