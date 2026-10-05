/**
 * scheduler-preflight.mjs — refuse a run whose cost ceiling would bind
 * NOTHING, because a scheduler is already up.
 *
 * GAP `forge-8vfn.8.1.6` (T1 row 6), follow-up finding. `bridgeSpawnOptions`
 * carries the run's effective ceiling on the BRIDGE process `bootOwnBridge`
 * spawns (`bridge.mjs`) — the `forge studio` process whose own supervisor
 * (`apps/forge/serve-supervisor.ts`) brings `forge serve` up at boot the same
 * way it brings up the bridge and the UI (ADR 011). That supervisor's boot
 * step ADOPTS a live pid when `daemonPaths(forgeRoot).pidFile` already names
 * one alive per `isAlive` — supervising it, spawning nothing — and only
 * SPAWNS a fresh `forge serve` (`spawnServeDetached`, `packages/flows/
 * daemon.ts`, inheriting this run's env, ceiling included) when the pid file
 * names none. So a LEFTOVER `forge serve` from an earlier run (or an
 * operator's own) keeps its own, already-fixed env across the adopt, and
 * this run's `--ceiling` binds nothing at all — silently, because the daemon
 * is already claiming queued work; studio just never touched its env. This
 * module closes that gap at the runner's own preflight, before `forge
 * studio` ever boots.
 *
 * `run.mjs` runs under plain `node` (no `--experimental-strip-types`), so it
 * cannot import `packages/flows/daemon.ts` directly — the same constraint
 * `sweep-teardown.mjs`'s own `DAEMON_PID_FILE` doc comment records. This
 * module REUSES, never reinvents, the pid file and liveness read this runner
 * already established and tests against the product's own pid file:
 * `DAEMON_PID_FILE` and `isRunning` from `sweep-teardown.mjs`
 * (`sweep-teardown.test.ts`'s `657(ii)` binds `DAEMON_PID_FILE` to the
 * product's own `daemonPaths` by test).
 *
 * `isRunning` reads `/proc/<pid>/stat` rather than `daemon.ts`'s own
 * `kill(pid, 0)`-based `isAlive` — NOT a looser check: it is the MORE
 * conservative of the two (a zombie, or any unreadable `/proc` entry other
 * than a genuine `ENOENT`, reads as "still running", never as gone — see its
 * own header in `sweep-teardown.mjs`), which is the safe direction for a
 * REFUSAL: this function must never wrongly say "clear" and let a live,
 * ceiling-less scheduler through.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAEMON_PID_FILE, isRunning } from './sweep-teardown-scheduler.mjs';

/**
 * Is there ALREADY a live `forge serve` recorded for this tree? `run.mjs`
 * asks before every run, costed or costless: the run's own studio would
 * adopt that serve, and it would claim this ground's queue under an env the
 * run never set.
 *
 * @param {string} root the run's own worktree
 * @returns {{ok: boolean, reason: string}}
 */
export function preexistingSchedulerVerdict(root) {
  const pidFile = join(root, DAEMON_PID_FILE);
  let raw;
  try {
    raw = readFileSync(pidFile, 'utf8').trim();
  } catch {
    return Object.freeze({ ok: true, reason: `no ${DAEMON_PID_FILE} — no scheduler recorded` });
  }
  const pid = Number.parseInt(raw, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return Object.freeze({
      ok: true,
      reason: `${DAEMON_PID_FILE} held ${JSON.stringify(raw)}, which is not a pid — treated as none`,
    });
  }
  if (!isRunning(pid)) {
    return Object.freeze({
      ok: true,
      reason: `${DAEMON_PID_FILE} names pid ${pid}, which is not running — stale, not refused`,
    });
  }
  return Object.freeze({
    ok: false,
    reason:
      `a scheduler is already running (pid ${pid}, from ${DAEMON_PID_FILE}) — a scheduler already ` +
      "running would not inherit this run's cost ceiling: spawnServeDetached (packages/flows/daemon.ts) " +
      "starts nothing new while that pid is alive, so this run's bridge would carry a ceiling nothing " +
      'ever reads. Stop it, or run from a lane with none, then re-run.',
  });
}
