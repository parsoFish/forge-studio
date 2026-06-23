/**
 * D — auto-rerun the reflector when operator feedback lands late.
 *
 * A cycle's reflector runs ONCE at close. If the operator submits reflection
 * feedback afterwards (the /reflect screen writes `_logs/<id>/user-feedback.md`),
 * the reflector must re-run to distil it into retro.md + brain themes. The bridge
 * POST `/api/reflect/<id>/answer` fires that rerun live; this module RECOVERS
 * feedback that landed while the bridge was down — or whose live rerun was lost to
 * a Studio restart (the gitpulse `--compare` note: feedback ~23h newer than the
 * reflector.end, no second reflector.start ever emitted). At bridge startup it
 * re-runs the reflector for any cycle whose user-feedback.md is newer than its
 * last reflector.end.
 *
 * Pure predicate + an injectable reconcile so both are unit-testable without
 * spawning a real reflector.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type RerunReflectorFn = (input: {
  cycleId: string;
  logsRoot: string;
  queueRoot: string;
}) => Promise<void>;

/**
 * True when feedback (mtime, ms) post-dates the last reflector.end — i.e. the
 * reflector has not yet ingested this feedback. No prior end ⇒ always rerun.
 * Strict `>` so a same-millisecond tie is NOT a rerun (mtime is a different clock
 * from the event timestamp; equal-or-older is treated as already-seen).
 */
export function needsReflectRerun(
  feedbackMtimeMs: number,
  lastReflectorEndMs: number | null,
): boolean {
  if (lastReflectorEndMs === null) return true;
  return feedbackMtimeMs > lastReflectorEndMs;
}

/**
 * Latest `reflector.end` timestamp (ms) in an events.jsonl, or null if none.
 * Best-effort: a missing file or malformed line is skipped, never throws.
 */
export function lastReflectorEndMs(eventsPath: string): number | null {
  if (!existsSync(eventsPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return null;
  }
  let latest: number | null = null;
  for (const line of raw.split('\n')) {
    if (!line.includes('reflector.end')) continue;
    let ev: { message?: string; started_at?: string };
    try {
      ev = JSON.parse(line) as { message?: string; started_at?: string };
    } catch {
      continue;
    }
    if (ev.message !== 'reflector.end' || !ev.started_at) continue;
    const ms = Date.parse(ev.started_at);
    if (!Number.isNaN(ms) && (latest === null || ms > latest)) latest = ms;
  }
  return latest;
}

export type ReconcileDeps = {
  logsRoot: string;
  queueRoot: string;
  rerunReflector: RerunReflectorFn;
  /** Test seam — defaults to the real cycle dirs under logsRoot (skips `_…`). */
  listCycleDirs?: () => string[];
  /** Optional sink for fired/skipped lines (defaults to silent). */
  log?: (msg: string) => void;
};

/**
 * Re-run the reflector for every cycle whose user-feedback.md out-dates its last
 * reflector.end. Log-and-continue per cycle — an orphaned manifest makes
 * rerunReflector throw, which skips that one cycle without aborting the pass.
 * Returns the cycleIds it re-ran (for telemetry/tests).
 */
export async function reconcileReflectFeedback(deps: ReconcileDeps): Promise<string[]> {
  const { logsRoot, queueRoot, rerunReflector } = deps;
  const log = deps.log ?? (() => {});
  const cycleDirs = deps.listCycleDirs
    ? deps.listCycleDirs()
    : existsSync(logsRoot)
      ? readdirSync(logsRoot, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
          .map((e) => e.name)
      : [];

  const reran: string[] = [];
  for (const cycleId of cycleDirs) {
    const feedbackPath = join(logsRoot, cycleId, 'user-feedback.md');
    if (!existsSync(feedbackPath)) continue;
    let feedbackMs: number;
    try {
      feedbackMs = statSync(feedbackPath).mtimeMs;
    } catch {
      continue;
    }
    const endMs = lastReflectorEndMs(join(logsRoot, cycleId, 'events.jsonl'));
    if (!needsReflectRerun(feedbackMs, endMs)) continue;
    try {
      await rerunReflector({ cycleId, logsRoot, queueRoot });
      reran.push(cycleId);
      log(`reflect-reconcile: re-ran reflector for ${cycleId} (feedback newer than last reflector.end)`);
    } catch (err) {
      log(`reflect-reconcile: skipped ${cycleId} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return reran;
}
