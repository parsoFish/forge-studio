'use client';

import { StageHex, hasRecentActivity } from './StageHex';
import { STATUS_COLOR } from '@/lib/status-colors';
import type { ArchitectPhase, EventLogEntry } from '@/lib/bridge-client';

/**
 * ADR 020 — the focused architect hex for the dedicated plan screen. Maps the
 * architect phase to the shared {@link StageHex} (glow + arc + label): amber =
 * "needs you" (awaiting answers/verdict), blue = working; pulses with recent
 * tool activity from the session's event stream.
 */

const PHASE_GLOW: Record<ArchitectPhase, string> = {
  interviewing: STATUS_COLOR.active,
  drafting: STATUS_COLOR.active,
  finalizing: STATUS_COLOR.active,
  'awaiting-answers': STATUS_COLOR.attention,
  'awaiting-verdict': STATUS_COLOR.attention,
  committed: STATUS_COLOR.complete,
  rejected: STATUS_COLOR.failed,
};

const PHASE_FRAC: Record<ArchitectPhase, number> = {
  interviewing: 0.15,
  'awaiting-answers': 0.3,
  drafting: 0.55,
  'awaiting-verdict': 0.8,
  finalizing: 0.92,
  committed: 1,
  rejected: 1,
};

const PHASE_LABEL: Record<ArchitectPhase, string> = {
  interviewing: 'thinking',
  'awaiting-answers': 'needs your answers',
  drafting: 'drafting the plan',
  'awaiting-verdict': 'plan ready — your call',
  finalizing: 'finalizing manifests',
  committed: 'queued',
  rejected: 'rejected',
};

export function ArchitectStageHex({
  phase,
  events,
  nowMs,
}: {
  phase: ArchitectPhase;
  events: EventLogEntry[];
  nowMs: number;
}): JSX.Element {
  const working = phase === 'interviewing' || phase === 'drafting' || phase === 'finalizing';
  const recentActive = hasRecentActivity(events, nowMs);
  return (
    <StageHex
      title="architect"
      component="architect-hex"
      extraData={{ 'data-architect-phase': phase, 'data-architect-active': working || recentActive ? 'true' : 'false' }}
      statusLabel={PHASE_LABEL[phase] ?? phase}
      glow={PHASE_GLOW[phase] ?? STATUS_COLOR.idle}
      frac={PHASE_FRAC[phase] ?? 0}
      active={working || recentActive}
      events={events}
      nowMs={nowMs}
    />
  );
}
