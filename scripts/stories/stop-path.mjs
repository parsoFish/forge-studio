/**
 * stop-path.mjs — what a SIGINT/SIGTERM mid-run does, in order. Row 187
 * (forge-8vfn.8.5.23).
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
 * THE ORDER IS THE RULE:
 *  1. SIGTERM the bridge's group — first, so nothing spawns a new turn;
 *  2. reap every agent turn this run dispatched (`collectAgentRuns` +
 *     `reapAgentRuns`, the SAME pair the run-end abort backstop uses):
 *     SIGTERM, a bounded grace, then SIGKILL the survivors;
 *  3. wait for the bridge's group to exit, bounded, escalating to SIGKILL;
 *  4. only then `clear()` — the post-stop sweep and own-ground capture+clear —
 *     against a tree nothing is still writing to.
 *
 * SYNCHRONOUS WAITS, on purpose. The handler used to be fully synchronous and
 * end in `process.exit`, so no beat could run underneath it. The reap is
 * async by signature; every sleep here is an `Atomics.wait` returning an
 * already-resolved promise, so the whole path completes without yielding to
 * the event loop — the story's own beats never resume mid-teardown.
 * The one cost is that a CHILD of this process cannot be reaped by libuv
 * meanwhile, so the bridge wait reads `/proc` state and counts a zombie as
 * exited (it has: only its exit status is left).
 * (Row 184b, kept: before #1060 a signal never touched the bridge at all and
 * it held 4123/4124 for up to ten minutes, refusing the next run's boot.)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { killBridgeProcessGroup } from './bridge.mjs';
import { collectAgentRuns, reapAgentRuns, describeReap } from './reap.mjs';

/** How long the bridge's group gets to exit on its own SIGTERM (run 5 measured ~20 s). */
export const BRIDGE_EXIT_BOUND_MS = 30_000;
/** After SIGKILL, how long before the path stops waiting and says so. */
const BRIDGE_KILL_GRACE_MS = 5_000;
const POLL_MS = 100;

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
 * @param {() => void} input.clear the post-stop sweep + own-ground capture+clear
 * @param {(line: string) => void} [input.log]
 * @param {number} [input.bridgeExitBoundMs]
 * @returns {Promise<{reap: object|null, bridge: {gone: boolean, waitedMs: number, signal: string}|null}>}
 */
export async function runStopPath({
  root, startedMs, bridgeProc, clear, log = (l) => console.log(l),
  bridgeExitBoundMs = BRIDGE_EXIT_BOUND_MS, membersOf = liveGroupMembers, sleep = sleepSync,
}) {
  if (bridgeProc !== null) {
    log(`[stories] post-stop sweep: signalling this run's own bridge (pid ${bridgeProc.pid}) and its process group`);
    killBridgeProcessGroup(bridgeProc, 'SIGTERM');
  }
  let reap = null;
  try {
    reap = await reapAgentRuns(collectAgentRuns(root, startedMs), {
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
  clear();
  return { reap, bridge };
}
