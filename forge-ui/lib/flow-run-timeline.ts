/**
 * Pure derivation for the flow run-detail TIMELINE (R6-01 WI-2 / F4) —
 * one row per node in a flow's own definition, carrying that node's OWN
 * status/cost/note as recorded on the run, never the run's aggregate.
 *
 * ADR-008 posture: nothing new is stored. Every row is derived from the
 * flow definition (`Flow.nodes`) plus the already-derived run model
 * (`Run.phases` / `Run.phaseMeta`), both of which the bridge already serves.
 *
 * See `./flow-run-timeline.test.ts` for the full acceptance contract this
 * file conforms to — in particular:
 *   - cost is EXACTLY `phaseMeta[node].costUsd`, never a re-sum over events
 *     and never the run's own `costUsd` total (the documented 2-3x
 *     re-summation defect `orchestrator/event-cost.ts` closes at its source).
 *   - status is per-node (`run.phases[node]`), never the run's own status.
 *   - rows follow `flow.nodes`' declared order and include every node, even
 *     one the run never touched (status defaults to 'pending', cost to 0).
 *   - a gate-only node (no `agent`) carries `agent: null`, never dropped or
 *     given a fabricated agent name.
 *   - `artifacts` is always `[]` — there is no per-node artifact data
 *     anywhere in the run model (`artifactsReady` is run-level, keyed by
 *     artifact TYPE — see `components/studio/PhaseDrawer.tsx:307`).
 *   - the note is DERIVED, never authored: a fixed-order composition of
 *     THIS node's own `delivered` / `iter`+`iterBudget` / `retries` /
 *     `wedged` fields, omitting absent or zero-valued facts rather than
 *     rendering filler. `model`, `brainReads` and `gateChecks` are
 *     deliberately excluded (`gateChecks` is unreachable — it only ever
 *     populates for `nodeId === 'unifier'`, and no seed flow declares that
 *     node since its retirement, R4-10-F1 / ADR-039/040).
 *   - a `run === null` (the run never existed) yields no rows at all, never
 *     a fabricated all-pending timeline.
 */

import type { Flow, Run, RunPhaseMeta, RunPhaseStatus } from './studio-client';

export type FlowRunTimelineRow = {
  nodeId: string;
  agent: string | null;
  status: RunPhaseStatus;
  costUsd: number;
  note: string | null;
  artifacts: string[];
};

/**
 * Compose a node's note from its OWN phaseMeta fields, in the fixed order
 * delivered · iterations · retries · wedged. Absent/zero facts are omitted,
 * never rendered as filler. Returns null when nothing true is left to say.
 */
function buildNote(meta: RunPhaseMeta | undefined): string | null {
  if (!meta) return null;
  const segments: string[] = [];

  if (meta.delivered) {
    const { files, insertions, commits } = meta.delivered;
    segments.push(`${files} files · +${insertions} · ${commits} commits`);
  }
  if (meta.iter !== undefined) {
    segments.push(meta.iterBudget !== undefined ? `iter ${meta.iter}/${meta.iterBudget}` : `iter ${meta.iter}`);
  }
  if (meta.retries) {
    segments.push(`${meta.retries} retries`);
  }
  if (meta.wedged) {
    segments.push('wedged');
  }

  return segments.length > 0 ? segments.join(' · ') : null;
}

export function deriveFlowRunTimeline(flow: Flow, run: Run | null): FlowRunTimelineRow[] {
  if (!run) return [];
  return flow.nodes.map((node) => {
    const meta = run.phaseMeta[node.id];
    return {
      nodeId: node.id,
      agent: node.agent ?? null,
      status: run.phases[node.id] ?? 'pending',
      costUsd: meta?.costUsd ?? 0,
      note: buildNote(meta),
      artifacts: [],
    };
  });
}
