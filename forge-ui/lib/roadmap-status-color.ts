/**
 * R4-13 — pure mapper from a roadmap initiative's queue status to a semantic
 * tone KEY of the SHARED 5-tone palette (`forge-ui/lib/status-colors.ts`
 * `STATUS_COLOR`: idle / active / attention / complete / failed).
 *
 * The retired serpentine timeline carried its own 6-key status-colour map
 * (status → CSS-var string) that handed `ready-for-review` a distinct amber
 * `var(--c-review, …)` tone. That map does NOT come forward. The DAG colours
 * nodes from the shared palette, so `ready-for-review` reuses the existing
 * `attention` tone and there is no 6th "review" tone. `merged` and `done` both
 * collapse onto `complete`.
 *
 * This returns a tone NAME (a key of `STATUS_COLOR`), never a hex / `var(--…)`
 * literal — the consumer resolves the key to a colour via `STATUS_COLOR[tone]`.
 */

import type { RoadmapInitiative } from '@/lib/bridge-client';
import { STATUS_COLOR } from '@/lib/status-colors';

/**
 * The queue-status vocabulary carried by `RoadmapInitiative.status`. Derived
 * from the bridge type so the two never drift.
 */
export type QueueState = RoadmapInitiative['status'];

/** A semantic tone name — a key of the shared 5-tone palette. */
export type StatusTone = keyof typeof STATUS_COLOR;

const QUEUE_STATE_TO_TONE: Record<QueueState, StatusTone> = {
  pending: 'idle',
  'in-flight': 'active',
  'ready-for-review': 'attention',
  merged: 'complete',
  done: 'complete',
  failed: 'failed',
};

/**
 * Map a roadmap initiative's queue status to its semantic tone key in the
 * shared `STATUS_COLOR` palette.
 */
export function queueStatusToColor(status: QueueState): StatusTone {
  return QUEUE_STATE_TO_TONE[status];
}
