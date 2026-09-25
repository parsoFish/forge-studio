/**
 * sweep-teardown-plant.mjs — real-process plants for `sweep-teardown.test.ts`,
 * split out the same way `reap-plant.mjs` is split from `reap.test.ts`: a
 * fixed `await new Promise((r) => setTimeout(r, N))` before relying on a
 * planted process's behaviour is a GUESS about how long spawning, loading
 * node and registering a signal handler takes, and a guess is exactly what a
 * shared, contended host defeats.
 *
 * MEASURED, NOT SUPPOSED (T1 1372, RP's own flake register). A 10-run repro
 * under `taskset -c 0` plus three trap-scoped `yes` burners on the SAME core
 * (T3 rule 9) turned one red in ten — not in the door T1 named, but in a
 * sibling that plants the identical shape (`plantDaemonWithGrandchild`, its
 * daemon ignoring SIGTERM): `stopOwnScheduler` reported `how: 'SIGTERM'`
 * where every green run reports `'SIGKILL'`. The daemon script installs its
 * no-op `process.on('SIGTERM', () => {})` handler AFTER `spawn()` returns —
 * `spawn` hands back a pid the instant the kernel accepts the fork, well
 * before node has loaded and run a single line of the child's own script —
 * so a fixed 150 ms wait is a bet that node finishes loading under contention
 * as fast as it does on a quiet box. When it does not, Node's OWN DEFAULT
 * SIGTERM behaviour (exit) fires before the no-op handler is registered, and
 * the "must be force-killed" assumption a door is built on was never true for
 * that run.
 *
 * THE FIRST FIX HERE WAS WRONG, AND STAYS DOCUMENTED AS SUCH (T1 1372's fifth
 * pass, found by re-running clean after RP's fourth pass, not under any load
 * at all). It waited on `/proc/<pid>/status`'s `SigCgt:` field — the kernel's
 * per-process "signals with a handler installed" mask — for SIGTERM's bit.
 * MEASURED WRONG: a freshly spawned node child with ZERO signal-handling code
 * of its own ALREADY shows that bit set, because node's own bootstrap installs
 * internal SIGTERM handling before a single line of user script runs. The
 * wait therefore returned in single-digit milliseconds regardless of whether
 * the SCRIPT'S OWN `process.on('SIGTERM', ...)` line had executed at all —
 * worse than the fixed sleep it replaced, and reproduced with zero burners
 * running, so it was never a contention artifact.
 *
 * SO THIS WAITS ON AN EXPLICIT MARKER THE SCRIPT WRITES ITSELF, as its own
 * literal last statement, after everything before it — including whatever
 * `process.on('SIGTERM', ...)` call the script makes — has run. `withReady`
 * appends that write to a caller's script text; nothing here infers readiness
 * from kernel state a runtime's own bootstrap can set for reasons that have
 * nothing to do with user code.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { quiesceWriters } from './quiesce.mjs';
import { DAEMON_PID_FILE } from './sweep-teardown.mjs';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 10;

/** Poll `check()` until it returns non-null/true, or `timeoutMs` runs out. */
async function pollUntil(check, { timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Is `pid` visible in `/proc` at all — the kernel has accepted the fork and
 *  the entry exists, whether or not node has run a line of script yet. */
export async function waitForProcVisible(pid, opts = {}) {
  const v = await pollUntil(() => existsSync(`${opts.procRoot ?? '/proc'}/${pid}`), opts);
  return v !== null;
}

/** The pid a plant's own script wrote to `ralphPidFile` once it exists and
 *  parses — the FILE having been written is itself an event, never assumed
 *  from elapsed time. */
export async function waitForRalphPid(ralphPidFile, opts = {}) {
  return pollUntil(() => {
    let raw;
    try {
      raw = readFileSync(ralphPidFile, 'utf8').trim();
    } catch {
      return null;
    }
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }, opts);
}

/** Does `path` exist — waited on rather than assumed from a fixed delay after
 *  a still-alive writer's interval. The SAME event a fixed sleep was standing
 *  in for, asked for directly instead of guessed at. Also the READY-MARKER
 *  wait every plant below uses: a script written via `withReady` writes its
 *  own marker as its literal last statement. */
export async function waitForFileToExist(path, opts = {}) {
  const v = await pollUntil(() => existsSync(path), opts);
  return v !== null;
}

/**
 * `script`, with a write to `markerPath` appended as its own final statement.
 * JS in a `-e` string runs top to bottom and `setInterval`/`spawn` calls do
 * not block, so anything appended after them — including this — still runs
 * in the same synchronous pass, immediately after everything the caller's
 * script does, including any `process.on('SIGTERM', ...)` call. The marker
 * existing is therefore proof that specific line has executed; nothing else
 * this module tried was.
 */
export function withReady(script, markerPath) {
  return `${script}\ntry { require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, '1'); } catch {}`;
}

/** The grandchild `ralphPidFile` names, confirmed alive and having reached
 *  the end of its own script — including whatever `process.on('SIGTERM',
 *  ...)` call it makes, whether a no-op or a clean-exit handler — via its OWN
 *  ready marker at `readyMarkerPath` (written by `withReady`). Throws rather
 *  than returning a half-ready pid: a plant a door's assertions cannot trust
 *  is worse than a test that fails loudly before it even starts asserting.
 */
export async function waitForGrandchildReady(ralphPidFile, readyMarkerPath, opts = {}) {
  const pid = await waitForRalphPid(ralphPidFile, opts);
  if (pid === null) throw new Error(`sweep-teardown-plant: ${ralphPidFile} was never written`);
  if (!(await waitForProcVisible(pid, opts))) throw new Error(`sweep-teardown-plant: grandchild pid ${pid} never became visible in /proc`);
  if (!(await waitForFileToExist(readyMarkerPath, opts))) throw new Error(`sweep-teardown-plant: grandchild pid ${pid} never reached its own ready marker`);
  return pid;
}

export function killIfAlive(pid) {
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}

/** `t.after`, registered the INSTANT a pid exists, for a plant this pair of
 *  functions has not yet confirmed is ready. Without this a readiness wait
 *  that throws (a genuinely starved host outlasting even the bounded poll)
 *  leaves the test body's OWN `const x = await plant…` never completing, so
 *  its own `t.after` is never reached and what was already spawned leaks —
 *  measured directly: a 10-run repro under load leaked exactly this shape
 *  once cleanup was registered only after the wait succeeded. Registering
 *  here, before either wait, is what makes T3 rule 9's "trap-scoped cleanup
 *  in the same command" hold even when the plant itself is what times out. */
function registerCleanup(t, pid, ralphPidFile) {
  t.after(() => {
    killIfAlive(pid);
    if (ralphPidFile) {
      try { killIfAlive(Number(readFileSync(ralphPidFile, 'utf8'))); } catch { /* never wrote */ }
    }
  });
}

/** A daemon that ignores SIGTERM and, at spawn, forks a detached grandchild
 *  running `grandchildScript` — writing the grandchild's pid to `ralphPidFile`.
 *  `t` is the test's own `TestContext`: cleanup for BOTH pids is registered
 *  BEFORE either readiness wait runs (see `registerCleanup`), so the caller
 *  needs no `t.after` of its own for either pid. Returns once BOTH the
 *  daemon's own no-op handler and the grandchild's own handler have ACTUALLY
 *  RUN (their own ready markers, `withReady` — see this module's header for
 *  why `SigCgt` could not answer this) — never a guess about how long that
 *  takes under load. */
export async function plantDaemonWithGrandchild(t, root, grandchildScript, ralphPidFile) {
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  const daemonReady = `${ralphPidFile}.daemon-ready`;
  const grandchildReady = `${ralphPidFile}.ready`;
  const daemon = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(withReady(grandchildScript, grandchildReady))}], {
      cwd: ${JSON.stringify(root)}, detached: true, stdio: 'ignore',
    });
    fs.writeFileSync(${JSON.stringify(ralphPidFile)}, String(child.pid));
    process.on('SIGTERM', () => {}); // ignored — the daemon itself must be force-killed
    ${withReady('', daemonReady)}
    setInterval(() => {}, 1000);
  `], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, DAEMON_PID_FILE), String(daemon.pid));
  registerCleanup(t, daemon.pid, ralphPidFile);
  if (!(await waitForFileToExist(daemonReady))) throw new Error(`sweep-teardown-plant: daemon pid ${daemon.pid} never reached its own ready marker`);
  await waitForGrandchildReady(ralphPidFile, grandchildReady);
  return daemon;
}

/** A real process standing in for a pid `reapAgentRuns` already believes it
 *  reaped — its own liveness does not matter to the door, only that a
 *  detached grandchild running `grandchildScript` outlives it. No daemon pid
 *  file: the caller passes `root.pid` as a reaped pid directly, exactly as
 *  `reap.reaped.map(r => r.pid)` would. `t` is the test's own `TestContext`;
 *  cleanup for both pids is registered before the readiness wait, the same
 *  reason `plantDaemonWithGrandchild` does. Returns once the grandchild is
 *  confirmed ready (see `waitForGrandchildReady`) — the parent installs no
 *  handler of its own, so there is nothing else to wait for on it. */
export async function plantReapedRootWithGrandchild(t, root, grandchildScript, ralphPidFile) {
  const grandchildReady = `${ralphPidFile}.ready`;
  const parent = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(withReady(grandchildScript, grandchildReady))}], {
      cwd: ${JSON.stringify(root)}, detached: true, stdio: 'ignore',
    });
    fs.writeFileSync(${JSON.stringify(ralphPidFile)}, String(child.pid));
    setInterval(() => {}, 1000);
  `], { cwd: root, stdio: 'ignore' });
  registerCleanup(t, parent.pid, ralphPidFile);
  await waitForGrandchildReady(ralphPidFile, grandchildReady);
  return parent;
}

/** The `_queue/in-flight/` claim `releaseOwnInFlight` will find as this tree's own. */
export function plantInFlightClaim(root) {
  const dir = join(root, '_queue', 'in-flight');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'INIT-mine.md'), `---\nproject_repo_path: ${join(root, 'projects', 'gitpulse')}\n---\n`);
  writeFileSync(join(dir, 'INIT-mine.md.heartbeat'), '2026-09-11T07:53:27.192Z');
  return { manifest: join(dir, 'INIT-mine.md'), heartbeat: join(dir, 'INIT-mine.md.heartbeat') };
}

/** An `INIT-<id>.md` manifest `claimQueueWrites` will attribute to THIS run by
 *  `created_at`, plus its heartbeat — the artefact `captureAndClearMintedRun-
 *  Artefacts` (reached through `sweepProductFixtures`) actually clears. */
export function plantInitManifest(root, sinceMs) {
  const dir = join(root, '_queue', 'in-flight');
  mkdirSync(dir, { recursive: true });
  const createdAt = new Date(sinceMs + 1000).toISOString();
  writeFileSync(join(dir, 'INIT-mine.md'), `---\ncreated_at: '${createdAt}'\n---\n`);
  writeFileSync(join(dir, 'INIT-mine.md.heartbeat'), '2026-09-11T07:53:27.192Z');
  return join(dir, 'INIT-mine.md.heartbeat');
}

/**
 * `quiesceWriters` with its own defaults intact (15s / 250ms) does nothing to
 * end the wait itself — it only OBSERVES. In these doors nothing kills the
 * planted root until `reapCensusAndSweep`'s OWN census does, several lines
 * later, so the real defaults burn the full 15s bound for no reason before
 * getting there. Production pays this unchanged (`quiesceWriters` itself is
 * untouched by this fix); the doors do not need to.
 */
export function fastQuiesce(opts) {
  return quiesceWriters({ ...opts, upToMs: 400, pollMs: 25, settleMs: 25 });
}
