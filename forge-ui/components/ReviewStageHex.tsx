'use client';

import { StageHex, hasRecentActivity } from './StageHex';
import { STATUS_COLOR } from '@/lib/status-colors';
import type { Cycle, EventLogEntry } from '@/lib/bridge-client';

/**
 * ADR 021 — the focused review hex for the standalone review screen. Maps the
 * cycle status to the shared {@link StageHex} so the review screen aligns
 * visually with the architect plan screen: amber "your call" at
 * ready-for-review, green when merged, red on failure.
 */
const STATUS: Record<Cycle['status'], { glow: string; frac: number; label: string }> = {
  pending: { glow: STATUS_COLOR.idle, frac: 0.1, label: 'queued' },
  'in-flight': { glow: STATUS_COLOR.active, frac: 0.5, label: 'building' },
  'ready-for-review': { glow: STATUS_COLOR.attention, frac: 0.85, label: 'your call' },
  done: { glow: STATUS_COLOR.complete, frac: 1, label: 'merged' },
  failed: { glow: STATUS_COLOR.failed, frac: 1, label: 'failed' },
};

export function ReviewStageHex({
  status,
  events,
  nowMs,
}: {
  status: Cycle['status'];
  events: EventLogEntry[];
  nowMs: number;
}): JSX.Element {
  const meta = STATUS[status] ?? { glow: STATUS_COLOR.idle, frac: 0, label: status };
  const recentActive = hasRecentActivity(events, nowMs);
  return (
    <StageHex
      title="review"
      component="review-hex"
      extraData={{ 'data-cycle-status': status }}
      statusLabel={meta.label}
      glow={meta.glow}
      frac={meta.frac}
      active={status === 'in-flight' || recentActive}
      events={events}
      nowMs={nowMs}
    />
  );
}
