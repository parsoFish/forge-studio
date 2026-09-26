/**
 * forge-8vfn.8.1.14 — the architect's per-STAGE start event: split out of
 * `architect-steps.ts` (file-size budget, 1.0.md §0), same as
 * `architect-brain-read.ts`/`architect-critic.ts`'s own one-concern slices.
 *
 * One physical turn can run explore -> draft -> critic -> draft(revise) ->
 * critic inside itself; the coarser per-TURN start `kind-turn.ts` emits only
 * names the phase the session was IN when the turn began, so it cannot mark
 * any inner stage — exactly how a session read `drafting` through a critic
 * pass and a silent ~2.3-minute revision turn (m7-d-proof-S1 evidence).
 *
 * MUST be called BEFORE the stage's own structured turn, by the caller,
 * immediately before the `await` — a progress-aware client keys "still
 * working" on this event's PRESENCE, never the stage's first output. Call
 * sites: `architect-steps.ts`'s `runExploreThenDraft`/`runDraftRounds`, and
 * `architect.ts`'s `runFinalizeStep`. The completeness critic already had its
 * own equivalent (`architect.completeness-critic.start`, `architect-critic.
 * ts`) — same event family, same `logger.emit`, no new mechanism.
 */
import type { EventLogger } from '@forge/kernel';

export function emitArchitectStageStart(args: {
  logger: EventLogger;
  initiativeId: string;
  sessionId: string;
  stage: 'explore' | 'draft' | 'revise' | 'finalize';
  round: number;
}): void {
  const { logger, initiativeId, sessionId, stage, round } = args;
  logger.emit({
    initiative_id: initiativeId,
    phase: 'architect',
    skill: 'architect-runner',
    event_type: 'start',
    input_refs: [],
    output_refs: [],
    message: `architect.${stage}.start`,
    metadata: { session_id: sessionId, round },
  });
}
