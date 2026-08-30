/**
 * gate-verdict-body — pure body-builder for GateBar's postGate calls.
 *
 * W6-SW-3 reviewer HIGH finding (plan gates): the bridge's gateId==='plan'
 * route maps `kind` from `verdict` ONLY for verdict ∈ {'approve','revise',
 * 'reject'}, so a plan-gate send-back needs `kind:'revise'`, and the route
 * reads ONLY `rationale` for the feedback text — GateBar's `notes` is
 * re-keyed on the wire.
 *
 * W7-B7 (artifact-plan-V01) — the demo/verdict-gate branch: the old shape
 * (`{}` for approve, `{notes}` for send-back) never satisfied
 * `applyReviewVerdict`'s own required fields — `rationale` on BOTH verdicts
 * and ≥1 `acceptanceCriteria` on send-back — so the demo gate bar stayed a
 * dead control even once the initiative-id recovery (artifact-plan-18)
 * landed: approve 400'd "initiativeId, kind, rationale required" (invisibly,
 * pre-A3) and send-back 400'd "send-back requires at least one
 * acceptanceCriteria". Approve now carries the operator's notes as the
 * rationale (or an honest default naming the gate), and send-back carries
 * the notes as rationale plus ONE synthesized GIVEN/WHEN/THEN — GateBar has
 * no per-region comment UI to derive richer ACs from (that is
 * DemoReviewSurface's job); the synthesized AC mirrors
 * orchestrator/review-comments.ts `acForComment`'s derived-GWT shape.
 *
 * Extracted as a pure function (this repo has no jsdom component-render
 * harness for forge-ui — logic lives in lib/*.ts and is unit-tested
 * directly, per convention) so the exact wire shape for both verdicts is
 * asserted without needing to render GateBar itself.
 */

export type GateVerdictKind = 'approve' | 'send-back';

export type GateVerdictAc = { given: string; when: string; then: string };

export type GateVerdictBody = {
  notes?: string;
  rationale?: string;
  project?: string;
  kind?: string;
  acceptanceCriteria?: GateVerdictAc[];
};

/** The honest default rationale for a notes-less demo-gate approve. */
export const DEMO_GATE_APPROVE_RATIONALE = 'Approved at the demo gate.';

export function buildGateVerdictBody(
  gateId: string,
  verdict: GateVerdictKind,
  args: { notes?: string; project?: string },
): GateVerdictBody {
  const notes = args.notes?.trim() ?? '';
  if (gateId !== 'plan') {
    // Demo/verdict-gate path (W7-B7, artifact-plan-V01): send the fields
    // applyReviewVerdict actually requires.
    if (verdict === 'approve') {
      return { rationale: notes || DEMO_GATE_APPROVE_RATIONALE };
    }
    return {
      rationale: notes,
      acceptanceCriteria: [
        {
          given: 'the demo evidence for this initiative',
          when: 'the operator reviewed the demo gate',
          then: notes || 'the flagged concern must be addressed',
        },
      ],
    };
  }
  if (verdict === 'approve') {
    // verdict:'approve' already satisfies the route's kind ternary directly
    // — no explicit `kind` needed.
    return { project: args.project };
  }
  // send-back: verdict alone does NOT satisfy the route's kind ternary
  // ('approve'|'revise'|'reject') — kind:'revise' is required, and the
  // free-text note must travel as `rationale`, the field the route reads.
  return { project: args.project, kind: 'revise', rationale: args.notes };
}
