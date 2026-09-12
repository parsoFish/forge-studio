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
import { summariseRunSpend, spendCeilingVerdict } from './spend.mjs';
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
 * @returns {{spend: ReturnType<typeof summariseRunSpend>, lines: string[]}}
 */
export function spendSoFar({ root, startedMs, realSpawn, ceilingUsd, label }) {
  const spend = summariseRunSpend({
    realSpawn,
    // COLLECTED BY `collectSpendDirs`, NOT BY THE REAPER'S COLLECTOR
    // (`forge-rzrs`): `collectAgentRuns` gates on `turn.pid`/markers — the
    // directories it could KILL — and a cycle's phase dir has neither, so S10
    // run 15 enforced a $35 ceiling against 76.4% of its own spend.
    events: collectSpendDirs(root, startedMs).map(readRunEvents),
  });
  const v = spendCeilingVerdict(spend, ceilingUsd);
  const lines = [`[stories] spend ${label}: ${v.reason}`];
  for (const n of spend.notes ?? []) lines.push(`[stories] spend: ${n}`);
  return { spend, lines };
}
