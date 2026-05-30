'use client';

import { StageHex, hasRecentActivity } from './StageHex';
import { STATUS_COLOR } from '@/lib/status-colors';
import type { ArchitectPhase, Cycle, EventLogEntry } from '@/lib/bridge-client';

/**
 * The three human-moment hexes (architect / review / reflect) — thin
 * domain→visual adapters over the shared {@link StageHex}. Consolidated into
 * one file (2026-05-30): each maps its own status domain to {glow, frac, label}
 * + a "base active" flag, then funnels through `MomentHex` so the StageHex call
 * + recent-activity pulse live in one place.
 *
 * (The deeper HumanMoment generalization was closed as superseded — the screens
 * already share ScreenShell + the screen hooks + the fetch envelope, and the
 * residual per-moment logic is intrinsically different. See ADR 023 §4.)
 */

type Meta = { glow: string; frac: number; label: string };

function MomentHex({
  title,
  component,
  meta,
  baseActive,
  extraData,
  activeAttr,
  events,
  nowMs,
}: {
  title: string;
  component: string;
  meta: Meta;
  /** Domain "active" condition; OR-ed with recent tool activity. */
  baseActive: boolean;
  extraData: Record<string, string>;
  /** Optional data-* attribute set to the resolved `active` boolean (architect). */
  activeAttr?: string;
  events: EventLogEntry[];
  nowMs: number;
}): JSX.Element {
  const active = baseActive || hasRecentActivity(events, nowMs);
  const fullExtra = activeAttr ? { ...extraData, [activeAttr]: active ? 'true' : 'false' } : extraData;
  return (
    <StageHex
      title={title}
      component={component}
      extraData={fullExtra}
      statusLabel={meta.label}
      glow={meta.glow}
      frac={meta.frac}
      active={active}
      events={events}
      nowMs={nowMs}
    />
  );
}

// ---- architect (ADR 020): ArchitectPhase → hex ---------------------------
// amber = "needs you" (awaiting answers/verdict), blue = working; pulses with
// recent tool activity from the session's event stream.

const ARCHITECT_META: Record<ArchitectPhase, Meta> = {
  interviewing: { glow: STATUS_COLOR.active, frac: 0.15, label: 'thinking' },
  'awaiting-answers': { glow: STATUS_COLOR.attention, frac: 0.3, label: 'needs your answers' },
  drafting: { glow: STATUS_COLOR.active, frac: 0.55, label: 'drafting the plan' },
  'awaiting-verdict': { glow: STATUS_COLOR.attention, frac: 0.8, label: 'plan ready — your call' },
  finalizing: { glow: STATUS_COLOR.active, frac: 0.92, label: 'finalizing manifests' },
  committed: { glow: STATUS_COLOR.complete, frac: 1, label: 'queued' },
  rejected: { glow: STATUS_COLOR.failed, frac: 1, label: 'rejected' },
};
const ARCHITECT_WORKING = new Set<ArchitectPhase>(['interviewing', 'drafting', 'finalizing']);

export function ArchitectStageHex({
  phase,
  events,
  nowMs,
}: {
  phase: ArchitectPhase;
  events: EventLogEntry[];
  nowMs: number;
}): JSX.Element {
  return (
    <MomentHex
      title="architect"
      component="architect-hex"
      meta={ARCHITECT_META[phase] ?? { glow: STATUS_COLOR.idle, frac: 0, label: phase }}
      baseActive={ARCHITECT_WORKING.has(phase)}
      extraData={{ 'data-architect-phase': phase }}
      activeAttr="data-architect-active"
      events={events}
      nowMs={nowMs}
    />
  );
}

// ---- review (ADR 021): Cycle status → hex --------------------------------
// amber "your call" at ready-for-review, green when merged, red on failure.

const REVIEW_META: Record<Cycle['status'], Meta> = {
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
  return (
    <MomentHex
      title="review"
      component="review-hex"
      meta={REVIEW_META[status] ?? { glow: STATUS_COLOR.idle, frac: 0, label: status }}
      baseActive={status === 'in-flight'}
      extraData={{ 'data-cycle-status': status }}
      events={events}
      nowMs={nowMs}
    />
  );
}

// ---- reflect: answered boolean → hex -------------------------------------
// amber "your input" while awaiting feedback; green once reflected.

export function ReflectStageHex({
  answered,
  events,
  nowMs,
}: {
  answered: boolean;
  events: EventLogEntry[];
  nowMs: number;
}): JSX.Element {
  return (
    <MomentHex
      title="reflect"
      component="reflect-hex"
      meta={answered
        ? { glow: STATUS_COLOR.complete, frac: 1, label: 'reflected' }
        : { glow: STATUS_COLOR.attention, frac: 0.6, label: 'your input' }}
      baseActive={!answered}
      extraData={{ 'data-reflect-answered': answered ? 'true' : 'false' }}
      events={events}
      nowMs={nowMs}
    />
  );
}
