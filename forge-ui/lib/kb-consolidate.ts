/**
 * W6-B14: this module used to own `runConsolidateToTerminal` — a bounded
 * 40×250ms poll loop `KbMaintenance` (app/knowledge/page.tsx) `await`ed
 * DIRECTLY inside its dispatch click handler. That meant the run's result
 * was simply discarded on nav-away (React state updates on an unmounted
 * component), AND exhausting the budget silently returned `state:'running'`
 * forever — no distinct "the browser stopped watching, the run may still be
 * going" signal, no way to re-check, no way to reattach after a reload.
 *
 * The poll itself is now the SAME shared `pollAgentFix` (`./agent-dispatch.ts`)
 * every other bounded agent-run poll in this app uses — a consolidate runId
 * (`${kbId}-consolidate-<stamp>`) is pollable through the byte-identical
 * `GET /api/studio/kbs/:id/fix-agent/:runId` route a per-finding fix-agent
 * runId already uses (`readBrainFixState`, cli/bridge-studio-kbs.ts, doesn't
 * distinguish by op). Reattach-on-mount goes through
 * `fetchActiveOrLatestConsolidate` (./studio-client.ts), which hits the new
 * `GET /api/studio/kbs/:id/consolidate/active` discovery route. Both live in
 * `KbMaintenance` itself now (mirrors how `KbDrainPanel.tsx` owns its own
 * dispatch+poll+reattach wiring) — this module keeps only the PURE, DOM-free
 * label logic that's cheaply unit-tested without a component harness.
 */

import type { PolledAgentFixStatus } from './agent-dispatch';

/** Short, honest label for the current consolidate poll status (the KB
 *  maintenance result pill). Pure — no DOM — matches the poll's OWN state
 *  vocabulary (`running` | `cleared` | `not-cleared` | `failed` | `unknown` |
 *  `timed-out`), never re-deriving or guessing a different one. `null` (no
 *  run dispatched/attached yet) renders no label at all — the caller omits
 *  the pill rather than show a stale default. */
export function consolidateResultLabel(status: PolledAgentFixStatus | null): string | null {
  if (!status) return null;
  switch (status.state) {
    case 'cleared':
      return 'consolidate: cleared ✓';
    case 'not-cleared':
      return 'consolidate: some findings remain';
    case 'failed':
      return 'consolidate: failed';
    case 'timed-out':
      return 'consolidate: still running — re-check in a moment';
    case 'unknown':
      // W7-FIX-A1 A1-10: a FAILED read names the failure (the bridge's own
      // text); a bridge-answered "no state recorded" is an honest unknown.
      return status.ok === false
        ? `consolidate: status could not be read — ${status.error ?? 'read failed'}`
        : 'consolidate: status unknown';
    default:
      return 'consolidate: running…';
  }
}
