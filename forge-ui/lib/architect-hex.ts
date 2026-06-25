import { STATUS_COLOR } from './status-colors';
import type { ArchitectPhase } from './bridge-client';

/**
 * Architect-phase presentation logic, extracted out of the old MomentHex
 * wrapper (retired in M7-4, ADR-031) so the native Studio interview surface can
 * drive the shared {@link StageHex} primitive directly without the
 * ScreenShell/MomentHex standalone tree. Pure + unit-tested: the phase→hex
 * mapping and the P1 stale-session predicate are the load-bearing pieces.
 */

export type HexMeta = { glow: string; frac: number; label: string };

/** Architect phase → hex visual meta (glow tone, progress fraction, label). */
export const ARCHITECT_HEX_META: Record<ArchitectPhase, HexMeta> = {
  interviewing: { glow: STATUS_COLOR.active, frac: 0.15, label: 'thinking' },
  'awaiting-answers': { glow: STATUS_COLOR.attention, frac: 0.3, label: 'needs your answers' },
  drafting: { glow: STATUS_COLOR.active, frac: 0.55, label: 'drafting the plan' },
  'awaiting-verdict': { glow: STATUS_COLOR.attention, frac: 0.8, label: 'plan ready — your call' },
  finalizing: { glow: STATUS_COLOR.active, frac: 0.92, label: 'finalizing manifests' },
  committed: { glow: STATUS_COLOR.complete, frac: 1, label: 'queued' },
  rejected: { glow: STATUS_COLOR.failed, frac: 1, label: 'rejected' },
};

/** Phases where the architect runner is actively working (hex reads "active"). */
export const ARCHITECT_WORKING_PHASES = new Set<ArchitectPhase>([
  'interviewing',
  'drafting',
  'finalizing',
]);

/** P1 stale threshold — the runner is presumed stalled after this much silence. */
export const STALE_THRESHOLD_MS = 120_000;

/**
 * The instructions-creator reuses these helpers but adds a pre-spawn 'briefing'
 * phase (no agent activity yet — the operator is reviewing). Widen the inputs to
 * the superset so the instructions page can pass its phase without a cast; the
 * architect's own `ArchitectPhase` callers remain valid (it's a subtype).
 */
type HexPhase = ArchitectPhase | 'briefing';

/** Resolve the hex meta for a phase, defaulting to the idle tone. The pre-spawn
 *  'briefing' phase has no agent activity, so it reads idle. */
export function architectHexMeta(phase: HexPhase): HexMeta {
  return ARCHITECT_HEX_META[phase as ArchitectPhase] ?? { glow: STATUS_COLOR.idle, frac: 0, label: phase };
}

/** Is the phase a working phase (architect runner busy)? 'briefing' is not. */
export function isArchitectWorking(phase: HexPhase): boolean {
  return ARCHITECT_WORKING_PHASES.has(phase as ArchitectPhase);
}

/**
 * P1 — is this session stale? True only when the runner is in a working phase
 * AND has been silent for longer than {@link STALE_THRESHOLD_MS}. A fresh
 * `staleMs` (session refresh) clears it; a non-working phase never reads stale.
 */
export function isSessionStale(session: { phase: HexPhase; staleMs?: number }): boolean {
  if (!isArchitectWorking(session.phase)) return false;
  return (session.staleMs ?? 0) > STALE_THRESHOLD_MS;
}
