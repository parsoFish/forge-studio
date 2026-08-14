'use client';

import { useState } from 'react';

import { applyKbCleanup } from '@/lib/studio-client';
import { cleanupPlanView } from '@/lib/session-artifact-view';
import type { SessionArtifactPayload, CleanupPlanArtifact } from '@/lib/session-client';

// ---------------------------------------------------------------------------
// SessionCleanupPanel — the "kb-cleanup" kind's live interactive affordance
// (R4-19-F2 WI-4c). Closes the THIRD layer brain/cycles/themes/new-session-
// kind-needs-ui-wiring.md's checklist names: additive definitions (done,
// R4-19-F2 WI-1..3) + the artifact view/pane (WI-4a, SessionArtifactPane.tsx
// already renders the right-hand `cleanup-plan` body) leave the kind fully
// backend/view-complete yet still UNREACHABLE — there was no operator
// control anywhere that could ever call `applyKbCleanup`. This panel is that
// control, modelled on `SessionAuthoringPanel`'s shape (status block + one
// explicit finalize act), never the artifact-rendering pane's job.
//
// APPROVAL GATE: the apply route (`cli/ui-bridge.ts`'s
// `kbCleanupApplyMatch` handler) 409s unless the session's OWN recorded
// phase is EXACTLY 'awaiting-approval' — every other phase ('drafting' still
// mid-turn, or 'applied' already actioned) is refused server-side. Offering
// the approve control outside that window would be a button that always
// 409s, so `phase` (sourced from the generic session shell's own
// `viewState.phase` — the SAME field that already drives `data-session-
// phase` on the page shell) is the single source of truth this panel gates
// on, never a client-derived guess from the artifact's own `state`/`settled`
// (those describe the PLAN's content, not the SESSION's approval phase —
// conflating them would let a session mid-drafting show an approve button
// the instant its first action line parses).
// ---------------------------------------------------------------------------

/** The one phase value the apply route accepts — named so the gate reads as
 *  a comparison against a documented contract, not a bare string literal
 *  scattered through the render. Mirrors `cli/ui-bridge.ts`'s own
 *  `status.phase !== 'awaiting-approval'` check verbatim. */
const AWAITING_APPROVAL_PHASE = 'awaiting-approval';

/** The phase the apply route itself writes once it has drained the KB (`cli/
 *  ui-bridge.ts`'s `guardedWriteSessionStatus(..., {phase:'applied'})`) — a
 *  session already in this phase is refused a SECOND apply by the same 409
 *  gate `AWAITING_APPROVAL_PHASE` guards; named here purely for the
 *  already-applied copy below, never re-used as a gate condition of its own
 *  (the gate is "phase === awaiting-approval", not "phase !== applied"). */
const APPLIED_PHASE = 'applied';

/** Terminal apply states this panel can settle into — mirrors
 *  `KbMaintenance`'s own `data-consolidate-state` convention (page.tsx):
 *  a plain string state, set ONLY once the async act has genuinely finished,
 *  spread onto the DOM conditionally so a journey can poll for its presence
 *  rather than racing whatever the panel happens to be rendering mid-flight.
 *  Unlike consolidate, `applyKbCleanup` has no separate poll-to-terminal step
 *  — the apply ROUTE itself awaits the drain before responding 200 (`cli/
 *  ui-bridge.ts`'s `await enqueueConsolidate(...)`), so the fetch resolving
 *  IS the terminal event; no bounded poll loop is needed here. */
type CleanupApplyState = 'applied' | 'error';

export function SessionCleanupPanel({
  sessionId,
  project = null,
  phase,
  artifact,
  onApplied,
}: {
  sessionId: string;
  /** The session's own project — required by `applyKbCleanup`'s body
   *  contract; optional here (defaults to `null`) so an isolated render
   *  (this component's own DOM regression suite) can omit it. Approval
   *  stays disabled until a real project is known, mirroring
   *  `SessionAuthoringPanel`'s own `canSave` gate. */
  project?: string | null;
  /** The session's OWN phase (generic shell `viewState.phase`) — the sole
   *  approvability gate; see this file's header. */
  phase: string;
  artifact: SessionArtifactPayload | null;
  /** Called with the dispatched consolidate `runId` on a successful apply —
   *  the caller may use it to refresh KB health, mirroring
   *  `KbMaintenance`'s own `onMaintained` callback; optional. */
  onApplied?: (runId: string) => void;
}): JSX.Element {
  const cleanupArtifact = artifact && artifact.kind === 'cleanup-plan' ? (artifact as CleanupPlanArtifact) : null;
  const view = cleanupArtifact ? cleanupPlanView(cleanupArtifact) : null;

  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyState, setApplyState] = useState<CleanupApplyState | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const approvable = phase === AWAITING_APPROVAL_PHASE;
  const canApprove = approvable && Boolean(project) && !applying;

  async function onApprove(): Promise<void> {
    if (!canApprove || !project) return;
    setApplying(true);
    setError(null);
    const result = await applyKbCleanup(sessionId, { project, sessionId });
    setApplying(false);
    if (!result.ok) {
      // Never swallowed: the 409 approval-gate refusal (or any other server
      // error) reaches the operator verbatim, via `applyKbCleanup`'s own
      // pass-through contract.
      setError(result.error);
      setApplyState('error');
      return;
    }
    setRunId(result.runId);
    setApplyState('applied');
    onApplied?.(result.runId);
  }

  return (
    <div
      data-component="cleanup-panel"
      {...(applyState ? { 'data-cleanup-apply-state': applyState } : {})}
    >
      <div
        data-section="cleanup-status"
        data-cleanup-panel-phase={phase}
        style={{
          border: '1px solid var(--line)', borderRadius: 10, padding: '14px 18px',
          background: 'var(--panel)', fontSize: 13, color: 'var(--dim)', marginBottom: 14,
        }}
      >
        {!view
          ? 'The brain-maintenance agent has not drafted a cleanup plan yet.'
          : view.state === 'no-plan'
          ? 'The brain-maintenance agent has not drafted a cleanup plan yet.'
          : view.state === 'unparsed-plan'
          ? 'A plan was drafted but no actions parsed from it. Review the raw text in the pane on the right.'
          : `${view.openFindingCount} open finding(s) across ${view.actions.length} action(s). Review them in the pane on the right.`}
      </div>

      {applyState === 'applied' ? (
        // The settled terminal — rendered instead of the approve control
        // once an apply has genuinely completed, so re-clicking a stale
        // button can never double-apply an already-drained session.
        <div
          data-section="cleanup-applied"
          style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '14px 18px', background: 'var(--panel)', fontSize: 13, color: 'var(--c-kb)' }}
        >
          Cleanup applied ✓{runId ? ` — run ${runId}` : ''}
        </div>
      ) : approvable ? (
        <div data-section="cleanup-approve" style={{ display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--line)', borderRadius: 10, padding: '16px 18px', background: 'var(--panel)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Approve this plan
          </div>
          <p style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.5, margin: 0 }}>
            Applying runs the drain that repairs every open finding this plan lists. This cannot be undone.
          </p>
          {error && <div style={{ fontSize: 12.5, color: 'var(--red, #f87171)' }}>{error}</div>}
          <div>
            <button
              className="btn btn-primary"
              data-action="approve-cleanup-plan"
              onClick={() => void onApprove()}
              disabled={!canApprove}
              style={{ opacity: canApprove ? 1 : 0.5 }}
            >
              {applying ? 'Applying…' : 'Approve & apply →'}
            </button>
          </div>
        </div>
      ) : (
        // Not approvable: the phase gate this file's header documents.
        // Deliberately no button here at all (disabled-and-visible would
        // still invite a click that 409s) — just an honest reason why.
        <div data-section="cleanup-not-approvable" style={{ fontSize: 12.5, color: 'var(--faint)' }}>
          {error && <div style={{ fontSize: 12.5, color: 'var(--red, #f87171)', marginBottom: 8 }}>{error}</div>}
          {phase === APPLIED_PHASE
            ? 'This cleanup plan has already been applied.'
            : `Approval opens once the plan reaches "${AWAITING_APPROVAL_PHASE}" (current phase: "${phase}").`}
        </div>
      )}
    </div>
  );
}
