/**
 * verify-cycle-teardown.mjs — the ONE finally-level teardown for a `forge
 * studio` this harness SPAWNED (M7-A finding row 82).
 *
 * INCIDENT. A funded run exited early on "REFUSING the develop hand-off — the
 * architect stage did not succeed" and left the bridge it had spawned AND
 * that bridge's Next UI child running, reparented to init — every later story
 * run on the host was refused until someone killed them by pid. Root cause,
 * read down to the byte: `startWatch()` never forwarded `spawnStudioReady`'s
 * own `stop` function into the object it returned, so the REFUSING branch's
 * `await watch.stop?.()` was an unconditional no-op, and `process.exit(1)`
 * fired one line later with nothing torn down. The fatal `main().catch`
 * handler had a SECOND, weaker teardown of its own (a bare
 * `activeWatchProc.kill('SIGTERM')` — no process-GROUP kill, no SIGKILL
 * escalation, no port verification) covering a different set of exit paths.
 * Two teardowns, two omissions — `residue.sh`'s own shape (row 875): when the
 * rule is "remember to also tear down X", make X structurally inseparable
 * from the rest.
 *
 * THE FIX, as three composable pieces:
 *
 *   - `killGroupIfLive` never signals a pid whose `/proc/<pid>/stat` start
 *     time (field 22) no longer matches what was recorded at spawn — a
 *     recycled pid is a different process and must never be signalled.
 *   - `verifyTornDown` probes every port + the bridge health endpoint AFTER
 *     the kill and names any survivor by number — a silent survivor is the
 *     defect, not a green exit.
 *   - `runGuarded` is the single finally: it tears down whatever the run
 *     actually spawned on EVERY exit from `body` — normal completion or a
 *     thrown error (the REFUSING path is now a `throw`, not a
 *     `process.exit()`, precisely so this finally sees it) — and never
 *     touches a studio the run only REUSED (that distinction lives in
 *     `teardownStudio`, the one place it is decided, not spread across call
 *     sites).
 *
 * Every collaborator is injected so this is testable without spawning a real
 * `forge studio` (§15.163 — a behaviour exercised only by a funded run is a
 * behaviour nobody exercises); scripts/verify-cycle-teardown.test.ts still
 * exercises the real OS primitives (`/proc`, real sockets, real SIGKILL)
 * directly, because a fake would only prove the fake's own contract.
 */
import { readFileSync } from 'node:fs';
import { connect as netConnect } from 'node:net';

/** `/proc/<pid>/stat` field 22 (start time, in clock ticks since boot) — the
 *  one field stable for the lifetime of a pid and never reused until the pid
 *  itself is. `comm` (field 2) is parenthesised and may itself contain
 *  spaces/parens, so the split point is the LAST `)` in the line, matching
 *  how `ps`/util-linux parse this file. Returns null (never throws) when the
 *  pid has no `/proc` entry — the process is already gone. */
export function readProcStartTicks(pid, { readFile = readFileSync } = {}) {
  try {
    const stat = readFile(`/proc/${pid}/stat`, 'utf8');
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
    const fields = afterComm.split(' ');
    return fields[19] ?? null; // field 22 overall; index 0 here is field 3 (state)
  } catch {
    return null;
  }
}

/** Captured at spawn time (boot-studio.mjs's `onSpawn`, synchronously, before
 *  the studio is even ready) — the one moment `pid` and its start-time are
 *  known to refer to the SAME process this run just created. */
export function captureHandle(proc, { readStartTicks = readProcStartTicks } = {}) {
  return { pid: proc.pid, startTicks: readStartTicks(proc.pid) };
}

/** Signal the process GROUP (`-pid`) `handle` names — but only after
 *  confirming the pid's live start-time still matches what was recorded at
 *  spawn. A pid can be reused by an unrelated process between spawn and
 *  teardown; signalling it anyway would hit whatever now holds that number,
 *  not the studio this run started. */
export function killGroupIfLive(handle, sig, { readStartTicks = readProcStartTicks, kill = process.kill } = {}) {
  if (!handle) return { signalled: false, reason: 'no handle' };
  const current = readStartTicks(handle.pid);
  if (current === null) return { signalled: false, reason: 'process already gone' };
  if (handle.startTicks !== null && current !== handle.startTicks) {
    return { signalled: false, reason: 'pid recycled — start time no longer matches; refusing to signal' };
  }
  try {
    kill(-handle.pid, sig);
    return { signalled: true };
  } catch (err) {
    return { signalled: false, reason: err.message };
  }
}

/** A raw TCP connect probe — true iff something answers the connect at all.
 *  Deliberately transport-level (not HTTP): the UI port and the bridge port
 *  both just need to be CLOSED, whatever they'd otherwise serve. */
export function probeTcpOpen(host, port, { timeoutMs = 500, connect = netConnect } = {}) {
  return new Promise((resolve) => {
    const sock = connect({ host, port, timeout: timeoutMs });
    const done = (open) => { sock.destroy(); resolve(open); };
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** `GET /api/health` — true only on an ok response; any throw (connection
 *  refused, timeout) reads as "not healthy", never as an exception the
 *  caller must handle. */
export async function probeHealthOk(bridgeUrl, { fetchImpl = fetch, timeoutMs = 500 } = {}) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const res = await fetchImpl(`${bridgeUrl}/api/health`, { signal: c.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Fix item 3 — after a kill, prove it: every port must be closed AND the
 *  bridge health endpoint must be refused. Names each survivor by number (or
 *  by name, for the health check) — a verdict that only says "not clean"
 *  costs a second run to find out which port. */
export async function verifyTornDown({
  ports, host = '127.0.0.1', bridgeUrl, log = () => {},
  probeTcpOpen: probeTcp = probeTcpOpen, probeHealthOk: probeHealth = probeHealthOk,
}) {
  const incomplete = [];
  for (const port of ports) {
    if (await probeTcp(host, port)) {
      log(`TEARDOWN-INCOMPLETE port ${port} still listening`);
      incomplete.push(port);
    }
  }
  if (bridgeUrl && (await probeHealth(bridgeUrl))) {
    log(`TEARDOWN-INCOMPLETE bridge health still answering at ${bridgeUrl}/api/health`);
    incomplete.push('health');
  }
  return { complete: incomplete.length === 0, incomplete };
}

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * teardownStudio — SIGTERM the process group, a bounded wait, SIGKILL if it
 * is still there, then verify. A studio this run only REUSED (`spawned:
 * false`, or no `handle` at all) is untouched — this is the ONE place that
 * distinction is decided, so no call site has to remember it separately.
 */
export async function teardownStudio({
  handle, spawned, ports, bridgeUrl, log = () => {}, sleep = defaultSleep,
  killGroupIfLive: kill = killGroupIfLive, verifyTornDown: verify = verifyTornDown,
  termWaitMs = 1500,
}) {
  if (!spawned || !handle) {
    log('teardown: studio was reused by this run, not spawned — leaving it running');
    return { attempted: false, complete: true, incomplete: [] };
  }
  log(`teardown: studio was spawned by this run (pid ${handle.pid}) — SIGTERM to its process group`);
  const term = kill(handle, 'SIGTERM');
  if (!term.signalled) log(`teardown: SIGTERM not delivered (${term.reason})`);
  await sleep(termWaitMs);
  const esc = kill(handle, 'SIGKILL');
  if (esc.signalled) log('teardown: process group still present after SIGTERM — sent SIGKILL');
  const result = await verify({ ports, bridgeUrl, log });
  return { attempted: true, complete: result.complete, incomplete: result.incomplete };
}

/**
 * runGuarded — fix item 1: the single finally that tears down whatever
 * `getWatch()` says this run is holding, on EVERY exit from `body` (return OR
 * throw). `getWatch` is a closure over the caller's own `let watch` — the
 * body is free to reassign it (e.g. `ensureWatch()` restarting a dead bridge
 * mid-run) and this finally always tears down the LATEST value.
 *
 * `onIncomplete` replaces a direct `process.exitCode` write here — this
 * module stays a pure orchestrator, testable without mutating the real
 * process's exit code; the caller (verify-cycle.mjs) sets it.
 *
 * A teardown that itself throws is logged and swallowed, never left to
 * replace `body`'s own error — the run's real failure is the one that
 * matters.
 */
export async function runGuarded({ getWatch, ports, log = () => {}, onIncomplete = () => {} }, body, { teardownStudio: teardown = teardownStudio } = {}) {
  try {
    return await body();
  } finally {
    const watch = getWatch();
    if (watch) {
      try {
        const result = await teardown({ handle: watch.handle, spawned: watch.spawned, bridgeUrl: watch.bridgeUrl, ports, log });
        if (!result.complete) onIncomplete(result);
      } catch (err) {
        log(`teardown itself threw — ${err.message} (not masking the run's own outcome)`);
      }
    }
  }
}
