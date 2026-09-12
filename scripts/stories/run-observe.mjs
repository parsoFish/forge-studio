/**
 * Per-beat observation helpers for the story runner — split out of `run.mjs`
 * when it crossed the 800-line cap (§0). SPLIT, NEVER BASELINE (492).
 *
 * These three are what a beat boundary needs and the run loop does not: the
 * event rows a dispatched run has written so far, and the host state beside
 * them. They travel together because they answer one question — what was true
 * on this box at this beat — and `run.mjs` only orchestrates.
 */
import { readFileSync } from 'node:fs';
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

