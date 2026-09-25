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

/**
 * 2.10 reflector pipeline honesty — true when the cycle's event log carries a
 * `cycle.reflection-lost` event (the runtime marker every reflection-abandoning
 * path emits). The reconcile uses it to NAME what it recovered: re-running a
 * reflector over late feedback is routine; re-running one whose reflection was
 * recorded LOST closes that loss's loop, and the boot log should say so.
 * Best-effort like `lastReflectorEndMs`: missing/malformed input never throws.
 */
export function hasReflectionLossEvent(eventsPath: string): boolean {
  if (!existsSync(eventsPath)) return false;
  let raw: string;
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return false;
  }
  for (const line of raw.split('\n')) {
    if (!line.includes('cycle.reflection-lost')) continue;
    try {
      const ev = JSON.parse(line) as { message?: string };
      if (ev.message === 'cycle.reflection-lost') return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** Default recovery window — only feedback this recent is reconciled at boot.
 *  The boot pass is a safety net for feedback that landed while the bridge was
 *  briefly DOWN, not a reason to re-run reflectors on months-old cycles (which
 *  would flood the brain + spend on a fresh machine). Older feedback is the
 *  operator's deliberate `forge reflect --rerun` call, not an automatic one. */
export const RECONCILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ReconcileDeps = {
  logsRoot: string;
  queueRoot: string;
  rerunReflector: RerunReflectorFn;
  /** Only reconcile feedback newer than this many ms (default 7 days). */
  maxAgeMs?: number;
  /** Wall-clock now, ms (test seam; defaults to Date.now()). */
  now?: number;
  /** Test seam — defaults to the real cycle dirs under logsRoot (skips `_…`). */
  listCycleDirs?: () => string[];
  /** Optional sink for fired/skipped lines (defaults to silent). */
  log?: (msg: string) => void;
};

/**
 * Re-run the reflector for every cycle whose user-feedback.md out-dates its last
 * reflector.end AND landed within the recovery window. Log-and-continue per cycle
 * — an orphaned manifest makes rerunReflector throw, which skips that one cycle
 * without aborting the pass. Returns the cycleIds it re-ran (for telemetry/tests).
 */
export async function reconcileReflectFeedback(deps: ReconcileDeps): Promise<string[]> {
  const { logsRoot, queueRoot, rerunReflector } = deps;
  const log = deps.log ?? (() => {});
  const maxAgeMs = deps.maxAgeMs ?? RECONCILE_MAX_AGE_MS;
  const now = deps.now ?? Date.now();
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
    // Only recent feedback — old feedback is recovered deliberately, not at boot.
    if (now - feedbackMs > maxAgeMs) continue;
    const eventsPath = join(logsRoot, cycleId, 'events.jsonl');
    const endMs = lastReflectorEndMs(eventsPath);
    if (!needsReflectRerun(feedbackMs, endMs)) continue;
    // 2.10: name what this pass is picking up — a recorded reflection LOSS
    // (cycle.reflection-lost in the event log) closes that loss's loop and
    // must say so; ordinary late feedback keeps the routine wording.
    const reason = hasReflectionLossEvent(eventsPath)
      ? 'recovering lost reflection — cycle.reflection-lost was recorded'
      : 'recent feedback newer than last reflector.end';
    try {
      await rerunReflector({ cycleId, logsRoot, queueRoot });
      reran.push(cycleId);
      log(`reflect-reconcile: re-ran reflector for ${cycleId} (${reason})`);
    } catch (err) {
      log(`reflect-reconcile: skipped ${cycleId} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return reran;
}
