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
import { summariseRunSpend, spendCeilingVerdict, endedUnpricedTurns, ceilingHaltVerdict } from './spend.mjs';
import { join } from 'node:path';

/** One dispatched run's event rows, or [] — an unreadable log is UNMEASURED,
 *  never a silent zero (bead `forge-8vfn.6.11.8`). */
export function readRunEvents(dir) {
  try {
    return readFileSync(join(dir, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  } catch {
    return [];
  }
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
 * @param {string} root the worktree
 * @param {number} sinceMs this run's start; older dispatches are not its spend
 * @returns {string[]} absolute directory paths
 */
export function collectSpendDirs(root, sinceMs) {
  const logsDir = join(root, '_logs');
  let entries;
  try {
    entries = readdirSync(logsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    // An absent `_logs` is a run that dispatched nothing. UNMEASURED is decided
    // upstream, by `summariseRunSpend`, which knows whether a spawn was real.
    return [];
  }
  const dirs = [];
  for (const e of entries) {
    const dir = join(logsDir, e.name);
    let mtimeMs;
    try {
      mtimeMs = statSync(dir).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < sinceMs) continue;
    if (!existsSync(join(dir, 'events.jsonl'))) continue;
    dirs.push(dir);
  }
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
export function finalSpendHalt({ root, startedMs, realSpawn, ceilingUsd, alreadyHalted }) {
  if (alreadyHalted) return { stop: null, lines: [] };
  const { stop, lines } = spendSoFar({ root, startedMs, realSpawn, ceilingUsd, label: 'at the final spend read' });
  return { stop: stop.halt ? stop : null, lines };
}

export function spendSoFar({ root, startedMs, realSpawn, ceilingUsd, label }) {
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
  const stop = ceilingHaltVerdict({ spend, ceilingUsd, unpriced, emitFailures });
  const lines = [`[stories] spend ${label}: ${v.reason}`];
  for (const n of spend.notes ?? []) lines.push(`[stories] spend: ${n}`);
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
  return { spend, verdict: v, unpriced, emitFailures, stop, lines };
}
