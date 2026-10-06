/**
 * sweep-teardown.mjs — what a run PUTS BACK and STOPS when it ends.
 *
 * Split out of `sweep.mjs` at the 800-line cap (SPLIT, NEVER BASELINE — T1
 * ruling 492). The seam is a real one rather than a line count: `sweep.mjs`
 * decides what a run REMOVES before it starts and what the fence judges
 * afterwards; this file is the paired half — the committed artifacts the
 * leading sweep deleted and did not regenerate, and the daemon the run's own
 * beat started.
 *
 * Both exist because a run that ends badly used to leave the tree lying about
 * itself: files git still tracks reported as deleted, and a scheduler still
 * running that would red the NEXT run's beat 7 at t+0.
 *
 * A THIRD SHAPE JOINED THEM AT FINDING ROW 75 (T1 rulings 1258, 1332):
 * `reapCensusAndSweep` census-gates the STORY's OWN trailing sweep the same
 * way `stopSchedulerCensusAndRelease` census-gates the scheduler's — one file,
 * because both are "confirm the writer is actually dead before trusting a
 * clear", and a second copy of that reasoning is how one of the two would
 * drift from the other.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { readProcTable, descendantsOf, agentRunsReadable } from './reap.mjs';
import { waitForCensusEmpty, describeCensus, identifyPid, verifiedKill } from './reap-census.mjs';
import { quiesceWriters, describeQuiesce } from './quiesce.mjs';
import { sweepProductFixtures } from './sweep.mjs';
import { sweepCycleArtefacts } from './sweep-cycle-artefacts.mjs';
import { describeRunArtefactsClear } from './ground-clear.mjs';
// Split out at the 800-line cap (SPLIT, NEVER BASELINE — T1 ruling 492); importers use
// the sibling module directly — no re-export (CLAUDE.md: no backwards-compat paths).
import { DAEMON_PID_FILE, DRAIN_GRACE_MS, ownSchedulerPidState, ownSchedulerPid, stopOwnScheduler } from './sweep-teardown-scheduler.mjs';
import { killBridgeProcessGroup } from './bridge.mjs';
// Reused rather than reinvented: `stop-path.mjs` already owns the ONE
// `/proc`-based process-group liveness read and this file's own pair of
// bounds for a bridge group's own exit — see `stopStudioThenScheduler` below.
import { liveGroupMembers, BRIDGE_EXIT_BOUND_MS, BRIDGE_KILL_GRACE_MS } from './stop-path.mjs';


/**
 * Put back the COMMITTED artifacts the leading sweep removed and the run never
 * regenerated — T1 ruling 594's second half.
 *
 * THE SWEEP HAS NO PAIRED RESTORE. `demos/stories/<id>/` is deleted before the
 * bridge boots, so a run cannot inherit dead state, and it is rebuilt as beats
 * pass. Any exit between those two points leaves the repo holding whatever the
 * run reached and MISSING every committed file it had not got to — which
 * `git status` then shows as deliberate deletions.
 *
 * The motivating case is not a crash. Lane C's run refused at preflight because
 * a healthy bridge from another lane's worktree held 4123 — the runner doing
 * exactly the right thing — and that correct refusal still left three committed
 * files deleted: two frames and `story.json`. **A preflight refusal is the most
 * likely abort there is, and it was the one that guaranteed the damage.** Lane A
 * measured the same shape from a kill at beat 6 (frames 06–11 plus
 * `story.json`), and S10 has far more frames than S1.
 *
 * ONLY WHAT IS STILL MISSING. A run that finished regenerated its artifacts, and
 * those legitimately differ from HEAD — restoring them would destroy the very
 * output the run exists to produce. So a path is restored only if git tracks it
 * AND it is absent from the disk right now. That single condition is what makes
 * this safe to run unconditionally on every exit path.
 *
 * @param {string} root the run's own worktree
 * @param {string[]} sweptPaths absolute paths the leading sweep reported removing
 * @returns {{restored: string[], failed: {path: string, error: string}[]}}
 */
export function restoreSweptCommitted(root, sweptPaths) {
  const restored = [];
  const failed = [];
  for (const abs of sweptPaths) {
    const rel = relative(root, abs);
    if (rel === '' || rel.startsWith('..')) continue; // never reach outside the run's own tree
    let tracked = [];
    try {
      tracked = execFileSync('git', ['ls-files', '-z', '--', rel], { cwd: root, encoding: 'utf8' })
        .split('\0').filter((p) => p !== '');
    } catch {
      continue; // not a repo, or git unavailable — nothing to restore against
    }
    const missing = tracked.filter((p) => !existsSync(join(root, p)));
    if (missing.length === 0) continue;
    try {
      execFileSync('git', ['checkout', '--', ...missing], { cwd: root, encoding: 'utf8' });
      restored.push(...missing);
    } catch (e) {
      failed.push({ path: rel, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { restored: restored.sort(), failed };
}

/**
 * Release the `_queue/in-flight/` claims this TREE owns — the fallback for a
 * daemon that could not drain.
 *
 * `stopOwnScheduler` gives the daemon a bounded window to finish its cycles and
 * hand its claims back itself, which is always the better outcome because the
 * cycle's own state goes with it. When the window runs out the daemon is killed
 * mid-flight, and what it was holding stays in `in-flight` with a heartbeat
 * frozen at the instant of the kill. S10 run 10 left exactly that, and
 * `_queue/` is gitignored, so `git status` reported a clean tree over it — the
 * next run would have found `start-work-develop` disabled ("nothing is ready to
 * start (blocked, running, or done)") and red at a beat with nothing to do with
 * its own code.
 *
 * ATTRIBUTED FROM THE ARTIFACT, never from a pattern or a time window. Each
 * manifest carries `project_repo_path`, the tree it was minted for, so a
 * concurrent lane's claim in a shared queue is left alone by construction
 * rather than by hoping the windows do not overlap. A companion `.heartbeat`
 * travels with its manifest; anything else in the directory — `.gitkeep`
 * included — is untouched.
 *
 * The caller CAPTURES before calling: these files are the evidence that the
 * develop beat's disabled button was right.
 *
 * @param {string} root the run's own worktree
 * @returns {{released: string[], failed: {path: string, error: string}[]}}
 */
export function releaseOwnInFlight(root) {
  const dir = join(root, '_queue', 'in-flight');
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return { released: [], failed: [] }; // no queue at all — a run that claimed nothing
  }
  const released = [];
  const failed = [];
  const ours = join(realpathSync(root), 'projects');
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    let text;
    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch (e) {
      failed.push({ path: name, error: String(e) });
      continue;
    }
    const m = /^project_repo_path:\s*(.+)$/m.exec(text);
    if (m === null || !m[1].trim().startsWith(ours)) continue;
    for (const f of [name, `${name}.heartbeat`]) {
      if (!existsSync(join(dir, f))) continue;
      try {
        rmSync(join(dir, f));
        released.push(f);
      } catch (e) {
        failed.push({ path: f, error: String(e) });
      }
    }
  }
  return { released: released.sort(), failed };
}

/**
 * `stopOwnScheduler` + `releaseOwnInFlight`, WITH THE GAP CLOSED — finding row
 * 75 (T1 rulings 1258, 1332). The old sequence trusted "the recorded daemon
 * pid is confirmed dead" to mean "nothing it started is still writing", and
 * that measured wrong: `spawnAgentTurn` spawns every dispatch `detached: true`
 * (`reap.mjs`'s own header), so a phase agent the daemon started is its OWN
 * process group and OUTLIVES a daemon killed before it could drain.
 * `stopOwnScheduler` signals only the ONE recorded pid — never `-pid`, never a
 * child — so that agent was never touched, and `releaseOwnInFlight` ran right
 * after regardless. Measured: a heartbeat written back 13s after a runner
 * printed CLEARED, a loop still committing into the ground 2.7 minutes later.
 *
 * THE SNAPSHOT MUST COME FIRST, and this is `reap.mjs`'s own 5.45 lesson
 * repeated at a second call site. Once the daemon actually exits, the kernel
 * reparents its children as PART OF that exit — there is no later moment at
 * which a ppid-chain walk can still find them under the daemon's pid. So the
 * daemon's descendant tree is read (`readProcTable` + `descendantsOf`, the
 * same snapshot-then-signal machinery `reapAgentRuns` uses) BEFORE
 * `stopOwnScheduler` sends anything, and TERM is sent to each of them directly
 * — not left to cascade from the daemon's own death, because for a `detached`
 * child it never would.
 *
 * ONLY WHEN THE DAEMON DID NOT DRAIN. A daemon that drained cleanly awaited its
 * own in-flight cycles before exiting (`scheduler.ts:298-301`), so nothing it
 * dispatched is still running by construction — the snapshot, the extra kill
 * and the census below are read-only work spent for nothing on that path, and
 * are skipped exactly like the old `releaseOwnInFlight` call was.
 *
 * THE CENSUS GATES THE RELEASE; THE RE-READ CHECKS IT AFTERWARDS. Two
 * different failures, and only one of them is visible to the census: a
 * descendant that survives is a NOT-EMPTY census, refused before the release
 * ever runs (door 1). A writer that shares no ancestry with the daemon at
 * all — a sibling process the run never dispatched, writing the same path —
 * is invisible to a tree-membership check by construction, and can only be
 * caught by re-reading the exact paths just released (door 2, T1 1332's own
 * distinction). Removing either check independently reds its own door; see
 * `sweep-teardown.test.ts`'s mutation notes.
 *
 * MUST 2 (D's review of #906) — EVERY SIGNAL HERE GOES THROUGH `verifiedKill`,
 * NEVER A BARE `process.kill(pid, sig)`. The daemon pid and every descendant
 * the pre-signal snapshot found are recorded as `{pid, startTime}` identities
 * (`identifyPid`) the INSTANT they are found, and re-verified immediately
 * before each signal: a pid this run recorded can be recycled by an unrelated
 * process on this four-lane host before the signal lands, and `kill()` taking
 * a bare number cannot tell the difference.
 *
 * ROW 166 FOLLOW-UP (S10 run 44, bead `forge-8vfn.8.1.60`) — DEFERRED
 * INITIATIVES, once the daemon above is CONFIRMED dead (drained, or killed and
 * censused empty). `claimQueueWrites` (queue-claim.mjs's own header) now never
 * claims an in-flight manifest while its owning scheduler is alive, so a cycle
 * still running when a story ends — S10's own ACT 2, by design — is correctly
 * LEFT by the per-story trailing sweep, heartbeat, worktrees, dispatch dir and
 * all. Left there forever it is exactly the residue `releaseOwnInFlight` above
 * exists to clear, except `releaseOwnInFlight` only ever `rmSync`s the `.md`
 * and `.heartbeat` — no capture, and it never touches `_worktrees/<id>`,
 * `_worktrees/wi/<id>` or the `_logs/<ts>_<id>` dispatch dir. So, ONLY once
 * this daemon is confirmed dead, `sweepCycleArtefacts` (sweep.mjs) — the SAME
 * attribute-capture-clear pass the per-story sweep and `run.mjs`'s post-stop
 * sweep both use (bead `forge-8vfn.8.1.52`, row 146) — runs here, scoped to
 * `opts.sinceMs` (this run's own window): it captures the manifest to
 * evidence exactly as the per-story queue claim used to, before deferring
 * ever existed, and clears everything `captureAndClearMintedRunArtefacts`
 * knows to look for under the ids it just claimed. `releaseOwnInFlight` still
 * runs straight after, unchanged, as the path-attributed backstop for
 * whatever this window-based claim could not attribute (T1 1332's own
 * "capture-then-clear, and a second door for what the first cannot see").
 *
 * `schedulerAlive: false`, EXPLICIT, never inherited — `sweepCycleArtefacts`'s
 * own header requires every caller to state this rather than default it. This
 * call is only ever reached once the daemon above is CONFIRMED dead (drained,
 * or killed and censused empty), so there is no live writer left to defer to;
 * that is the entire premise of running the clear at all.
 *
 * REQUIRED, FAIL FAST — the same rule `sweepProductFixtures` already applies
 * to its own `sinceMs` (`forge-8vfn.7.6.74`). A default that quietly skipped
 * the deferred clear would print a clean teardown for a call that never
 * looked at `_queue` for a deferred initiative at all — a green for a case
 * that did not run, the shape of defect this bead exists to close, and a
 * second, optional code path is exactly the back-compat shim CLAUDE.md
 * refuses. Every caller supplies its own window, `run.mjs`'s own `startedMs`
 * included; a stop/release-only door supplies one that plants nothing inside
 * it — the honest way to exercise "nothing to clear", never an omission.
 *
 * @param {string} root the run's own worktree
 * @param {{sinceMs: number, graceMs?: number, censusBoundMs?: number, censusPollMs?: number,
 *          rereadDelayMs?: number, procRoot?: string,
 *          procTable?: () => Map<number, {ppid: number, pgrp: number}>,
 *          kill?: (pid: number|string, sig: NodeJS.Signals) => void,
 *          sleep?: (ms: number) => Promise<void>,
 *          release?: (root: string) => {released: string[], failed: object[]},
 *          deferredClear?: typeof sweepCycleArtefacts}} opts
 * @returns {Promise<{sched: object, census: object|null,
 *   release: ({released: string[], failed: object[], reappeared: string[]})|null,
 *   deferred: {claim: object, artefacts: object}|null,
 *   lines: string[]}>}
 */
export async function stopSchedulerCensusAndRelease(root, opts = {}) {
  if (typeof opts.sinceMs !== 'number') {
    throw new Error(
      'stopSchedulerCensusAndRelease needs { sinceMs } to claim a deferred initiative\'s own queue writes ' +
      '(forge-8vfn.8.1.60) — a stop/release-only caller passes a window that plants nothing inside it',
    );
  }
  const graceMs = opts.graceMs ?? DRAIN_GRACE_MS;
  const censusBoundMs = opts.censusBoundMs ?? 5000;
  const censusPollMs = opts.censusPollMs ?? 100;
  const rereadDelayMs = opts.rereadDelayMs ?? 250;
  const procRoot = opts.procRoot ?? '/proc';
  const procTable = opts.procTable ?? (() => readProcTable());
  const kill = opts.kill ?? ((pid, sig) => process.kill(pid, sig));
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const release = opts.release ?? releaseOwnInFlight;
  const sinceMs = opts.sinceMs;
  const deferredClear = opts.deferredClear ?? sweepCycleArtefacts;
  // Run ONLY once the daemon above is confirmed dead — see this function's
  // own header.
  const runDeferredClear = () => {
    const evidenceDir = join(root, '_logs', '_batch-teardown-queue-claim', String(sinceMs));
    // `schedulerAlive: false` — explicit, see this function's own header.
    const { claim, artefacts } = deferredClear('batch-teardown', root, {
      sinceMs, evidenceDir, schedulerAlive: false,
    });
    return {
      deferred: { claim, artefacts },
      lines: [...claim.lines, ...describeRunArtefactsClear(artefacts)],
    };
  };

  let daemonPid = null;
  try {
    const n = Number(readFileSync(join(root, DAEMON_PID_FILE), 'utf8').trim());
    if (Number.isInteger(n) && n > 0) daemonPid = n;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // ROW 101 / M7-D finding 3 — an unreadable pidfile is NOT "no daemon":
      // if one is later found alive by `stopOwnScheduler`'s own (separate)
      // read below, its descendants were never snapshotted HERE, and a real
      // kill could orphan a detached dispatch invisibly. Refuse the whole
      // step rather than guess — never a signal, never a release.
      const reason = `could not read ${DAEMON_PID_FILE}: ${e.message} — daemon state UNKNOWN`;
      return {
        sched: null,
        census: { empty: false, survivors: null, waitedMs: 0, reason },
        release: null,
        deferred: null,
        lines: [`[stories] REFUSING teardown: ${reason}`],
      };
    }
    // ENOENT — genuinely no pid file; `stopOwnScheduler` below reaches the
    // same conclusion independently.
  }
  // BEFORE ANY SIGNAL. `stopOwnScheduler` has not run yet, so the daemon (if
  // it exists) is still alive and its children's ppid still points at it.
  // MUST 2 — every identity is captured HERE, at the moment of discovery.
  const daemonIdentity = daemonPid !== null ? identifyPid(daemonPid, { procRoot }) : null;
  const preSignalTable = daemonPid !== null ? procTable() : new Map();
  if (preSignalTable === null) {
    // ROW 101 / M7-D finding 6, applied at this call site — a table build
    // failure must never render as "no descendants" for a daemon that DOES
    // exist; refuse the whole step exactly as an unreadable pidfile does.
    const reason = 'the process table could not be read — this scheduler\'s descendants are UNKNOWN, so signalling it now could orphan them invisibly';
    return {
      sched: null,
      census: { empty: false, survivors: null, waitedMs: 0, reason },
      release: null,
      deferred: null,
      lines: [`[stories] REFUSING teardown: ${reason}`],
    };
  }
  const descendants = daemonPid !== null ? descendantsOf(daemonPid, preSignalTable) : [];
  const descendantIdentities = descendants.map((pid) => identifyPid(pid, { procRoot }));

  // forge-8vfn.30.16 — a DRAINING daemon dispatches the next phase agent after
  // the snapshot above; `stopOwnScheduler` freezes it just before its SIGKILL
  // and calls this to record those late children while their ppid still leads
  // to it. Identities are keyed by pid; the earlier record wins.
  const lateIdentities = [];
  const recordDescendants = (pid) => {
    const table = procTable();
    if (table === null) return { ok: false, reason: 'the process table could not be read at the freeze — what the draining daemon dispatched is UNKNOWN' };
    for (const d of descendantsOf(pid, table)) {
      if (!descendantIdentities.some((i) => i?.pid === d)) lateIdentities.push(identifyPid(d, { procRoot }));
    }
    return { ok: true };
  };
  const sched = stopOwnScheduler(root, graceMs, { recordDescendants });
  if (sched.unknown) {
    // ROW 102b/18-19 — same refusal shape as the pidfile/table UNKNOWN cases above.
    const reason = sched.note ?? 'scheduler state could not be determined';
    return {
      sched,
      census: { empty: false, survivors: null, waitedMs: 0, reason },
      release: null,
      deferred: null,
      lines: [`[stories] REFUSING teardown: ${reason}`],
    };
  }
  const lines = [];
  if (sched.stopped !== null) {
    lines.push(
      `[stories] stopped the scheduler this run started — pid ${sched.stopped} by ` +
      `${sched.drained ? `${sched.how}, drained` : `${sched.how}, DID NOT DRAIN`}`,
    );
  }
  if (sched.note !== null) lines.push(`[stories] scheduler: ${sched.note}`);

  if (sched.stopped === null || sched.drained) {
    // ROW 166 follow-up — a daemon this tree owned, confirmed dead by draining
    // cleanly, may still have left an initiative behind. `sched.stopped ===
    // null` means no daemon was ever ours here, so there is nothing to defer.
    const { deferred, lines: deferredLines } = sched.stopped !== null
      ? runDeferredClear()
      : { deferred: null, lines: [] };
    return { sched, census: null, release: null, deferred, lines: [...lines, ...deferredLines] };
  }

  // The daemon did not drain, so a dispatch it started (detached, with its OWN
  // process group) may have outlived it. TERM every pid the pre-signal
  // snapshot found — the daemon's own kill never reached them. Each signal is
  // re-verified against the identity recorded above (MUST 2).
  const allDescendants = [...descendantIdentities, ...lateIdentities];
  for (const identity of allDescendants) {
    const r = verifiedKill(identity, 'SIGTERM', { kill, procRoot });
    if (r.signalled) lines.push(`[stories] stopped pid ${identity.pid} (SIGTERM, recorded descendant of the daemon${lateIdentities.includes(identity) ? ', dispatched while it drained' : ''})`);
    else lines.push(`[stories] census: ${r.reason}`);
  }
  const roots = [daemonIdentity, ...allDescendants].filter((r) => r !== null);
  const censusOf = () => waitForCensusEmpty(roots, { boundMs: censusBoundMs, pollMs: censusPollMs, procRoot });
  let census = await censusOf();
  if (!census.empty && census.survivors !== null) {
    for (const pid of census.survivors) {
      // A fresh identity, captured now and verified again inside
      // `verifiedKill` immediately before the signal — MUST 2's discipline
      // applies to every pid this module ever signals, not only the ones
      // recorded at the top.
      const r = verifiedKill(identifyPid(pid, { procRoot }), 'SIGKILL', { kill, procRoot });
      lines.push(r.signalled ? `[stories] stopped pid ${pid} (SIGKILL, survived SIGTERM)` : `[stories] census: ${r.reason}`);
    }
    census = await censusOf();
  }
  lines.push(...describeCensus(census));

  if (!census.empty) {
    lines.push(
      `[stories] REFUSING to release _queue/in-flight/: ${census.reason} — clearing now would race a live ` +
      'writer, which is the defect this census exists to close. The claim STAYS; the next run\'s residue ' +
      'door will report it, at $0.',
    );
    return { sched, census, release: null, deferred: null, lines };
  }

  // ROW 166 follow-up — CAPTURE-THEN-CLEAR FIRST, before `release` below ever
  // `rmSync`s the same manifest uncaptured: an initiative this window can
  // attribute is claimed with its evidence kept and its worktrees/dispatch
  // dir cleared, exactly what the per-story sweep deferred while this daemon
  // was alive. `release` still runs straight after, unchanged, as the
  // path-attributed backstop for whatever this claim did not attribute.
  const { deferred, lines: deferredLines } = runDeferredClear();
  lines.push(...deferredLines);

  const rel = release(root);
  for (const p of rel.released) {
    lines.push(`[stories] released _queue/in-flight/${p} — this tree's claim, held by a daemon that could not drain`);
  }
  for (const f of rel.failed) lines.push(`[stories] could not release _queue/in-flight/${f.path}: ${f.error}`);

  // RE-READ, because the census above cannot see a writer that shares no
  // ancestry with the daemon at all (T1 1332).
  await sleep(rereadDelayMs);
  const reappeared = rel.released.filter((name) => existsSync(join(root, '_queue', 'in-flight', name)));
  for (const p of reappeared) {
    lines.push(
      `[stories] RELEASE DID NOT HOLD: _queue/in-flight/${p} reappeared after the census reported empty — ` +
      'a writer outside the census survived it. NOT claiming this release is clean.',
    );
  }

  return { sched, census, release: { ...rel, reappeared }, deferred, lines };
}

/** Poll until `pid`'s process GROUP has no live member or `boundMs` passes —
 *  the async sibling of `stop-path.mjs`'s own `waitGroupGone`. That one is
 *  deliberately `Atomics.wait`-synchronous (a signal handler must not yield
 *  to the event loop); a run's own `finally` block has no such constraint,
 *  so this yields with a plain `setTimeout` instead, reusing the SAME
 *  `/proc` read (`liveGroupMembers`) rather than a second one. */
async function waitBridgeGroupGoneAsync(pid, boundMs, membersOf = liveGroupMembers, pollMs = 100) {
  const steps = Math.max(1, Math.ceil(boundMs / pollMs));
  for (let i = 0; i <= steps; i += 1) {
    const live = membersOf(pid);
    if (live !== null && live.length === 0) return { gone: true, waitedMs: i * pollMs };
    if (i < steps) await new Promise((r) => setTimeout(r, pollMs));
  }
  return { gone: false, waitedMs: steps * pollMs };
}

/**
 * End this run's own Studio FIRST, THEN stop the scheduler daemon it
 * supervises — the studio-then-serve half of a run's own teardown.
 *
 * Calling `stopSchedulerCensusAndRelease` (through it, `stopOwnScheduler`)
 * WHILE this run's own `forge studio` — `bridgeProc` — is still alive and
 * still supervising `forge serve` sends a second, unrelated SIGTERM to a pid
 * the SUPERVISOR owns. The supervisor's own poll reads that as the daemon
 * CRASHING — so it respawns a fresh `forge serve`, within its own ~2 s poll
 * tick, after the census has already run. An unaccounted serve, claiming
 * whatever sits in `_queue/pending/`, is exactly what a batch's own teardown
 * exists to leave behind never.
 *
 * NEVER SIGNAL SERVE WHILE ITS SUPERVISOR IS ALIVE. `forge studio`'s own
 * exit sequence (`apps/forge/forge-watch.ts`'s `shutdown` → `runExitSequence`)
 * stops its serve supervisor SYNCHRONOUSLY — marking the daemon stopping and
 * sending it ONE SIGTERM — before the studio process itself ever exits. So
 * this function kills `bridgeProc`'s WHOLE process group first and waits,
 * bounded, for it to be fully gone (escalating to SIGKILL past that bound)
 * BEFORE `stopSchedulerCensusAndRelease` is ever called: by the time that
 * call runs, studio is gone and has nothing left to signal, and
 * `stopOwnScheduler` sees the marker already there and only waits for the
 * drain, never signals again (`scheduler.ts` treats a second SIGTERM as an
 * operator's force-quit).
 *
 * Returns `stopSchedulerCensusAndRelease`'s own result shape, plus `bridge`
 * — so `teardownExitCode` (which reads only `.census` and `.release`) and
 * every other caller of the scheduler half work against this wrapper
 * exactly as they would against the bare call.
 *
 * @param {string} root this run's own worktree
 * @param {{pid: number}|null} bridgeProc this run's own bridge, or null when it reused one
 * @param {object} schedulerOpts passed straight through to `stopSchedulerCensusAndRelease` ({sinceMs} required)
 * @param {{killBridgeGroup?: typeof killBridgeProcessGroup, waitBridgeGroupGone?: typeof waitBridgeGroupGoneAsync,
 *          stopScheduler?: typeof stopSchedulerCensusAndRelease, bridgeExitBoundMs?: number,
 *          bridgeKillGraceMs?: number}} [deps]
 * @returns {Promise<{bridge: {gone: boolean, waitedMs: number, signal: string}|null, lines: string[]} & object>}
 */
export async function stopStudioThenScheduler(root, bridgeProc, schedulerOpts, deps = {}) {
  const killGroup = deps.killBridgeGroup ?? killBridgeProcessGroup;
  const waitGone = deps.waitBridgeGroupGone ?? waitBridgeGroupGoneAsync;
  const stopScheduler = deps.stopScheduler ?? stopSchedulerCensusAndRelease;
  const bridgeExitBoundMs = deps.bridgeExitBoundMs ?? BRIDGE_EXIT_BOUND_MS;
  const bridgeKillGraceMs = deps.bridgeKillGraceMs ?? BRIDGE_KILL_GRACE_MS;

  const bridgeLines = [];
  let bridge = null;
  if (bridgeProc !== null) {
    bridgeLines.push(
      `[stories] ending this run's own studio (pid ${bridgeProc.pid}) — its own exit sequence stops the ` +
      'scheduler daemon it supervises before this teardown ever looks at it',
    );
    killGroup(bridgeProc, 'SIGTERM');
    bridge = { ...(await waitGone(bridgeProc.pid, bridgeExitBoundMs)), signal: 'SIGTERM' };
    if (!bridge.gone) {
      killGroup(bridgeProc, 'SIGKILL');
      const after = await waitGone(bridgeProc.pid, bridgeKillGraceMs);
      bridge = { gone: after.gone, waitedMs: bridge.waitedMs + after.waitedMs, signal: 'SIGKILL' };
    }
    bridgeLines.push(
      `[stories] studio ${bridgeProc.pid} ` +
      (bridge.gone
        ? `exited after ${bridge.waitedMs} ms (${bridge.signal})`
        : `STILL ALIVE after ${bridge.waitedMs} ms and a SIGKILL`),
    );
  }

  const stop = await stopScheduler(root, schedulerOpts);
  return { ...stop, bridge, lines: [...bridgeLines, ...stop.lines] };
}

/**
 * `quiesceWriters` + the story's trailing sweep, WITH THE GAP CLOSED — finding
 * row 75's OTHER half (T1 rulings 1258, 1332). `run-story.mjs` used to call
 * `quiesceWriters` (which only PRINTS whether the tree settled) and then call
 * `sweepProductFixtures` regardless of what it found — the exact shape that
 * closed at the scheduler in `stopSchedulerCensusAndRelease`, at the second
 * call site the same finding named: `_queue/*<state>/<id>.md.heartbeat`,
 * `_worktrees/<id>`, this run's `_logs/<ts>_<id>` cycle dir
 * (`captureAndClearMintedRunArtefacts`, reached through `sweepProductFixtures`).
 *
 * `reapAgentRuns` (run-story.mjs, unchanged, called before this) already
 * snapshots-then-signals every pid it can attribute to this run — descendants,
 * process group, marker-swept stragglers — TERM then bounded-wait then KILL.
 * What it does NOT do is confirm the kernel finished tearing each one down
 * before returning: `kill()` not throwing says a signal was DELIVERED, never
 * that the target is gone, and under this campaign's own CPU-starvation
 * conditions that gap is measured, not theoretical (T3 rule 9; the scheduler
 * half's own header quotes the 13s/2.7min numbers).
 *
 * SO THIS TAKES A SECOND, FRESH SNAPSHOT of every reaped pid's descendants —
 * `reapAgentRuns`'s own snapshot is stale the instant it returns — TERMs
 * anything still there directly (belt over `reapAgentRuns`'s own kill, for a
 * straggler its bounded wait gave up on or a child spawned in the narrow
 * window between that snapshot and its signal), censuses with the SAME
 * `waitForCensusEmpty` the scheduler half uses, escalates to SIGKILL on
 * survivors, and re-censuses once. Only a census-empty result reaches the
 * clear; a non-empty one REFUSES IT ENTIRELY and says why, by name.
 *
 * THE RE-READ IS A SEPARATE CHECK, not a formality: a writer that shares no
 * ancestry with anything this run dispatched at all — the second door T1 1332
 * names — is invisible to a tree-membership census by construction, and only
 * re-reading the exact paths `captureAndClearMintedRunArtefacts` reported
 * CLEARED can catch it.
 *
 * `quiesceWriters` itself is UNCHANGED and still only prints — its own
 * git-porcelain tree-quiet check is a different, broader question (does
 * ANYTHING in the whole tree keep moving) than this census (does something
 * still descend from a pid this run dispatched), and narrowing its role here
 * would be a second, silent behaviour change nobody asked for.
 *
 * MUST 2 (D's review of #906) — EVERY SIGNAL HERE GOES THROUGH `verifiedKill`,
 * NEVER A BARE `process.kill(pid, sig)`. `reapedPids` and every descendant the
 * fresh snapshot below finds are recorded as `{pid, startTime}` identities
 * (`identifyPid`) the INSTANT they are found, and re-verified immediately
 * before each signal — a pid this run recorded can be recycled by an
 * unrelated process on this four-lane host before the signal lands.
 *
 * @param {{root: string, storyId: string, sinceMs: number, groundProject?: string,
 *   evidenceDir: string, reapedPids: (number|string)[], schedulerPid?: number|null,
 *   schedulerAlive?: boolean,
 *   quiesce?: typeof quiesceWriters, sweep?: typeof sweepProductFixtures,
 *   censusBoundMs?: number, censusPollMs?: number, procRoot?: string,
 *   rereadDelayMs?: number, sleep?: (ms: number) => Promise<void>}} args
 * @returns {Promise<{quiesce: object, census: object, sweep: object|null,
 *   reappearedArtefacts: string[], lines: string[], warnLines: string[]}>}
 */
export async function reapCensusAndSweep({
  root, storyId, sinceMs, groundProject, evidenceDir, reapedPids,
  // T1 1418 — S10's agents are dispatched by the SCHEDULER this run started,
  // not by the runner, so `reapedPids` reads empty and the census below would
  // trivially pass BEFORE that dispatch is dead. Resolved BELOW to THIS run's
  // own scheduler (`ownSchedulerPidState`, the same ownership test
  // `stopOwnScheduler` applies) — never a bare injected pid a caller could
  // point at a process this run does not own. `null` (a test proving the OLD,
  // scheduler-blind shape) opts out and skips resolution entirely; omitted
  // (`undefined`) is the production default, resolved via `ownSchedulerPidState`
  // so an UNKNOWN read (ROW 101 / M7-D finding 2) can refuse rather than
  // silently default to null the way a direct `ownSchedulerPid(root)` default
  // expression would.
  schedulerPid,
  // ROW 166 (S10 run 44) — whether THAT scheduler's own in-process heartbeat
  // writer (`scheduler-run-one.ts`'s `setInterval`, never a spawned
  // descendant) must be treated as still live. Omitted (`undefined`) is the
  // production default, resolved below from `schedulerPid` once it is known —
  // a test can still override it directly to stand in for the OLD,
  // writer-blind shape, the same seam `schedulerPid` itself offers.
  schedulerAlive,
  // M7-D — grounds the sweep must NOT remove yet (a fixture ground is judged
  // before its teardown); passed straight through to `sweepProductFixtures`.
  keepProjects,
  quiesce = quiesceWriters, sweep = sweepProductFixtures,
  // Injected exactly like `reapAgentRuns`'s own `procTable`/`kill` seam
  // (reap.mjs) — not for symmetry, but because a fixed or fabricated root
  // pid in a test must never reach the REAL `/proc`: `descendantsOf(1, ...)`
  // against a real process table is every process on the host, and this
  // function would then SIGTERM all of them.
  procTable = () => readProcTable(),
  kill = (pid, sig) => process.kill(pid, sig),
  censusBoundMs = 5000, censusPollMs = 100, procRoot = '/proc', listPids,
  rereadDelayMs = 250, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const quiesceResult = await quiesce({ root, pids: reapedPids });
  const lines = [...describeQuiesce(quiesceResult)];

  const refuse = (reason) => ({
    quiesce: quiesceResult,
    census: { empty: false, survivors: null, waitedMs: 0, reason },
    sweep: null, reappearedArtefacts: [], lines, warnLines: [],
  });

  if (schedulerPid === undefined) {
    const state = ownSchedulerPidState(root);
    if (state.unknown) {
      // ROW 101 / M7-D finding 2 — an UNKNOWN scheduler state is NOT "no
      // scheduler": defaulting to null here would silently exclude a live
      // dispatch's whole descendant tree from the census below.
      const reason = `could not determine this run's own scheduler (${state.error}) — clearing now could race a live dispatch, which is the defect this census exists to close`;
      lines.push(`[stories] REFUSING to run the trailing sweep — ${reason}. Nothing was cleared; the next run's residue door will report it, at $0.`);
      return refuse(reason);
    }
    schedulerPid = state.pid;
  }
  // ROW 166 — the writer census `claimQueueWrites` cannot perform itself
  // (queue-claim.mjs's own header). Defaulted from the JUST-resolved
  // `schedulerPid` so a real caller (`run-story.mjs`) needs no new argument,
  // exactly as `schedulerPid` itself required none once T1 1418 landed.
  if (schedulerAlive === undefined) schedulerAlive = schedulerPid !== null;

  // ROW 101 / M7-D residual — `reapedPids` (`run-story.mjs`'s
  // `reap.reaped.map((r) => r.pid)`) never carries a PID_READ_UNKNOWN row: it
  // lands in `reap.skipped`, so an unreadable `_logs/` or `turn.pid` from
  // THIS run's own dispatch collection can pass through as an empty,
  // CONFIRMED `reapedPids` set. Re-derive the same read independently rather
  // than trust it — `run-story.mjs` sits at its own 800-line cap and cannot
  // thread a flag through instead.
  const agentRuns = agentRunsReadable(root, sinceMs);
  if (!agentRuns.readable) {
    const reason = `this run's own dispatched-agent collection could not be confirmed (${agentRuns.error}) — clearing now could race a live agent this run failed to enumerate`;
    lines.push(`[stories] REFUSING to run the trailing sweep — ${reason}, which is the defect this census exists to close. Nothing was cleared; the next run's residue door will report it, at $0.`);
    return refuse(reason);
  }

  const bareRoots = (reapedPids ?? []).filter((p) => p !== null && p !== undefined);
  // BEFORE ANY SIGNAL OF THIS PASS — `reapAgentRuns`'s own snapshot is already
  // stale, so this is a fresh one, and it has to precede the TERM below for
  // the same reason the scheduler half's does (5.45: once a pid is truly
  // gone the kernel has already reparented whatever it had). MUST 2 —
  // identities captured HERE, at the moment of discovery.
  const rootIdentities = bareRoots.map((pid) => identifyPid(pid, { procRoot }));
  const table = (bareRoots.length > 0 || schedulerPid !== null) ? procTable() : new Map();
  if (table === null) {
    // ROW 101 / M7-D finding 6 — a table build failure must never render as
    // "no descendants": `censusSurvivors`'s own good pattern, applied here.
    const reason = 'the process table could not be read, so a live descendant cannot be ruled out';
    lines.push(`[stories] REFUSING to run the trailing sweep — ${reason}, which is the defect this census exists to close. Nothing was cleared; the next run's residue door will report it, at $0.`);
    return refuse(reason);
  }
  // T1 1418 — the scheduler's OWN dispatch descendants join the SAME census
  // and the SAME TERM/KILL escalation below, never the scheduler pid itself:
  // it stays alive for the next story in the batch (`run.mjs` stops it at
  // batch end, unchanged). `descendantsOf` already excludes its own root, the
  // same guarantee `stopSchedulerCensusAndRelease` relies on for this read.
  const schedulerDescendants = schedulerPid === null ? [] : descendantsOf(schedulerPid, table);
  const freshDescendants = [...new Set([
    ...bareRoots.flatMap((pid) => descendantsOf(pid, table)),
    ...schedulerDescendants,
  ])];
  const descendantIdentities = freshDescendants.map((pid) => identifyPid(pid, { procRoot }));
  for (const identity of descendantIdentities) {
    const r = verifiedKill(identity, 'SIGTERM', { kill, procRoot });
    if (!r.signalled) lines.push(`[stories] census: ${r.reason}`);
  }
  const roots = [...rootIdentities, ...descendantIdentities];
  const censusOf = () => waitForCensusEmpty(roots, { boundMs: censusBoundMs, pollMs: censusPollMs, procRoot, listPids });
  let census = await censusOf();
  if (!census.empty && census.survivors !== null) {
    for (const pid of census.survivors) {
      const r = verifiedKill(identifyPid(pid, { procRoot }), 'SIGKILL', { kill, procRoot });
      if (!r.signalled) lines.push(`[stories] census: ${r.reason}`);
    }
    census = await censusOf();
  }
  lines.push(...describeCensus(census));

  if (!census.empty) {
    lines.push(
      `[stories] REFUSING to run the trailing sweep — ${census.reason} — clearing _queue/, _worktrees/ or ` +
      'this run\'s ground now would race a live writer, which is the defect this census exists to close. ' +
      'Nothing was cleared; the next run\'s residue door will report it, at $0.',
    );
    return { quiesce: quiesceResult, census, sweep: null, reappearedArtefacts: [], lines, warnLines: [] };
  }

  const sweepResult = sweep(storyId, root, {
    sinceMs, groundProject, evidenceDir, schedulerAlive, ...(keepProjects ? { keepProjects } : {}),
  });
  lines.push(
    ...sweepResult.lines, // 7.6.74: the removals AND the cycle's own queue writes, which no story-id glob reaches
  );
  const warnLines = (sweepResult.failed ?? []).map(
    (f) => `[stories] trailing sweep could not remove ${f.path}: ${f.error}`,
  );

  // RE-READ, because the census above cannot see a writer that shares no
  // ancestry with anything this run dispatched at all (T1 1332) — that
  // writer was never a candidate for the kill or the census above, so only
  // reading the exact paths back can catch it.
  await sleep(rereadDelayMs);
  const reappearedArtefacts = (sweepResult.artefacts?.cleared ?? []).filter((rel) => existsSync(join(root, rel)));
  for (const rel of reappearedArtefacts) {
    lines.push(
      `[stories] ARTEFACT CLEAR DID NOT HOLD: ${rel} reappeared after the census reported empty — a writer ` +
      'outside the census survived it. NOT claiming this clear is clean.',
    );
  }

  return { quiesce: quiesceResult, census, sweep: sweepResult, reappearedArtefacts, lines, warnLines };
}

/**
 * Fold a completed `stopSchedulerCensusAndRelease` result into the run's exit
 * code — MUST 1 (D's review of #906). `run.mjs`'s `finally` called
 * `stopSchedulerCensusAndRelease`, printed its lines, and never read
 * `stop.census` or `stop.release.reappeared` again: a surviving daemon
 * grandchild printed `REFUSING to release…` or `RELEASE DID NOT HOLD…` and
 * the process still exited 0 on an otherwise-green run. "Never a silent
 * CLEARED" has to hold at the LAST place a run can still say so, not only in
 * the log lines a caller may not be reading.
 *
 * A PURE FOLD, deliberately, so it is the seam a test can drive with an
 * INJECTED `stop` result rather than through `main()` itself — which boots a
 * real bridge and a real browser and cannot be unit-tested at all.
 *
 * `exitCode` passes through UNCHANGED when the teardown held, whatever it
 * was — a story's own red survives a clean teardown exactly as it was. A
 * teardown failure forces it non-zero only when it was still `0`; a run
 * already red for its own reason keeps that SPECIFIC code, never flattened
 * to a generic `1`.
 *
 * @param {number} exitCode the exit code this run had BEFORE the teardown
 * @param {{census: {empty: boolean, reason: string}|null,
 *           release: {reappeared?: string[]}|null}} stop
 * @returns {{exitCode: number, lines: string[]}}
 */
export function teardownExitCode(exitCode, stop) {
  const lines = [];
  let code = exitCode;

  const censusFailed = stop.census !== null && stop.census.empty === false;
  if (censusFailed) {
    lines.push(
      `[stories] TEARDOWN FAILURE: the scheduler teardown's census never settled (${stop.census.reason}) — ` +
      'this run cannot be reported green.',
    );
    if (code === 0) code = 1;
  }

  const reappeared = stop.release?.reappeared ?? [];
  if (reappeared.length > 0) {
    lines.push(
      `[stories] TEARDOWN FAILURE: ${reappeared.join(', ')} reappeared in _queue/in-flight/ after this run's ` +
      'teardown reported it released — this run cannot be reported green.',
    );
    if (code === 0) code = 1;
  }

  return { exitCode: code, lines };
}
