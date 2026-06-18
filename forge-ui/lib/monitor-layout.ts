/**
 * monitor-layout — pure run-model → monitor-topology mapping.
 *
 * Extracted from `components/studio/FlowTopology.tsx` so the mapping
 * (hex positions, phase-vs-WI distinction, per-phase cost, deterministic
 * phase-node deduplication) is unit-testable without a React tree. The
 * component is now a thin renderer over `buildMonitorLayout`.
 *
 * Pure + synchronous: no DOM, no React, no network. Same testability
 * convention as `lib/dep-layout.ts` ↔ `orchestrator/dep-levels.ts`.
 *
 * Contract notes (M7-1, ADR-031):
 *  - Each hex carries `hexKind` ('phase' | 'wi') so the harness can count a
 *    deterministic per-PHASE node set (filter out fanOut WI expansion) and a
 *    per-WI node set independently.
 *  - Each phase hex carries `costUsd` from `run.phaseMeta[nodeId].costUsd`
 *    (0 when absent). WI hexes carry costUsd=0 (per-WI cost is not tracked
 *    separately).
 *  - `topologyHexes` is the deduplicated set used to render the node layer —
 *    exactly one 'phase' hex per nodeId, plus every 'wi' hex. `hexes` is the
 *    full (pre-dedup) set, kept because edges resolve by nodeId only.
 */

import { topoLevels } from './dep-layout';
import type { Flow, FlowNode, Run } from './studio-client';

export const HEX_W = 88;
export const HEX_H = 80;
export const COL_GAP = 180; // horizontal gap between level columns (center-to-center)
const ROW_GAP = 110; // vertical gap between sibling nodes (center-to-center)
const PAD_X = 80;
const PAD_Y = 80;

export type HexKind = 'phase' | 'wi';

/** Position record for a rendered hex. */
export interface HexPos {
  nodeId: string;
  label: string;
  x: number; // center x in canvas-px
  y: number; // center y in canvas-px
  status: string;
  isGated: boolean;
  isFailed: boolean;
  hexKind: HexKind;
  wiId?: string; // set for fanOut-expanded WI hexes
  dependsOn?: string[]; // WI dependency ids (fanOut WI hexes) — surfaced as data-wi-deps (#11)
  costUsd: number; // per-phase cost (0 for WI hexes)
}

export interface MonitorLayout {
  /** All hexes including every fanOut WI expansion (used for edge resolution). */
  hexes: HexPos[];
  /**
   * Render set: exactly one 'phase' hex per nodeId + every 'wi' hex.
   * Deterministic per-PHASE node count for harness assertions.
   *
   * The fanOut node is INTENTIONALLY ABSENT from this set as a 'phase' hex when
   * WIs are present (its slot is replaced by the per-WI hexes) — this is what
   * keeps the per-PHASE count deterministic. The fanOut node's aggregate status
   * + cost are surfaced separately via `fanOutAggregate` (and rendered as a
   * hidden sentinel) so they remain assertable without inflating the count.
   */
  topologyHexes: HexPos[];
  /**
   * The fanOut node's aggregate phase status + cost, surfaced even when WIs are
   * present (in which case no 'phase' hex for it appears in `topologyHexes`).
   * Null when the flow has no fanOut node, or when it has no WIs (then the
   * fanOut node renders as an ordinary 'phase' hex in `topologyHexes`).
   */
  fanOutAggregate: { nodeId: string; status: string; costUsd: number } | null;
  edges: Array<{ from: string; to: string; artifact?: string }>;
  canvasW: number;
  canvasH: number;
}

/**
 * Build the monitor topology layout from a flow definition + a run model.
 * Pure: deterministic for a given (flow, run) pair.
 */
export function buildMonitorLayout(flow: Flow, run: Run | null): MonitorLayout {
  const nodes = flow.nodes;
  const edgesRaw = flow.edges;

  // Build dep map from edges (edge.to depends on edge.from)
  const depsOf = (n: FlowNode): string[] =>
    edgesRaw.filter((e) => e.to === n.id).map((e) => e.from);

  const { byLevel, maxLevel } = topoLevels(nodes, (n) => n.id, depsOf);

  // Identify fanOut node
  const fanOutNodeId = nodes.find((n) => n.fanOut)?.id ?? null;

  const hexes: HexPos[] = [];

  const gateNodeId = run?.gate ?? null;
  const failNodeId = run?.failedAt ?? null;

  for (let level = 0; level <= maxLevel; level++) {
    const levelNodes = byLevel.get(level) ?? [];
    const cx = PAD_X + level * COL_GAP;

    // Expand fanOut node if WIs are present
    let expandedCount = 0;
    for (const n of levelNodes) {
      if (n.id === fanOutNodeId && run?.workItems && run.workItems.length > 0) {
        expandedCount += run.workItems.length;
      } else {
        expandedCount += 1;
      }
    }

    let rowIndex = 0;

    for (const n of levelNodes) {
      const status = run?.phases[n.id] ?? 'pending';
      const isGated = n.id === gateNodeId;
      const isFailed = n.id === failNodeId;
      const agentLabel = n.agent ?? n.id;
      const phaseCost = run?.phaseMeta[n.id]?.costUsd ?? 0;

      if (n.id === fanOutNodeId && run?.workItems && run.workItems.length > 0) {
        // Expand to one hex per WI
        const wiCount = run.workItems.length;
        for (let wi = 0; wi < wiCount; wi++) {
          const wiItem = run.workItems[wi];
          const adjustedCy =
            PAD_Y +
            rowIndex * ROW_GAP +
            (expandedCount > 1 ? -((expandedCount - 1) * ROW_GAP) / 2 : 0);
          hexes.push({
            nodeId: n.id,
            label: wiItem.id,
            x: cx,
            y: adjustedCy,
            status: wiItem.status,
            isGated: false,
            isFailed: false,
            hexKind: 'wi',
            wiId: wiItem.id,
            dependsOn: wiItem.dependsOn,
            costUsd: 0,
          });
          rowIndex++;
        }
      } else {
        const adjustedCy =
          PAD_Y +
          rowIndex * ROW_GAP +
          (expandedCount > 1 ? -((expandedCount - 1) * ROW_GAP) / 2 : 0);
        hexes.push({
          nodeId: n.id,
          label: agentLabel,
          x: cx,
          y: adjustedCy,
          status,
          isGated,
          isFailed,
          hexKind: 'phase',
          costUsd: phaseCost,
        });
        rowIndex++;
      }
    }
  }

  // Deduplicate phase nodes for the render set: keep one 'phase' hex per nodeId
  // (filters out fanOut WI expansion so the phase-node count is deterministic).
  // Every 'wi' hex is kept.
  const seenPhase = new Set<string>();
  const topologyHexes: HexPos[] = [];
  for (const h of hexes) {
    if (h.hexKind === 'phase') {
      if (seenPhase.has(h.nodeId)) continue;
      seenPhase.add(h.nodeId);
    }
    topologyHexes.push(h);
  }

  // Surface the fanOut node's aggregate status + cost when it fanned out (i.e.
  // it has no 'phase' hex in topologyHexes). Keeps run.phases[fanOut] +
  // run.phaseMeta[fanOut].costUsd assertable without inflating the per-PHASE
  // count. Null when there is no fanOut node or it did not fan out (no WIs).
  const fannedOut =
    fanOutNodeId !== null &&
    !!run?.workItems &&
    run.workItems.length > 0;
  const fanOutAggregate = fannedOut
    ? {
        nodeId: fanOutNodeId as string,
        status: run?.phases[fanOutNodeId as string] ?? 'pending',
        costUsd: run?.phaseMeta[fanOutNodeId as string]?.costUsd ?? 0,
      }
    : null;

  // Render edge set (#11): when the fanOut node expanded into WI hexes, reroute
  // its inbound/outbound flow edges onto the WI hexes — the upstream pulse fans
  // into the ROOT WIs (those with no in-run deps) and the LEAF WIs feed the
  // downstream node, so the pulse follows the dependency DAG instead of pinning
  // to WI-1. The inter-WI dependencies themselves are surfaced as `data-wi-deps`
  // on each WI hex (not as cross-stack edges — WI hexes share a column). Without
  // a fanOut expansion, the flow edges pass through unchanged.
  let edges: Array<{ from: string; to: string; artifact?: string }> = edgesRaw.map((e) => ({
    from: e.from,
    to: e.to,
    artifact: e.artifact,
  }));
  if (fannedOut && fanOutNodeId) {
    const wis = run?.workItems ?? [];
    const present = new Set(wis.map((w) => w.id));
    const depsWithin = (w: { dependsOn?: string[] }): string[] =>
      (w.dependsOn ?? []).filter((d) => present.has(d));
    const roots = wis.filter((w) => depsWithin(w).length === 0).map((w) => w.id);
    const dependedOn = new Set<string>();
    for (const w of wis) for (const d of depsWithin(w)) dependedOn.add(d);
    const leaves = wis.filter((w) => !dependedOn.has(w.id)).map((w) => w.id);

    const rerouted: typeof edges = [];
    for (const e of edges) {
      if (e.to === fanOutNodeId) {
        // Emit the artifact label only on the FIRST rerouted leg to avoid
        // stacking the same label box N times over fanned WI hexes.
        roots.forEach((r, idx) =>
          rerouted.push({ from: e.from, to: r, artifact: idx === 0 ? e.artifact : undefined }),
        );
      } else if (e.from === fanOutNodeId) {
        leaves.forEach((l, idx) =>
          rerouted.push({ from: l, to: e.to, artifact: idx === 0 ? e.artifact : undefined }),
        );
      } else {
        rerouted.push(e);
      }
    }
    edges = rerouted;
  }

  // Canvas dimensions (computed over the full hex set)
  const allX = hexes.map((h) => h.x);
  const allY = hexes.map((h) => h.y);
  const canvasW = (allX.length ? Math.max(...allX) : 0) + PAD_X + HEX_W;
  const canvasH = (allY.length ? Math.max(...allY) : 0) + PAD_Y + HEX_H;

  return { hexes, topologyHexes, fanOutAggregate, edges, canvasW, canvasH };
}
