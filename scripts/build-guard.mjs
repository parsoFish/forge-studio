#!/usr/bin/env node
/**
 * build-guard — the BUILD's half of the symmetric lock refusal.
 * Bead `forge-8vfn.7.6.100`, T1 969/975a, found by lane A with $9 in flight.
 *
 * THE HOLE, AS A TABLE. §15.515 says a lock order is ruled against three
 * columns — who TAKES a lock, who WAITS on it, and who REFUSES UNDER it — and
 * the campaign had run those columns for `npm test` and never for builds:
 *
 *     a story run      .suite-lock REFUSES UNDER   .run-lock takes
 *     a gate's test    .suite-lock takes           .run-lock REFUSES UNDER
 *     a gate's build   .suite-lock takes           .run-lock  — nothing —
 *
 * 943 made every ad-hoc build take the suite-lock, which serialises builds
 * against EACH OTHER. Nothing serialised a build against a funded story run —
 * and `gate.sh` runs `npm run build` BEFORE its `npm test`, so the heaviest
 * single job on the box was free to start beside a run costing real money. A
 * measured it at `MemAvailable` 5.0 GiB with the kernel's watchdog already
 * culling processes.
 *
 * IT WAITS RATHER THAN REFUSING, AND THAT IS THE ONE PLACE IT DIFFERS FROM
 * `test-guard`. §15.335 puts the waiting in the caller because a story runner
 * has a Monitor watching it; a build inside `gate.sh` has no per-step waiter,
 * so an instant refusal would red a gate for a condition that clears itself.
 * The wait is 947's shape — acquire and IMMEDIATELY release, never hold — so
 * this can never become the contention it is measuring. Bounded, then exit 3:
 * REFUSED/UNKNOWN, never red, because "I could not start" and "I ran and failed"
 * are different facts (§15.504).
 *
 * THE HOLDER IS PRINTED WHILE WAITING, not only at the bound. A guard that
 * blocks silently for thirty minutes is indistinguishable from a hung one —
 * which is exactly the forty minutes A lost reading a hung door as contention.
 *
 * NOTHING IMPORTABLE MAY LIVE IN THIS FILE: importing it RUNS it, and inside a
 * build with `FORGE_RUN_LOCK` set that import would block or exit. Same hazard
 * `test-guard.mjs` records; the shared pieces live in `lock-guard.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { runLockVerdict, lockHolders, EXIT_LOCK_REFUSED } from './stories/lock-guard.mjs';

/** The bound, and the interval between saying so. Both overridable so a caller
 *  can state a different budget rather than edit this file. */
const BOUND_MS = Number.parseInt(process.env.FORGE_BUILD_LOCK_WAIT_MS ?? '', 10) || 30 * 60 * 1000;
const SAY_EVERY_MS = Number.parseInt(process.env.FORGE_BUILD_LOCK_SAY_MS ?? '', 10) || 60 * 1000;

const lockPath = process.env.FORGE_RUN_LOCK ?? '';

/** 947's shape: take it only to prove it is free, and let go in the same call. */
function runLockFree() {
  return spawnSync('flock', ['-w', '0', lockPath, 'true'], { stdio: 'ignore' }).status === 0;
}

function who() {
  const holders = lockHolders(lockPath);
  if (holders === null) return 'holder UNREADABLE';
  if (holders.length === 0) return 'held, holder unnameable (inherited fd)';
  return holders.map((h) => `pid ${h.pid} (cwd ${h.cwd ?? '?'})`).join(', ');
}

const verdict = runLockVerdict();
if (verdict.ok) {
  // The not-configured and the clear cases both SAY so: a guard silent when it
  // is not enforcing cannot be told from one that checked.
  console.log(`[build-guard] ${verdict.reason}`);
  process.exit(0);
}

const startedAt = Date.now();
console.error(`[build-guard] WAITING on ${lockPath} — ${who()}; since ${new Date(startedAt).toISOString()}, bound ${Math.round(BOUND_MS / 60000)}m. A build is the heaviest job on this box and a story run is spending money (forge-8vfn.7.6.100).`);

let saidAt = startedAt;
while (Date.now() - startedAt < BOUND_MS) {
  if (runLockFree()) {
    console.log(`[build-guard] ${lockPath} free after ${Math.round((Date.now() - startedAt) / 1000)}s — proceeding`);
    process.exit(0);
  }
  if (Date.now() - saidAt >= SAY_EVERY_MS) {
    saidAt = Date.now();
    console.error(`[build-guard] still WAITING ${Math.round((saidAt - startedAt) / 1000)}s — ${who()}`);
  }
  spawnSync('sleep', ['2']);
}
console.error(`[build-guard] WAITED-OUT .run-lock ${Math.round(BOUND_MS / 1000)}s — ${who()}. Nothing was held while waiting; this build did not run and this is NOT a red (§15.504).`);
process.exit(EXIT_LOCK_REFUSED);
