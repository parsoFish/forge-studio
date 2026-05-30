'use client';

import { StageHex, hasRecentActivity } from './StageHex';
import { STATUS_COLOR } from '@/lib/status-colors';
import type { EventLogEntry } from '@/lib/bridge-client';

/**
 * The focused reflect hex for the standalone reflection screen — the third
 * human moment moved in-UI (consistent with the architect + review screens).
 * Amber "your input" while awaiting the operator's feedback; green once
 * reflected.
 */
export function ReflectStageHex({
  answered,
  events,
  nowMs,
}: {
  answered: boolean;
  events: EventLogEntry[];
  nowMs: number;
}): JSX.Element {
  const recentActive = hasRecentActivity(events, nowMs);
  return (
    <StageHex
      title="reflect"
      component="reflect-hex"
      extraData={{ 'data-reflect-answered': answered ? 'true' : 'false' }}
      statusLabel={answered ? 'reflected' : 'your input'}
      glow={answered ? STATUS_COLOR.complete : STATUS_COLOR.attention}
      frac={answered ? 1 : 0.6}
      active={!answered || recentActive}
      events={events}
      nowMs={nowMs}
    />
  );
}
