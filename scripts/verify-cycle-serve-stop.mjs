/**
 * verify-cycle-serve-stop.mjs — stop the `forge serve` a spawned Studio caused
 * to start, by its RECORDED pid (bead forge-8vfn.30.5).
 *
 * INCIDENT. verify-cycle's teardown SIGTERM'd Studio's process group, but
 * `forge serve` is spawned detached (its own group, apps/forge serve-supervisor
 * → packages/flows/daemon.ts `spawnServeDetached`), so it survived orphaned
 * (ppid 1) and kept running the developer agent after the gate had already
 * written FAIL.
 *
 * RULES. The pid comes from `_logs/daemon/forge.pid` (where serve records it,
 * `daemonPaths`), never from a name or pattern search — no pkill, no pgrep -f.
 * Before every signal the pid is re-verified against /proc: its cmdline must be
 * a `forge serve` (`cli.ts` … `serve`) and it must have STARTED at/after
 * `notBeforeMs` (the run's start), so a recycled pid or a serve that predates
 * this run is REFUSED, not killed. An absent/unreadable pid file is UNKNOWN —
 * named, never guessed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The pid `forge serve` recorded, or UNKNOWN with the reason. Never throws. */
export function snapshotServe({ forgeRoot }) {
  const pidFile = join(forgeRoot, '_logs', 'daemon', 'forge.pid');
  let raw;
  try {
    raw = readFileSync(pidFile, 'utf8').trim();
  } catch (err) {
    return { status: 'UNKNOWN', reason: `forge.pid absent or unreadable at ${pidFile} (${err.code ?? err.message}) — not guessing which process is the serve` };
  }
  const pid = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || !Number.isInteger(pid) || pid <= 1) {
    return { status: 'UNKNOWN', reason: `forge.pid at ${pidFile} does not hold a pid ("${raw.slice(0, 40)}") — not guessing` };
  }
  return { status: 'RECORDED', pid };
}

function readCmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter((a) => a !== '');
  } catch {
    return null;
  }
}

/** A `forge serve` argv: some arg ends in `cli.ts` and the last arg is `serve`. */
export function isForgeServeCmdline(args) {
  return Array.isArray(args) && args.length > 1 && args.at(-1) === 'serve' && args.some((a) => a.endsWith('cli.ts'));
}

/** Process start as epoch ms (btime + starttime/CLK_TCK), or null if unreadable. */
export function procStartedAtMs(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
    const btime = Number(/^btime\s+(\d+)/m.exec(readFileSync('/proc/stat', 'utf8'))?.[1]);
    const clk = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
    if (![ticks, btime, clk].every((n) => Number.isFinite(n) && n > 0)) return null;
    return btime * 1000 + (ticks / clk) * 1000;
  } catch {
    return null;
  }
}

/** Re-verify `pid` is the serve this run caused. Returns null if OK, else the refusal reason. */
function refusalFor(pid, notBeforeMs) {
  const args = readCmdline(pid);
  if (args === null) return 'process already gone';
  if (!isForgeServeCmdline(args)) return `cmdline of pid ${pid} is not a forge serve (recycled pid?) — refusing to signal`;
  const startedAt = procStartedAtMs(pid);
  if (startedAt === null) return `start time of pid ${pid} unreadable — refusing to signal`;
  // 1s slack: /proc start time has clock-tick granularity.
  if (startedAt < notBeforeMs - 1000) return `serve pid ${pid} started before this run — not one it caused; refusing to signal`;
  return null;
}

/**
 * SIGTERM the recorded serve, wait, SIGKILL if still there — re-verifying
 * identity before EACH signal. Returns { status: STOPPED | REFUSED | UNKNOWN |
 * FAILED, reason? }. 'process already gone' counts as STOPPED.
 */
export async function stopRecordedServe(snapshot, { notBeforeMs, termWaitMs = 1500, sleep = defaultSleep, kill = process.kill } = {}) {
  if (snapshot.status !== 'RECORDED') return { status: 'UNKNOWN', reason: snapshot.reason };
  const { pid } = snapshot;
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    const refusal = refusalFor(pid, notBeforeMs);
    if (refusal === 'process already gone') return { status: 'STOPPED', pid };
    if (refusal) return { status: 'REFUSED', pid, reason: refusal };
    try {
      kill(pid, sig);
    } catch (err) {
      return { status: 'FAILED', pid, reason: `${sig} to pid ${pid}: ${err.message}` };
    }
    await sleep(sig === 'SIGTERM' ? termWaitMs : 200);
    if (readCmdline(pid) === null) return { status: 'STOPPED', pid, signal: sig };
  }
  return { status: 'FAILED', pid, reason: `pid ${pid} still present after SIGKILL` };
}
