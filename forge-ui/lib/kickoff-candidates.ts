/**
 * kickoff-candidates — the pure derivation behind the generic Start-Run
 * initiative picker on the flow monitor (W7-FIX-A3, A3-01).
 *
 * The picker offers ONLY genuinely startable initiatives: runs still queued
 * (`planned`). Finished (`complete`), `failed`, `active` and `gated` runs are
 * never candidates — the generic kickoff used to list every complete/failed
 * initiative from every flow, and one click yanked a shipped manifest out of
 * `_queue/done` and re-ran it (the bridge now refuses that too, 409
 * `already-done`; this is the UI half of the same guard). Re-running a
 * failed run is the monitor's own Resume affordance, not the picker.
 */
import type { Flow, Run } from './studio-client';

/** An initiative the generic kickoff can enqueue onto a flow — derived from
 *  the runs list (one run per queued manifest), never invented. */
export type KickoffCandidate = { initiativeId: string; project: string | null };

export function deriveKickoffCandidates(runs: Run[]): KickoffCandidate[] {
  const seen = new Set<string>();
  const out: KickoffCandidate[] = [];
  for (const r of runs) {
    if (r.status !== 'planned') continue;
    if (!r.initiativeId || seen.has(r.initiativeId)) continue;
    seen.add(r.initiativeId);
    out.push({ initiativeId: r.initiativeId, project: r.project ?? null });
  }
  return out;
}

/**
 * W7-C1 (flows-25): the HONEST `data-can-start` derivation for the flow
 * monitor. The old `view.flow ? 'true' : 'false'` meant "the flow exists" —
 * automation was told a run could be started on flows that render no launch
 * surface at all. True exactly when the monitor renders a launcher:
 * a declared launchable kickoff kind (`idea` / `initiative-select`) or the
 * generic Start-Run fallback (no `kickoff:` block). `trigger-only` renders
 * only the explanatory note — no start.
 */
export function canStartFlow(flow: Flow | null): boolean {
  if (flow === null) return false;
  return flow.kickoff?.kind !== 'trigger-only';
}
