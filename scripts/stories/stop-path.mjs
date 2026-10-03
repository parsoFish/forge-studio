/**
 * stop-path.mjs — what a SIGINT/SIGTERM mid-run does, in order. Row 187
 * (forge-8vfn.8.5.23); row 213 (forge-8vfn.8.5.49).
 *
 * MEASURED, run 4: after a SIGINT to the story runner, S10's architect turn —
 * spawned by the bridge (`spawnAgentTurn`, `apps/forge/bridge-agent-dispatch.ts`:
 * `detached: true`, `proc.unref()`, its own process group, its pid in
 * `_logs/_architect-<sid>/turn.pid`) — outlived the runner AND the bridge and
 * wrote `projects/gitpulse/_architect/<sid>/…` into the REAL ground seven
 * minutes later, after this path's capture+clear (#1060) had already run. A
 * group kill of the BRIDGE cannot reach it: detached means its own group.
 * MEASURED, run 5: the bridge itself took ~20 s to exit after its group
 * SIGTERM, while the stop path had long since declared itself done.
 *
 * ROW 213, A THIRD DETACHED SURVIVOR — MEASURED. A costed run killed mid-S10
 * left `forge serve` itself alive (pid 3470777, ppid 1, cwd the run tree,
 * started by `packages/flows/daemon.ts`'s `spawnServeDetached`: `detached:
 * true`, `unref()`, its OWN process group, its pid in `_logs/daemon/forge.pid`
 * — `sweep-teardown-scheduler.mjs`'s `DAEMON_PID_FILE`). A group kill of the
 * BRIDGE cannot reach it either, for the identical reason the architect turn
 * above survived one: `detached` means its own group, never a child of
 * anything this path's bridge-group SIGTERM touches. After this path's own
 * sweep had already run, that daemon REWROTE
 * `_queue/in-flight/<id>.md.heartbeat` and RECREATED `_worktrees/wi/<id>/` —
 * two hours of a "stopped" run still writing into the tree the sweep had just
 * declared clear.
 *
 * THE ORDER IS THE RULE:
 *  1. SIGTERM the bridge's group — first, so nothing spawns a new turn;
 *  2. reap every agent turn this run dispatched (`collectAgentRuns` +
 *     `reapAgentRuns`, the SAME pair the run-end abort backstop uses):
 *     SIGTERM, a bounded grace, then SIGKILL the survivors;
 *  3. stop the scheduler daemon THIS RUN started (row 213) — `stopOwnScheduler`
 *     (`sweep-teardown-scheduler.mjs`), the SAME ownership test and TERM/
 *     grace/KILL sequence the normal run-end sweep already uses, reused here
 *     rather than a second pid-finding path. It signals ONLY a pid whose pid
 *     file lives under THIS run's `root` AND whose own cwd resolves back to
 *     that same root — never a pid file read from another tree, and never a
 *     pid already confirmed dead;
 *  4. wait for the bridge's group to exit, bounded, escalating to SIGKILL;
 *  5. immediately before the clear, re-check that nothing this run started is
 *     still alive — the bridge group, every agent turn `collectAgentRuns`
 *     found, and the scheduler daemon. A survivor is named on its own
 *     STILL-ALIVE line and the sweep still runs — the same "name it and
 *     proceed" shape the batch-end teardown already uses for a census that
 *     cannot settle (`sweep-teardown.mjs`'s own header) — because this path
 *     cannot wait out a dispatch it does not own, and a silent CLEARED over a
 *     live writer is the defect row 213 itself measured;
 *  6. only then `clear()` — the post-stop sweep and own-ground capture+clear —
 *     against a tree nothing THIS PATH still believes is being written to;
 *  7. ONE re-read, after a short bounded settle, of exactly the paths the
 *     sweep itself reported cleared (never a fresh glob, never a loop) — a
 *     writer this run failed to reap rewriting one of them is named as a
 *     WRITER-AFTER-SWEEP finding, the same shape the batch-end teardown's own
 *     re-read already reports (`sweep-teardown.mjs`'s `reappeared` /
 *     `reappearedArtefacts`).
 *
 * SYNCHRONOUS WAITS, on purpose. The handler used to be fully synchronous and
 * end in `process.exit`, so no beat could run underneath it. The reap is
 * async by signature; every sleep here is an `Atomics.wait` returning an
 * already-resolved promise, so the whole path completes without yielding to
 * the event loop — the story's own beats never resume mid-teardown.
 * The one cost is that a CHILD of this process cannot be reaped by libuv
 * meanwhile, so the bridge wait reads `/proc` state and counts a zombie as
 * exited (it has: only its exit status is left). `stopOwnScheduler` is
 * ALREADY built this way (its own `waitForExit` blocks on `Atomics.wait`), so
 * calling it here adds no second waiting style.
 * (Row 184b, kept: before #1060 a signal never touched the bridge at all and
 * it held 4123/4124 for up to ten minutes, refusing the next run's boot.)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { killBridgeProcessGroup } from './bridge.mjs';
import { collectAgentRuns, reapAgentRuns, describeReap } from './reap.mjs';
import { DAEMON_PID_FILE, DRAIN_GRACE_MS, stopOwnScheduler, isRunning } from './sweep-teardown-scheduler.mjs';

/** How long the bridge's group gets to exit on its own SIGTERM (run 5 measured ~20 s). */
export const BRIDGE_EXIT_BOUND_MS = 30_000;
/** After SIGKILL, how long before the path stops waiting and says so. */
const BRIDGE_KILL_GRACE_MS = 5_000;
const POLL_MS = 100;
/**
 * ROW 213 — how long the scheduler daemon THIS RUN started gets to drain
 * before SIGKILL, on the stop path. The SAME bound `stopOwnScheduler`'s own
 * default already gives it on a normal run end (`DRAIN_GRACE_MS`,
 * `sweep-teardown-scheduler.mjs`) — a mid-run stop is no more trigger-happy
 * with a daemon's own in-flight cycle than a clean run end already is.
 */
export const SCHEDULER_STOP_GRACE_MS = DRAIN_GRACE_MS;
/**
 * ROW 213 — how long, after `clear()` returns, this path waits before
 * re-reading exactly the paths the sweep itself reported cleared. Bounded and
 * SINGLE: one settle, one re-read, never a loop (see this file's own header
 * on synchronous, bounded waits).
 */
export const WRITER_REREAD_DELAY_MS = 500;

const SLEEPER = new Int32Array(new SharedArrayBuffer(4));
/** Block this thread for `ms` without yielding to the event loop. */
export function sleepSync(ms) {
  Atomics.wait(SLEEPER, 0, 0, ms);
}

/** Live (non-zombie) members of process group `pgid`, read from `/proc`. */
export function liveGroupMembers(pgid) {
  const out = [];
  let pids;
  try {
    pids = readdirSync('/proc').filter((n) => /^\d+$/.test(n));
  } catch {
    return null; // unknown — never folded into "empty"
  }
  for (const name of pids) {
    let raw;
    try {
      raw = readFileSync(`/proc/${name}/stat`, 'utf8');
    } catch {
      continue; // exited between the listing and the read
    }
    const [state, , pgrp] = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    if (Number(pgrp) === pgid && state !== 'Z') out.push(Number(name));
  }
  return out;
}

/** Poll until the group has no live member or `boundMs` passes. */
function waitGroupGone(pgid, boundMs, membersOf, sleep) {
  const steps = Math.max(1, Math.ceil(boundMs / POLL_MS));
  for (let i = 0; i <= steps; i += 1) {
    const live = membersOf(pgid);
    if (live !== null && live.length === 0) return { gone: true, waitedMs: i * POLL_MS };
    if (i < steps) sleep(POLL_MS);
  }
  return { gone: false, waitedMs: steps * POLL_MS };
}

/**
 * @param {object} input
 * @param {string} input.root this run's own worktree
 * @param {number} input.startedMs this run's own start — the reap's window
 * @param {{pid: number}|null} input.bridgeProc the bridge THIS run booted
 * @param {() => ({cleared?: string[]}|void)} input.clear the post-stop sweep +
 *   own-ground capture+clear; may optionally return the root-relative paths it
 *   cleared, for row 213's own re-read below
 * @param {(line: string) => void} [input.log]
 * @param {number} [input.bridgeExitBoundMs]
 * @param {number} [input.schedulerGraceMs] row 213
 * @param {typeof stopOwnScheduler} [input.stopScheduler] row 213, a seam
 * @param {number} [input.rereadDelayMs] row 213
 * @param {(pid: number) => boolean} [input.isAlive] row 213, a seam
 * @returns {Promise<{reap: object|null, bridge: {gone: boolean, waitedMs: number, signal: string}|null,
 *   sched: object, survivors: string[], reappeared: string[]}>}
 */
export async function runStopPath({
  root, startedMs, bridgeProc, clear, log = (l) => console.log(l),
  bridgeExitBoundMs = BRIDGE_EXIT_BOUND_MS, membersOf = liveGroupMembers, sleep = sleepSync,
  schedulerGraceMs = SCHEDULER_STOP_GRACE_MS, stopScheduler = stopOwnScheduler,
  rereadDelayMs = WRITER_REREAD_DELAY_MS, isAlive = isRunning,
}) {
  if (bridgeProc !== null) {
    log(`[stories] post-stop sweep: signalling this run's own bridge (pid ${bridgeProc.pid}) and its process group`);
    killBridgeProcessGroup(bridgeProc, 'SIGTERM');
  }
  // Collected once, ahead of the reap — row 213's own writer re-check below
  // re-reads the SAME list rather than asking `collectAgentRuns` a second
  // time, so a dir that mutated between the two reads cannot disagree with
  // itself.
  const collected = collectAgentRuns(root, startedMs);
  let reap = null;
  try {
    reap = await reapAgentRuns(collected, {
      ownRoot: root,
      // A stopped run is not waiting to price anything: the row-62 grace
      // would hold a turn that is writing into the ground for up to 30 s.
      pricedGraceMs: 0,
      sleep: (ms) => { sleep(ms); return Promise.resolve(); },
    });
    for (const line of describeReap(reap)) log(`[stories] post-stop sweep: ${line}`);
  } catch (err) {
    log(`[stories] post-stop sweep: reaping this run's agent turns FAILED: ${err?.message ?? err}`);
  }

  // ROW 213 (forge-8vfn.8.5.49) — the scheduler daemon THIS RUN started
  // (`spawnServeDetached`, `packages/flows/daemon.ts`) is `detached: true` and
  // `unref()`d into ITS OWN process group, so the bridge-group SIGTERM above
  // can never reach it. `stopOwnScheduler` is the SAME ownership test (pid
  // file under `root`, cwd resolves back to `root`) plus TERM/grace/KILL
  // sequence the normal run-end sweep already uses — reused here rather than
  // a second pid-finding path. It never signals a pid file read from another
  // root, and never signals a pid already confirmed dead (see its own header
  // in `sweep-teardown-scheduler.mjs`).
  log(`[stories] post-stop sweep: checking for a scheduler daemon this run started (${DAEMON_PID_FILE})`);
  const sched = stopScheduler(root, schedulerGraceMs);
  if (sched.unknown) {
    log(`[stories] post-stop sweep: scheduler daemon state UNKNOWN — ${sched.note}`);
  } else if (sched.stopped !== null) {
    log(
      `[stories] post-stop sweep: stopped this run's own scheduler daemon — pid ${sched.stopped} by ` +
        `${sched.drained ? `${sched.how}, drained` : `${sched.how}, DID NOT DRAIN`}`,
    );
    if (sched.note !== null) log(`[stories] post-stop sweep: scheduler: ${sched.note}`);
  } else if (sched.note !== null) {
    log(`[stories] post-stop sweep: scheduler: ${sched.note}`);
  } else {
    log('[stories] post-stop sweep: no scheduler daemon recorded for this run');
  }

  let bridge = null;
  if (bridgeProc !== null) {
    bridge = { ...waitGroupGone(bridgeProc.pid, bridgeExitBoundMs, membersOf, sleep), signal: 'SIGTERM' };
    if (!bridge.gone) {
      killBridgeProcessGroup(bridgeProc, 'SIGKILL');
      const after = waitGroupGone(bridgeProc.pid, BRIDGE_KILL_GRACE_MS, membersOf, sleep);
      bridge = { gone: after.gone, waitedMs: bridge.waitedMs + after.waitedMs, signal: 'SIGKILL' };
    }
    log(
      `[stories] post-stop sweep: bridge group ${bridgeProc.pid} ` +
        (bridge.gone ? `exited after ${bridge.waitedMs} ms (${bridge.signal})` : `STILL ALIVE after ${bridge.waitedMs} ms and a SIGKILL`),
    );
  }

  // ROW 213 — immediately before the clear, re-check that nothing this run
  // started is still alive: the bridge group, every agent turn `collectAgentRuns`
  // found, and the scheduler daemon. A survivor does not stop the sweep — the
  // same "name it and proceed" shape the batch-end teardown already uses for a
  // census that cannot settle — but it must never be folded into a silent
  // CLEARED.
  const survivors = [];
  if (bridgeProc !== null) {
    const live = membersOf(bridgeProc.pid);
    if (live === null || live.length > 0) survivors.push(`bridge group ${bridgeProc.pid}`);
  }
  for (const { dir, pid } of collected) {
    if (typeof pid === 'number' && pid > 0 && isAlive(pid)) survivors.push(`agent turn pid ${pid} (${dir})`);
  }
  if (sched.stopped !== null && isAlive(sched.stopped)) survivors.push(`scheduler daemon pid ${sched.stopped}`);
  for (const who of survivors) {
    log(`[stories] post-stop sweep: STILL ALIVE before the clear: ${who} — proceeding with the sweep anyway`);
  }

  const clearResult = clear();

  // ROW 213 — ONE re-read, after a short bounded settle, of exactly the paths
  // the sweep itself reported cleared (never a fresh glob, never a loop — see
  // this file's own header). A writer this run failed to reap rewriting
  // `_queue/in-flight/<id>.md.heartbeat` or recreating `_worktrees/wi/<id>` is
  // named here, the same shape the batch-end teardown's own re-read already
  // reports (`sweep-teardown.mjs`'s `reappeared` / `reappearedArtefacts`).
  const clearedPaths = Array.isArray(clearResult?.cleared) ? clearResult.cleared : [];
  const reappeared = [];
  if (clearedPaths.length > 0) {
    sleep(rereadDelayMs);
    for (const rel of clearedPaths) {
      if (existsSync(join(root, rel))) {
        reappeared.push(rel);
        log(
          `[stories] post-stop sweep: WRITER AFTER SWEEP: ${rel} reappeared after the sweep reported it ` +
            'cleared — a writer this run did not reap survived it',
        );
      }
    }
  }

  return { reap, bridge, sched, survivors, reappeared };
}
