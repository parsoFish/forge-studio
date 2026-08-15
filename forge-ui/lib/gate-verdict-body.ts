/**
 * gate-verdict-body — pure body-builder for GateBar's postGate calls.
 *
 * W6-SW-3 reviewer HIGH finding: the bridge's gateId==='plan' route
 * (cli/bridge-studio-runs.ts's POST /api/runs/:id/gates/:gateId handler)
 * maps `kind` from `verdict` ONLY for verdict ∈ {'approve','revise','reject'}
 * — falling back to `body.kind` (default `''`) otherwise. GateBar's own
 * verdict vocabulary is 'approve' | 'send-back' (GateState), so a plan-gate
 * send-back that sends bare `{verdict:'send-back', ...}` never matches the
 * ternary and reaches applyPlanVerdict with `kind:''`, which 400s
 * "unknown kind: ''" — Approve worked, but Send-back was still a dead
 * control on every plan gate.
 *
 * The route also reads ONLY `rationale` for the plan-gate's feedback text
 * (never `notes` — see applyPlanVerdict's `kind==='revise'` branch, which
 * writes `(rationale ?? '').trim()` to feedback.md). GateBar's textarea
 * state is named `notes` client-side; for the plan-gate path it must be
 * re-keyed to `rationale` on the wire or the operator's typed feedback is
 * silently discarded even once the 400 is fixed. The demo/verdict-gate path
 * keeps sending `notes` — its own pre-existing contract (applyReviewVerdict
 * reads `rationale` too, but that mismatch predates this fix and is out of
 * scope here; GateBar's non-plan branch is left byte-identical).
 *
 * Extracted as a pure function (this repo has no jsdom component-render
 * harness for forge-ui — logic lives in lib/*.ts and is unit-tested
 * directly, per convention) so the exact wire shape for both verdicts is
 * asserted without needing to render GateBar itself.
 */

export type GateVerdictKind = 'approve' | 'send-back';

export type GateVerdictBody = {
  notes?: string;
  rationale?: string;
  project?: string;
  kind?: string;
};

export function buildGateVerdictBody(
  gateId: string,
  verdict: GateVerdictKind,
  args: { notes?: string; project?: string },
): GateVerdictBody {
  if (gateId !== 'plan') {
    // Demo/verdict-gate path — unchanged from before this fix.
    return verdict === 'approve' ? {} : { notes: args.notes };
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
