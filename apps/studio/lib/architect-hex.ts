import { STATUS_COLOR } from './status-colors';
import type { ArchitectPhase } from './bridge-client';
import type { SessionLifecycleState } from './session-lifecycle-client';

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
  exploring: { glow: STATUS_COLOR.active, frac: 0.45, label: 'exploring edge cases' },
  drafting: { glow: STATUS_COLOR.active, frac: 0.55, label: 'drafting the plan' },
  'awaiting-verdict': { glow: STATUS_COLOR.attention, frac: 0.8, label: 'plan ready — your call' },
  finalizing: { glow: STATUS_COLOR.active, frac: 0.92, label: 'finalizing manifests' },
  committed: { glow: STATUS_COLOR.complete, frac: 1, label: 'queued' },
  rejected: { glow: STATUS_COLOR.failed, frac: 1, label: 'rejected' },
};

/** Phases where the architect runner is actively working (hex reads "active"). */
export const ARCHITECT_WORKING_PHASES = new Set<ArchitectPhase>([
  'exploring',
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
 *  'briefing' phase has no agent activity, so it reads idle.
 *
 *  W8-A2 (ON-7 defect 3) — an UNKNOWN phase's fallback tone was `idle`,
 *  which reads as "calm, nothing to worry about". That is not an honest
 *  default: a phase this map does not recognise (a future phase this file
 *  has not been taught yet, a corrupted status.json) is an ANOMALY, not
 *  calm — an unknown-but-actually-failed session reading `idle` is the
 *  exact same defect this fix's `architectHexMetaForLifecycle` closes for
 *  the KNOWN-phase case, one level up. `attention` ("take a look") is the
 *  honest default for "this doesn't match anything I know how to render" —
 *  never a claim that nothing is happening. `frac`/`label` are unchanged
 *  (0 / the raw phase string) — this is a tone fix only. */
export function architectHexMeta(phase: HexPhase): HexMeta {
  return ARCHITECT_HEX_META[phase as ArchitectPhase] ?? { glow: STATUS_COLOR.attention, frac: 0, label: phase };
}

/**
 * W8-A2 (ON-7 defect 3) — derives the architect hex's presentation from
 * BOTH the stored `phase` AND the DERIVED session lifecycle, so a CRASHED
 * runner renders the failed tone and a truthful label whatever its frozen
 * `phase` says. A crashed runner dies mid-work — it never gets to write a
 * "the phase is now retired" fact to status.json — so `phase` stays stuck
 * at whatever it was doing (`drafting` reads "drafting the plan…" forever).
 *
 * Deliberately NOT a new `ArchitectPhase` member. `phase` is a STORED
 * status.json field; a runner that just crashed is, by construction, past
 * the point where it could ever write one more field to that file. A
 * `failed` phase some writer must remember to set is this campaign's
 * dominant defect class (declared-data-fails-open, 25+ recurrences in wave
 * 7) — including inside the very lifecycle primitive built to fix it. This
 * function has NO settable "failed" field anywhere: `lifecycleState` is
 * re-derived fresh on every read (`deriveSessionLifecycleFor`,
 * cli/bridge-studio-lifecycle.ts) by the CALLER and passed in here as a
 * plain argument — nothing is stored by this module or by this function.
 * Pure: same phase + lifecycle in, same {@link HexMeta} out, always.
 *
 * `lifecycleState` is `undefined` for any caller that has not yet threaded
 * the wire's `lifecycle` field through (declared-data-fails-open guard,
 * additive-optional) — that reads as the ordinary phase-only tone, never a
 * fabricated crash.
 */
export function architectHexMetaForLifecycle(phase: HexPhase, lifecycleState: SessionLifecycleState | undefined): HexMeta {
  const base = architectHexMeta(phase);
  if (lifecycleState !== 'crashed') return base;
  return { glow: STATUS_COLOR.failed, frac: base.frac, label: `${base.label} — crashed` };
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
