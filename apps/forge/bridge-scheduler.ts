/**
 * bridge-scheduler — the daemon lifecycle routes on the bridge.
 *
 * forge-4zk: carved out of `apps/forge/ui-bridge.ts` (feature move, no
 * behaviour change).
 *
 *   GET  /api/scheduler/status  → { ...daemonState }
 *   POST /api/scheduler/start   → start the detached `forge serve` daemon
 *   POST /api/scheduler/pause   → set the `.paused` queue flag
 *   POST /api/scheduler/resume  → clear the `.paused` queue flag
 *   POST /api/scheduler/stop    → SIGTERM the daemon (idempotent while draining)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson, allowedOrigin } from '@forge/kernel';
import { isDryBridge, refuseDryBridge } from '@forge/kernel';
import { daemonState, setPaused, readPid, isAlive, clearPidFile, daemonPaths, spawnServeDetached, markStopping } from '@forge/flows/daemon.ts';

/** The context the scheduler lifecycle routes need from the host. */
export type SchedulerContext = {
  forgeRoot: string;
  queueRoot: string;
  logsRoot: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The scheduler-lifecycle POST/GET family. Dispatched from `handleHttp` after
 * the Studio POST write routes and before the develop/plan/flow run triggers
 * — same position the arms held inline. Returns `false` on no match
 * (passthrough to the next handler).
 */
export async function handleSchedulerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: SchedulerContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);

  // Scheduler lifecycle.
  if (method === 'GET' && url === '/api/scheduler/status') {
    const state = daemonState(ctx.forgeRoot, ctx.queueRoot);
    sendJson(res, 200, state, origin);
    return true;
  }
  if (method === 'POST' && url === '/api/scheduler/start') {
    if (isDryBridge()) {
      refuseDryBridge(res, origin, { route: '/api/scheduler/start', method, action: 'daemon', logsRoot: ctx.logsRoot });
      return true;
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
        return true;
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
    return true;
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
    return true;
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
      return true;
    }
    try {
      const { pidFile, stoppingFile } = daemonPaths(ctx.forgeRoot);
      const pid = readPid(pidFile);
      if (pid === null || !isAlive(pid)) {
        clearPidFile(ctx.forgeRoot);
        sendJson(res, 200, { ok: true, alreadyStopped: true, state: daemonState(ctx.forgeRoot, ctx.queueRoot) }, origin);
        return true;
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
        return true;
      }
      process.kill(pid, 'SIGTERM');
      markStopping(ctx.forgeRoot, pid);
      sendJson(res, 200, { ok: true, stopping: true, state: daemonState(ctx.forgeRoot, ctx.queueRoot) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  return false;
}
