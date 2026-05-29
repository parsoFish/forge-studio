'use client';

import { StageHex } from './StageHex';
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
  const recentActive = events.some((e) => e.started_at && nowMs - new Date(e.started_at).getTime() < 3500);
  return (
    <StageHex
      title="reflect"
      component="reflect-hex"
      extraData={{ 'data-reflect-answered': answered ? 'true' : 'false' }}
      statusLabel={answered ? 'reflected' : 'your input'}
      glow={answered ? '#2ea043' : '#d29922'}
      frac={answered ? 1 : 0.6}
      active={!answered || recentActive}
      events={events}
      nowMs={nowMs}
    />
  );
}
