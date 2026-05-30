/**
 * The forge phase order + the rule that turns an event stream into a
 * "what phase is the cycle currently in?" answer. Mirrors the canonical
 * order in `orchestrator/logging.ts`.
 */

import type { EventLogEntry } from './bridge-client';

export const PHASE_ORDER = [
  'architect',
  'project-manager',
  'developer-loop',
  'review-loop',
  'reflection',
] as const;

export type Phase = (typeof PHASE_ORDER)[number];

/**
 * Map a raw event phase to the spine phase it renders under. Operator
 * 2026-05-30: review + closure are one moment now — the operator engages the
 * review page and approving merges — so `closure` events fold into the single
 * `review-loop` hex (labeled "review"). Keeps the backend's separate
 * review-loop/closure events while presenting one phase.
 */
export function canonicalPhase(raw: string): string {
  return raw === 'closure' ? 'review-loop' : raw;
}

/**
 * Operator 2026-05-30: amber ('retrying') is a WORKING tone (equivalent to
 * blue, flagging "not the first attempt") that only shows while a phase is
 * still running. The ONLY terminal states are green ('complete') and red
 * ('failed'). A phase whose terminal end signals failure — it errored in
 * flight, OR its end metadata reports failures (e.g. the dev-loop ending
 * `complete:0 / failed:N`) — is red; it is NOT gated on a separate cycle-level
 * verdict (that older gating left a wholly-failed dev-loop showing green).
 */
export type PhaseStatus = 'pending' | 'active' | 'complete' | 'retrying' | 'failed';

export type PhaseState = { phase: Phase; status: PhaseStatus; lastEventAt?: string };

type PhaseAccum = { firstAt: string; lastAt: string; ended: boolean; errored: boolean; endFailed: boolean };

/** The cycle has terminally failed when the orchestrator emits its own `error`
 *  (e.g. "developer-loop: 0/3 … total failure", "project-manager phase failed")
 *  or an `end` with status 'failed'. This is what lets a phase that died WITHOUT
 *  a clean end (PM throws → error, no phase end) show red rather than stuck amber. */
function cycleTerminallyFailed(events: readonly EventLogEntry[]): boolean {
  for (const e of events) {
    if (e.phase !== 'orchestrator') continue;
    if (e.event_type === 'error') return true;
    if (e.event_type === 'end' && e.metadata?.status === 'failed') return true;
  }
  return false;
}

/** A phase-level `end`'s metadata signals failure when it reports a failed
 *  status, any failed units, or fewer completed units than it took on. */
function endMetaIndicatesFailure(meta: EventLogEntry['metadata']): boolean {
  if (!meta) return false;
  if (meta.status === 'failed') return true;
  if (typeof meta.failed === 'number' && meta.failed > 0) return true;
  if (
    typeof meta.work_item_count === 'number' && meta.work_item_count > 0 &&
    typeof meta.complete === 'number' && meta.complete < meta.work_item_count
  ) return true;
  return false;
}

export function derivePhaseStates(events: readonly EventLogEntry[]): PhaseState[] {
  const cycleFailed = cycleTerminallyFailed(events);
  const seen = new Map<Phase, PhaseAccum>();
  for (const e of events) {
    const phase = canonicalPhase(e.phase);
    if (!isPhase(phase)) continue;
    const entry = seen.get(phase) ?? { firstAt: e.started_at, lastAt: e.started_at, ended: false, errored: false, endFailed: false };
    entry.lastAt = e.started_at;
    // A per-work-item `end` (carries work_item_id) completes that WI but does
    // NOT end the dev-loop PHASE — the phase stays active through the
    // remaining WIs and the unifier, ending only on the phase-level end
    // (ralph.end, no work_item_id). Operator 2026-05-30.
    const isPerWiEnd = e.event_type === 'end' && typeof e.metadata?.work_item_id === 'string';
    if (e.event_type === 'end' && !isPerWiEnd) {
      entry.ended = true;
      if (endMetaIndicatesFailure(e.metadata)) entry.endFailed = true;
    }
    // Expected failures (iter-0 sharp-gate must-fail) emit as 'log' per
    // Bug 3 fix, but be defensive: also ignore any 'error' tagged with
    // metadata.expected_fail so they never tint the phase.
    if (e.event_type === 'error' && e.metadata?.expected_fail !== true) entry.errored = true;
    seen.set(phase as Phase, entry);
  }
  // Active = the latest phase that has events but hasn't ended yet.
  let activeIdx = -1;
  for (let i = PHASE_ORDER.length - 1; i >= 0; i -= 1) {
    const p = PHASE_ORDER[i];
    const s = seen.get(p);
    if (s && !s.ended) { activeIdx = i; break; }
  }
  return PHASE_ORDER.map((phase): PhaseState => {
    const s = seen.get(phase);
    if (!s) return { phase, status: 'pending' };
    // Terminal first: green or red only. Red when the phase errored in flight
    // OR its end metadata reports failure (a wholly-failed dev-loop, etc.).
    if (s.ended) {
      // Terminal: red only if the end itself reports failure. An in-flight
      // error the phase RECOVERED from (then ended clean) is green.
      if (s.endFailed) return { phase, status: 'failed', lastEventAt: s.lastAt };
      return { phase, status: 'complete', lastEventAt: s.lastAt };
    }
    // No clean end. If it errored: red when the cycle has terminally failed
    // (this phase died — e.g. PM threw), else amber (live, working on recovery
    // — "not the first attempt"). No error yet → plain blue (active).
    if (s.errored) return { phase, status: cycleFailed ? 'failed' : 'retrying', lastEventAt: s.lastAt };
    return { phase, status: 'active', lastEventAt: s.lastAt };
  });
}

function isPhase(s: string): s is Phase {
  return (PHASE_ORDER as readonly string[]).includes(s);
}
