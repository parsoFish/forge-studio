/**
 * The `kb-cleanup` session kind — identity only (M4 ruling 87); see `design.md`.
 */
import type { ServerResponse } from 'node:http';

import { sendJson } from '@forge/kernel';
import { approveKbCleanup } from '@forge/knowledge/bridge-studio-kbs.ts';
import { guardedWriteSessionStatus } from '../interactive-session.ts';
import type { AffordanceRouteContext } from '../bridge-studio-sessions-affordance-shell.ts';

// ---------------------------------------------------------------------------
// verdict — kb-cleanup. W7-C2 (sessions-kinds-23) SUPERSEDED W6-B6's
// approve-only ruling: the `awaiting-approval` row now declares
// `verdicts: [approve, revise, reject]`, and the function below handles
// `reject` (terminal `rejected`, no spawn, nothing drained) alongside
// approve; `revise` never reaches here at all — it is the ONE generic
// `handleGenericRevise` arm. This route carries
// no URL-supplied kb id at all (there is no `:id` segment in
// `/api/studio/sessions/:kind/:sessionId/:affordance`), so `status.kb_id` is
// the ONLY candidate value — the security invariant ("the drain's SOLE
// source of truth is status.kb_id, never a URL segment") is satisfied by
// construction here, never an extra check. W6-B9 (reviewer finding on
// W6-B8): this WAS one of two callers of `approveKbCleanup` — the bespoke
// `POST /api/studio/kbs/:id/cleanup/apply` route (which DID carry a URL
// `:id`, cross-checked against `status.kb_id`) is now DELETED, so this is
// the ONLY caller left.
// ---------------------------------------------------------------------------

export async function handleKbCleanupVerdict(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  status: Record<string, unknown>,
  sessionId: string,
  project: string,
  verdict: 'approve' | 'reject',
): Promise<void> {
  // W7-C2 (sessions-kinds-23) — reject: a plain, SYNC-INVARIANT write (no
  // await before it) straight to the terminal `rejected` row the yaml now
  // declares, mirroring handleDemoVerdict's own reject arm. No spawn — a
  // discarded plan runs nothing. The drafted plan file stays on disk (the
  // session dir is the audit trail), it just never drains.
  if (verdict === 'reject') {
    if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'rejected' }) === null) {
      sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
      return;
    }
    sendJson(res, 200, { ok: true, phase: 'rejected' }, origin);
    return;
  }

  // W6-B6 post-merge review: the unsupported-verdict 422 lives in the main
  // handler above, reading the SAME `affordance.meta.verdicts`
  // `studio/session-kinds.yaml`'s `awaiting-approval` row declares.
  //
  // Delegates WHOLESALE to `approveKbCleanup` (cli/bridge-studio-kbs.ts) —
  // the phase re-check (belt-and-suspenders on top of the caller's own
  // affordance-membership check AND the generic verdicts gate above), the
  // kb_id presence check, the ATOMIC phase:'applying' claim, the drain, and
  // the phase:'applied' write all live in exactly one place now (W6-B4
  // adversarial-review fix — this used to be duplicated, non-atomic
  // choreography here; W6-B9 deleted the last other caller, the bespoke
  // `/cleanup/apply` route).
  const outcome = await approveKbCleanup(ctx.forgeRoot, projectsRoot, dirSegs, { runFixTurn: ctx.runFixTurn });
  if (!outcome.ok) {
    sendJson(res, outcome.status, { error: outcome.error, sessionId, project }, origin);
    return;
  }
  sendJson(res, 200, { ok: true, runId: outcome.runId }, origin);
}
