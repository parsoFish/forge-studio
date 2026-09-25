/**
 * Per-beat observation helpers for the story runner — split out of `run.mjs`
 * when it crossed the 800-line cap (§0). SPLIT, NEVER BASELINE (492).
 *
 * These three are what a beat boundary needs and the run loop does not: the
 * event rows a dispatched run has written so far, and the host state beside
 * them. They travel together because they answer one question — what was true
 * on this box at this beat — and `run.mjs` only orchestrates.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { EMIT_FAILED_SIDECAR } from '@forge/sessions';
import { summariseRunSpend, spendCeilingVerdict, endedUnpricedTurns, ceilingHaltVerdict, classifyUnmeasuredDispatch } from './spend.mjs';
import { FS_CLOCK_SLACK_MS } from './beats-queue-terminal.mjs';
import { join, basename } from 'node:path';

/**
 * One dispatched run's event rows, or [] — an unreadable log is UNMEASURED,
 * never a silent zero (bead `forge-8vfn.6.11.8`).
 *
 * m7-d-guard-unknown-audit.md rows 24-25. ENOENT is a genuine absence — no
 * dispatch has written here yet, decided upstream by `summariseRunSpend`,
 * which knows whether a spawn was real. Anything else (EACCES, EIO, EMFILE)
 * means the log may EXIST and be unreadable, which must never render the same
 * as "nothing here" — the run would keep spending with this dir's portion
 * invisible. A torn/unparseable line used to vanish as a silent `{}`, exactly
 * the crash-mid-write case this module exists for; it is now EVIDENCE,
 * mirroring `readEmitFailures`' own unparseable-line pattern below.
 *
 * BOTH FACTS ARE CARRIED ON THE ARRAY ITSELF (`.unknown`), never a second
 * return shape: every existing caller that only wants rows (`reap.mjs`'s
 * default pricing reader, `readDispatchSnapshot`'s `.length`) keeps working
 * unchanged; `spendSoFar` is the one caller that looks for `.unknown`.
 *
 * @returns {object[] & {unknown?: {dir: string, error: string}[]}}
 */
export function readRunEvents(dir) {
  let text;
  try {
    text = readFileSync(join(dir, 'events.jsonl'), 'utf8');
  } catch (err) {
    const rows = [];
    if (err && err.code !== 'ENOENT') {
      rows.unknown = [{ dir, error: `${err?.code ?? 'read failed'}: ${err?.message ?? String(err)}` }];
    }
    return rows;
  }
  const rows = [];
  const unknown = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      rows.push({ event_id: null, cost_usd: null, error: 'unparseable event line' });
      unknown.push({ dir, error: 'unparseable event line' });
    }
  }
  if (unknown.length > 0) rows.unknown = unknown;
  return rows;
}

/** How much of `stderr.log`'s tail a snapshot carries — generous enough to
 *  hold a crash reason, small enough never to flood a beat's console line. */
const STDERR_SNAPSHOT_TAIL_BYTES = 2000;

/** Injectable seams for `readDispatchSnapshot`, so a test never touches a
 *  real `/proc` or a real file. */
const DEFAULT_SNAPSHOT_SEAMS = {
  readPid(dir) {
    try {
      const n = Number(readFileSync(join(dir, 'turn.pid'), 'utf8').trim());
      return Number.isInteger(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  },
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  readStderrTail(dir) {
    try {
      const text = readFileSync(join(dir, 'stderr.log'), 'utf8');
      return text.length > STDERR_SNAPSHOT_TAIL_BYTES ? text.slice(-STDERR_SNAPSHOT_TAIL_BYTES) : text;
    } catch {
      return '';
    }
  },
  // No on-disk convention records an SDK child's exit code today — this is a
  // seam for the day one exists, and `classifyUnmeasuredDispatch` already
  // reports `null` as "unrecorded" rather than a false 0.
  readExitCode() {
    return null;
  },
};

/**
 * ONE read of a dispatch directory's liveness signals — the read half of the
 * UNMEASURED discriminator (bead `forge-8vfn.7.6.76`). `classifyUnmeasuredDispatch`
 * (`spend.mjs`) is the pure judgement over two of these; this is the impure
 * half that takes one.
 *
 * `eventLines` reuses `readRunEvents` rather than a second parse, so "many
 * lines" always means what the spend accounting already means by it.
 *
 * @param {string} dir
 * @param {Partial<typeof DEFAULT_SNAPSHOT_SEAMS>} [seams]
 * @returns {{pid: number|null, alive: boolean, eventLines: number, stderrTail: string, exitCode: number|null}}
 */
export function readDispatchSnapshot(dir, seams = {}) {
  const s = { ...DEFAULT_SNAPSHOT_SEAMS, ...seams };
  const pid = s.readPid(dir);
  return {
    pid,
    alive: pid !== null && s.isAlive(pid),
    eventLines: readRunEvents(dir).length,
    stderrTail: s.readStderrTail(dir),
    exitCode: s.readExitCode(dir),
  };
}

/**
 * One dispatched run's EMIT FAILURES — `forge-8vfn.7.6.103`, T1 1037/1039.
 *
 * THIS READ FAILS CLOSED, AND THAT IS THE WHOLE POINT OF THE BEAD (C's review).
 * The defect being fixed is a `catch {}` around a write. A reader that wrapped
 * this in `catch { return [] }` would reproduce that defect one layer out — and
 * WORSE, because the failures are CORRELATED: a full disk or a revoked handle
 * breaks the row write AND this read, so the case where the sidecar matters
 * most is the case where reading it is most likely to fail. The obvious
 * defensive shape is the wrong one here.
 *
 * THREE STATES, NOT TWO (§15.504), at the read this time:
 *   ENOENT            no sidecar -> no failure was recorded. Genuine ABSENCE.
 *   anything else     EACCES, EIO, EISDIR, a malformed line — UNKNOWN. The
 *                     signal may exist and be unreadable, which must never be
 *                     spelled as absence.
 * Both non-absent states halt; the caller distinguishes them only to report.
 *
 * Note `readRunEvents` above DOES `catch { return [] }`. That is about
 * `events.jsonl`, whose absence is already covered by the unpriced arm, and it
 * is not a licence to do the same here — the sidecar exists precisely to be the
 * thing that survives when the row could not be written.
 *
 * @returns {{failures: object[], unreadable: {dir: string, error: string}[]}}
 */
export function readEmitFailures(dir) {
  const path = join(dir, EMIT_FAILED_SIDECAR);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { failures: [], unreadable: [] };
    return { failures: [], unreadable: [{ dir, error: `${err?.code ?? 'read failed'}: ${err?.message ?? String(err)}` }] };
  }
  const failures = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      failures.push(JSON.parse(line));
    } catch {
      // A line that will not parse is still EVIDENCE that a write failed —
      // something wrote here. Counted, never discarded.
      failures.push({ at: null, message: null, error: 'unparseable sidecar line' });
    }
  }
  return { failures, unreadable: [] };
}

/** Host state for §15.439's per-beat record. Never throws: an unreadable
 *  /proc is reported as `unknown`, because a missing measurement must not
 *  render as a good one. */
export function hostState() {
  let load = 'unknown';
  let memGiB = 'unknown';
  try { load = readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' '); } catch { /* unknown */ }
  try {
    const m = /MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'));
    if (m !== null) memGiB = (Number(m[1]) / 1048576).toFixed(1);
  } catch { /* unknown */ }
  return { load, memGiB };
}


/**
 * Every dispatch directory this run may have SPENT in — bead `forge-rzrs`.
 *
 * NOT `collectAgentRuns`. That is the REAPER's collector and its last gate is
 * `if (pid === null && markers.length === 0) continue` (`reap.mjs:190`): it
 * answers "which directories could I kill", which is the right question for a
 * reaper and the wrong one for money. A cycle's phase directory carries no
 * `turn.pid`, so on S10 run 15 the project-manager's $0.6774 never reached an
 * ENFORCED $35 ceiling — 23.6% of the real spend, invisible.
 *
 * The rule here is the other one: **a dispatch that spent is one that wrote an
 * event log.** Directories with no `events.jsonl` cannot have priced anything;
 * directories older than the run belong to a previous one.
 *
 * Collecting BOTH directories is only safe because `summariseRunSpend` counts
 * by `event_id` — a cycle channel re-logs the architect's own terminal row, so
 * a union without that notion of sameness double-counts (T1 864).
 *
 * m7-d-guard-unknown-audit.md rows 26-27, PLUS the coarse-clock exclusion
 * below. ENOENT on the `_logs/` readdir really is "this run dispatched
 * nothing" (UNMEASURED is decided upstream by `summariseRunSpend`); anything
 * else means `_logs/` EXISTS and cannot be enumerated — the worst case in the
 * cluster, since it blinds the ceiling to 100% of the run's spend for as long
 * as the condition persists. A per-entry stat failure that is not ENOENT has
 * the same shape one level down: that ONE dispatch dir's spend would vanish
 * permanently and silently from every subsequent read. Both are named on the
 * returned array itself (`.unknown`), never silent.
 *
 * @param {string} root the worktree
 * @param {number} sinceMs this run's start; older dispatches are not its spend
 * @returns {string[] & {unknown?: {dir: string, error: string}[]}} absolute directory paths
 */
export function collectSpendDirs(root, sinceMs) {
  const logsDir = join(root, '_logs');
  let entries;
  try {
    entries = readdirSync(logsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (err) {
    const dirs = [];
    if (err && err.code !== 'ENOENT') {
      dirs.unknown = [{ dir: logsDir, error: `${err?.code ?? 'read failed'}: ${err?.message ?? String(err)}` }];
    }
    return dirs;
  }
  const dirs = [];
  const unknown = [];
  for (const e of entries) {
    const dir = join(logsDir, e.name);
    let mtimeMs;
    try {
      mtimeMs = statSync(dir).mtimeMs;
    } catch (err) {
      if (err && err.code === 'ENOENT') continue; // raced away between readdir and stat — honestly gone
      unknown.push({ dir, error: `${err?.code ?? 'read failed'}: ${err?.message ?? String(err)}` });
      continue;
    }
    // FS_CLOCK_SLACK_MS (`beats-queue-terminal.mjs`) — a dispatch dir created
    // right at run start can carry a kernel-coarse mtime that trails
    // `Date.now()`'s own anchor (measured on this host: a write strictly
    // AFTER an anchor stamped 1.1ms BEFORE it). Without the slack, a dir born
    // at `sinceMs` is invisible to the ceiling for the run's entire life.
    if (mtimeMs < sinceMs - FS_CLOCK_SLACK_MS) continue;
    if (!existsSync(join(dir, 'events.jsonl'))) continue;
    dirs.push(dir);
  }
  if (unknown.length > 0) dirs.unknown = unknown;
  return dirs;
}

/**
 * What this run has spent so far, and every line worth printing about it.
 *
 * Lives here rather than in `run.mjs` because it is the same question the rest
 * of this module answers — what was true on this box at this beat — and because
 * the run loop orchestrates rather than accounts. `run.mjs` crossed the 800-line
 * cap when the `forge-rzrs` comments landed; SPLIT, NEVER BASELINE (492).
 *
 * A DISAGREEMENT BETWEEN THE TWO ACCOUNTS IS A PRODUCT FINDING (T1 867): the
 * higher is counted so a ceiling cannot under-report, and the fact that a cycle
 * log and a phase's own session disagree is never swallowed by the number that
 * won.
 *
 * THE VERDICT IS RETURNED AS A VALUE, NEVER ONLY AS A LINE (bead `forge-91cr`).
 * The first cut of this function rendered `spendCeilingVerdict` into `lines`
 * and returned nothing else, and `run.mjs`'s `if (v.breached)` was left reading
 * a name that no longer existed — every costed run threw `ReferenceError` at
 * its first beat boundary, escaped the catch-less `try`, and skipped its own
 * reap. §15.449 recurring inside the fix for itself: A CEILING IN A STRING IS A
 * LABEL, and the caller that must decide cannot read a sentence.
 *
 * AND THE HALT IS A VALUE FOR THE SAME REASON (7.6.71). `stop` says whether
 * this boundary ends the run and WHY — a breach on a number, or a ceiling that
 * went blind when a turn ended unpriced. The caller branches on `stop.halt`; it
 * never parses `lines`.
 *
 * @returns {{spend: ReturnType<typeof summariseRunSpend>, verdict: ReturnType<typeof spendCeilingVerdict>, unpriced: ReturnType<typeof endedUnpricedTurns>, stop: ReturnType<typeof ceilingHaltVerdict>, lines: string[]}}
 */
/**
 * Bead `forge-8vfn.7.6.92` — THE LAST JUDGEMENT, made where the spend is last read.
 *
 * The beat loop asks `spendSoFar` at every boundary; a turn that ENDS after the
 * last one — unpriced, or past the ceiling — used to be printed by the final
 * spend column and never judged, so the run read as complete with an unpriced
 * end in its own ledger. Same rows, same verdict (`ceilingHaltVerdict` via
 * `spendSoFar`), read once more. A run the loop already halted is not judged
 * twice: its first headline is the one that explains it.
 *
 * @returns {{ stop: ReturnType<typeof ceilingHaltVerdict> | null, lines: string[] }}
 */
export function finalSpendHalt({ root, startedMs, realSpawn, ceilingUsd, alreadyHalted, unmeasuredSnapshots = new Map(), snapshotSeams }) {
  if (alreadyHalted) return { stop: null, lines: [] };
  const { stop, lines } = spendSoFar({
    root, startedMs, realSpawn, ceilingUsd, label: 'at the final spend read', unmeasuredSnapshots, snapshotSeams,
  });
  return { stop: stop.halt ? stop : null, lines };
}

/**
 * @param {Map<string, ReturnType<typeof readDispatchSnapshot>>} [unmeasuredSnapshots]
 *   THE RUN LOOP'S OWN STATE, bead `forge-8vfn.7.6.76` — never a module-level
 *   `Map`, which two concurrent runs (this box runs four lanes) would share.
 *   Defaulted here only for a caller with one call site (tests, mainly); the
 *   production caller creates ONE and passes the SAME instance to every beat
 *   boundary, exactly as `pressedAt` already does for the press anchor — a
 *   fresh default per call would forget growth between beats, which is the
 *   whole fact this mechanism exists to see.
 */
export function spendSoFar({ root, startedMs, realSpawn, ceilingUsd, label, unmeasuredSnapshots = new Map(), snapshotSeams }) {
  // COLLECTED BY `collectSpendDirs`, NOT BY THE REAPER'S COLLECTOR
  // (`forge-rzrs`): `collectAgentRuns` gates on `turn.pid`/markers — the
  // directories it could KILL — and a cycle's phase dir has neither, so S10
  // run 15 enforced a $35 ceiling against 76.4% of its own spend. Read ONCE
  // and shared: the money and the unpriced-turn question are two readings of
  // the same rows, and two collections could disagree about which run they are
  // describing.
  const dirs = collectSpendDirs(root, startedMs);
  const events = dirs.map(readRunEvents);
  const spend = summariseRunSpend({ realSpawn, events });
  const v = spendCeilingVerdict(spend, ceilingUsd);
  const unpriced = endedUnpricedTurns(events);
  // 7.6.103 — read from the SAME dirs as the rows, so a run cannot have its
  // spend read from one place and its emit failures from another.
  const emitFailures = dirs.map(readEmitFailures).reduce(
    (acc, r) => ({ failures: acc.failures.concat(r.failures), unreadable: acc.unreadable.concat(r.unreadable) }),
    { failures: [], unreadable: [] },
  );
  // m7-d-guard-unknown-audit.md rows 24-27 — spend reads that could not be
  // trusted at all: an unreadable `_logs/`, a stat failure on one dispatch
  // dir, an unreadable `events.jsonl`, or a torn line inside one. None of
  // these render as "$0" or "nothing here"; `ceilingHaltVerdict` halts on
  // them exactly as it halts on a ledger row that failed to write.
  const spendUnknown = [...(dirs.unknown ?? []), ...events.flatMap((e) => e.unknown ?? [])];
  const stop = ceilingHaltVerdict({ spend, ceilingUsd, unpriced, emitFailures, spendUnknown });
  const lines = [`[stories] spend ${label}: ${v.reason}`];
  for (const n of spend.notes ?? []) lines.push(`[stories] spend: ${n}`);
  // `forge-8vfn.7.6.76` — THE ARM ITSELF, PRINTED. A classifier only reachable
  // by import does not close this bead: every dir that MIGHT be why nothing
  // has priced gets read now, judged against its own previous read (absent on
  // the first call, which `classifyUnmeasuredDispatch` already treats as
  // growth from zero), and the previous-read Map is updated so the NEXT beat
  // boundary compares against THIS one.
  if (spend.measured === false) {
    for (const dir of dirs) {
      const current = readDispatchSnapshot(dir, snapshotSeams);
      const arm = classifyUnmeasuredDispatch(current, unmeasuredSnapshots.get(dir));
      lines.push(`[stories] spend ${label}: UNMEASURED ${basename(dir)} — ${arm.detail}`);
      unmeasuredSnapshots.set(dir, current);
    }
  }
  // PRINTED EVERY BEAT once it is true, not only at the halt: the run that
  // went blind should say so in the transcript at the beat it happened, and a
  // guard that speaks only when it fires reads like one that never ran.
  for (const t of unpriced) {
    lines.push(`[stories] spend ${label}: a turn ENDED UNPRICED — reason=${t.reason}, tokens_out=${t.tokensOut ?? 'unrecorded'}, tokens_in=${t.tokensIn ?? 'unrecorded'}, session=${t.sessionId}`);
  }
  for (const f of emitFailures.failures) {
    lines.push(`[stories] spend ${label}: a ledger row FAILED TO WRITE — message=${f.message ?? 'unrecorded'}, error=${f.error ?? 'unrecorded'}`);
  }
  for (const u of emitFailures.unreadable) {
    lines.push(`[stories] spend ${label}: the emit-failure sidecar could not be READ at ${u.dir} — ${u.error}`);
  }
  for (const u of spendUnknown) {
    lines.push(`[stories] spend ${label}: this run's own spend could not be fully READ at ${u.dir} — ${u.error}`);
  }
  return { spend, verdict: v, unpriced, emitFailures, spendUnknown, stop, lines };
}

/**
 * How often a `waitForConsequence` poll may re-read the spend ledger — T1
 * ruling 1471.
 *
 * `waitForConsequence` polls every `CONSEQUENCE_POLL_MS` (100 ms,
 * `beats-page-read.mjs`); an agent wait can legitimately run for tens of
 * minutes. Calling `spendSoFar` at 100 ms cadence would re-parse every
 * dispatch dir's full event log thousands of times over one wait AND poison
 * `classifyUnmeasuredDispatch`'s own trend detector, which compares two reads
 * to tell a live turn from a reaped one — 100 ms is far too short a window to
 * see an in-flight turn's log grow, so every healthy dispatch would read as
 * REAPED on nearly every tick. `makeWaitSpendGuard` re-reads at most this
 * often; between reads it answers from its own last verdict.
 */
export const WAIT_SPEND_POLL_MS = 5_000;

/**
 * Build the $ guard `waitForConsequence` consults on every poll of ONE agent
 * wait — T1 ruling 1471 (S10 run 26): "the run's own $ ceiling bounds the
 * whole wait", checked continuously rather than only at the beat boundary
 * either side of it, so a wait long enough to matter is never long enough to
 * outrun the ceiling unnoticed.
 *
 * REUSES `spendSoFar` RATHER THAN A SECOND SPEND VERDICT. That function
 * already carries every fail-closed rule this needs — a breach on a NUMBER, an
 * unenforceable ceiling when a turn ends unpriced, a halt when a ledger row
 * fails to write or its sidecar cannot be read (`ceilingHaltVerdict`) — and
 * reinventing a subset here would be the exact species this campaign keeps
 * meeting: two notions of "is this run over budget" that can disagree.
 *
 * ITS OWN `unmeasuredSnapshots` MAP, never the beat loop's. `spendSoFar`'s
 * unmeasured diagnostic compares this call's dispatch-dir reading against the
 * PREVIOUS one to tell a live turn from a reaped one; sharing the beat loop's
 * map would mix a wait's 100 ms-throttled cadence into the beat boundary's
 * much sparser one and corrupt both trends.
 *
 * `null` — no guard at all — for a run with no usable ceiling: a costless
 * story, or one whose `ceilingUsd` did not resolve to a finite number
 * (`effectiveCeiling`'s own "NO USABLE CEILING" case). An unbounded run is
 * already that function's own finding; this must not invent a second one.
 *
 * `pollMs` defaults to `WAIT_SPEND_POLL_MS` and exists so a test can shrink it
 * — a real run never overrides it, exactly as `quiesce.mjs`'s `pollMs` seam is
 * only ever exercised by its own doors.
 *
 * @returns {null | (() => Readonly<{breached: boolean, reason: string|null}>)}
 */
export function makeWaitSpendGuard({ root, startedMs, realSpawn, ceilingUsd, pollMs = WAIT_SPEND_POLL_MS, clock = { now: () => Date.now() } }) {
  if (typeof ceilingUsd !== 'number' || !Number.isFinite(ceilingUsd)) return null;
  const snapshots = new Map();
  let checkedAt = -Infinity;
  let cached = Object.freeze({ breached: false, reason: null });
  return () => {
    const now = clock.now();
    if (now - checkedAt < pollMs) return cached;
    checkedAt = now;
    const { stop } = spendSoFar({
      root, startedMs, realSpawn, ceilingUsd, label: 'during an agent wait', unmeasuredSnapshots: snapshots,
    });
    cached = stop.halt
      ? Object.freeze({ breached: true, reason: `${stop.headline}: ${stop.reason}` })
      : Object.freeze({ breached: false, reason: null });
    return cached;
  };
}
