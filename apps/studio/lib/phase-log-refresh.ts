/**
 * Forge Studio — Phase Log Refresh Signal (R6-01 WI-1 F1)
 *
 * `PhaseDrawer.tsx`'s log-refresh effect used to key off `run.phaseMeta[nodeId]
 * .lastProgressAt`, which only advances on `PROGRESS_EVENT_TYPES`
 * (tool_use/file_change/test_run/iteration) — 7 of 11 real EventType members
 * (including `log` and `error`) never move it, so a node narrating purely via
 * `log` lines left the drawer's log pane stale even though the server already
 * had the new lines.
 *
 * The fix is server-side: `RunPhaseMeta.lastEventAt` (orchestrator/
 * run-model.ts, derived in orchestrator/run-model-derive.ts's
 * computeLastEventAt) is computed over EVERY event the authoritative
 * `eventToNodeId` resolver attributes to a node — the SAME resolver
 * `GET /api/runs/<id>/phases/<node>/log` filters with. This module's only job
 * is to turn that already-server-attributed field into a stable refresh
 * signal for a single (run, nodeId) pair — no client-side event scanning, no
 * re-derivation of attribution.
 */

import type { Run } from './studio-client';

/**
 * A stable string that changes exactly when `run.phaseMeta[nodeId].lastEventAt`
 * changes, and only for that node — never on a different node's activity, and
 * never on render/object identity alone. Never throws, even for a nodeId with
 * no `phaseMeta` entry or a `RunPhaseMeta` with no `lastEventAt` yet.
 */
export function phaseLogRefreshSignal(run: Run, nodeId: string): string {
  return run.phaseMeta[nodeId]?.lastEventAt ?? '';
}
