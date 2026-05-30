/**
 * Derive per-work-item status from the event log.
 *
 * The orchestrator emits events scoped to a work-item via
 * `metadata.work_item_id`. Status is a function of the most-recent
 * lifecycle-relevant event for that WI:
 *
 *   - no events                                    → 'pending'
 *   - any 'start' / 'iteration' / 'tool_use' but
 *     no terminal 'end' yet                        → 'active'
 *   - terminal 'end' with metadata.status==='failed'
 *     OR an 'error' event after the most recent
 *     'start'                                      → 'failed'
 *   - terminal 'end' otherwise                     → 'complete'
 *
 * The function is pure and synchronous so it can be unit-tested without
 * the React tree.
 */

import type { EventLogEntry } from './bridge-client';

/**
 * Status state per work item, also reused for features (rolled-up from
 * their WIs) and the dev-loop phase. Distinct from `PhaseStatus` so the
 * 'retrying' state can travel separately from the orchestrator's
 * top-level phase state.
 *
 * Operator note 2026-05-30: amber ('retrying') is a WORKING state — the
 * equivalent of blue, only flagging "this isn't the first attempt". The ONLY
 * terminal states are green ('complete') and red ('failed'); amber never
 * persists past an `end`. A unit that has terminally failed (its own `end`
 * says so) is red immediately — it is NOT held amber waiting on a cycle-level
 * verdict (that older gating left dead units stuck orange).
 *
 *   - 'pending'  → no lifecycle events recorded for this unit yet
 *   - 'active'   → started, working, first attempt (no terminal end, no error)
 *   - 'retrying' → still running, but already had a failed attempt this run
 *     (an error since the last start, or a prior end it is re-attempting).
 *     A live/working tone — green/red still decide the terminal state.
 *   - 'complete' → terminal end, succeeded (green)
 *   - 'failed'   → terminal end, failed — metadata.status === 'failed' or an
 *     error between the last start and that end (red)
 */
export type WiStatus = 'pending' | 'active' | 'complete' | 'retrying' | 'failed';

const LIFECYCLE_TYPES = new Set(['start', 'iteration', 'tool_use', 'end', 'error']);

export function derivePerWiStatus(
  events: readonly EventLogEntry[],
  wiIds: readonly string[],
): Record<string, WiStatus> {
  // Bucket lifecycle events by WI id once. We preserve insertion order from
  // the source array — callers should pass events in chronological order
  // (the bridge guarantees this since the JSONL log is append-only).
  const buckets = new Map<string, EventLogEntry[]>();
  for (const id of wiIds) buckets.set(id, []);
  for (const ev of events) {
    const wiId = ev.metadata?.work_item_id;
    if (typeof wiId !== 'string') continue;
    if (!LIFECYCLE_TYPES.has(ev.event_type)) continue;
    const bucket = buckets.get(wiId);
    if (bucket) bucket.push(ev);
  }

  const out: Record<string, WiStatus> = {};
  for (const id of wiIds) {
    out[id] = statusFor(buckets.get(id) ?? []);
  }
  return out;
}

function statusFor(events: readonly EventLogEntry[]): WiStatus {
  if (events.length === 0) return 'pending';

  // The last 'end' that is the freshest lifecycle signal is TERMINAL — it
  // resolves to green or red, never amber (operator 2026-05-30). We treat the
  // unit as failed if that end says so, or if an error fired between the last
  // start and that end (error-then-end, or error with no clean end).
  const lastEndIdx = lastIndexOfType(events, 'end');
  const lastStartIdx = lastIndexOfType(events, 'start');

  if (lastEndIdx >= 0 && lastEndIdx > lastStartIdx) {
    // The end's own status is authoritative — a unit that recovered from a
    // mid-run error and still ended `complete` is green, not red.
    const status = events[lastEndIdx].metadata?.status;
    if (status === 'failed') return 'failed';
    if (status === 'complete') return 'complete';
    // Ambiguous end (no explicit pass/fail) → infer failure from an error
    // between the last start and that end.
    return hasErrorBetween(events, lastStartIdx, lastEndIdx) ? 'failed' : 'complete';
  }

  // Still running (no terminal end after the last start). Amber ('retrying')
  // is a live, WORKING tone that only flags "not the first attempt": the unit
  // is mid-flight but has already had a failed attempt this run — an error
  // since the last start, OR a prior end it is now re-attempting. Otherwise
  // it's a clean first attempt → blue ('active').
  if (lastStartIdx >= 0) {
    const erroredSinceStart = hasErrorBetween(events, lastStartIdx, events.length);
    const reattempt = lastEndIdx >= 0 && lastEndIdx < lastStartIdx;
    if (erroredSinceStart || reattempt) return 'retrying';
  }
  return 'active';
}

function lastIndexOfType(events: readonly EventLogEntry[], type: string): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event_type === type) return i;
  }
  return -1;
}

function hasErrorBetween(events: readonly EventLogEntry[], afterIdx: number, beforeIdx: number): boolean {
  for (let i = afterIdx + 1; i < beforeIdx; i++) {
    if (events[i].event_type !== 'error') continue;
    // Expected failures (e.g. iter-0 must-fail gate check) are emitted
    // as `log` events per developer-loop.ts emitGateEvent — but be
    // defensive: also treat any `error` event tagged
    // `metadata.expected_fail: true` as non-terminal so the phase
    // doesn't go red on what is a healthy code path.
    if (events[i].metadata?.expected_fail === true) continue;
    return true;
  }
  return false;
}

/**
 * Roll a set of per-WI statuses up to a per-feature status. Operator
 * note 2026-05-25: failures should not propagate across siblings —
 * features and the dev-loop phase reflect the worst-case state of
 * their own work items only.
 *
 *   - all WIs complete             → 'complete' (green)
 *   - any failed (terminal red)    → 'failed'   (red — cycle dead)
 *   - any retrying (yellow signal) → 'retrying' (yellow)
 *   - any active                   → 'active'   (blue)
 *   - no WIs / no events           → 'pending'  (gray)
 *
 * The "failed > retrying > active > complete > pending" precedence
 * keeps the worst-case state visible while letting healthy siblings
 * stay green next to a yellow sibling.
 */
export function rollupStatus(statuses: readonly WiStatus[]): WiStatus {
  if (statuses.length === 0) return 'pending';
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'retrying')) return 'retrying';
  if (statuses.some((s) => s === 'active')) return 'active';
  if (statuses.every((s) => s === 'complete')) return 'complete';
  return 'pending';
}
