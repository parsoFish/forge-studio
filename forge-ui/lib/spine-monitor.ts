/**
 * spine-monitor — render a THREADED spine run as one full lifecycle topology.
 *
 * The 3-stage SDLC spine (forge-architect → forge-develop → forge-reflect, DEC-2)
 * threads ONE manifest + ONE cycle_id across all three flows. The architect→develop
 * hand-off repoints the manifest's `flow_id` from `forge-architect` → `forge-develop`,
 * so the completed run is labelled `forge-develop` and surfaces under
 * `/flows/forge-develop`. But the develop flow's topology is only `dev → unifier →
 * review` — so `buildMonitorLayout` (which iterates the FLOW's nodes) drops the
 * architect/pm/reflect phases the run actually executed, and the entry `dev` node
 * carries no `fanOut` (the lint rule forbids it on a node with no inbound edge), so
 * the per-WI hexes never render either.
 *
 * The run model already carries the FULL phase set + workItems (derived from the
 * shared events.jsonl). This module supplies the missing topology: a canonical spine
 * lifecycle, filtered to the phases the run actually ran, with a fan-out `dev` node —
 * so the monitor reuses the tested `buildMonitorLayout` and shows the whole spine.
 */

import type { Flow, FlowNode, Run } from './studio-client';

/** Canonical spine node ids in lifecycle order (mirror the run-model node ids). */
export const SPINE_NODE_IDS = ['architect', 'pm', 'dev', 'unifier', 'review', 'release-finalize', 'reflect'] as const;

/** The canonical spine topology (superset). `dev` fans out into per-WI hexes,
 *  driven at render time by `run.workItems` (not a flow-authoring flag). */
const FULL_SPINE_NODES: readonly FlowNode[] = [
  { id: 'architect', agent: 'architect' },
  { id: 'pm', agent: 'project-manager' },
  { id: 'dev', agent: 'developer-ralph', fanOut: 'work-items' },
  { id: 'unifier', agent: 'developer-unifier' },
  { id: 'review', gate: 'verdict' },
  { id: 'release-finalize', agent: 'release-finalizer' },
  { id: 'reflect', agent: 'reflector' },
];

/** Artifact label on the edge FEEDING each node (mirrors the real seed-flow edges). */
const EDGE_ARTIFACT_BY_TO: Record<string, string> = {
  pm: 'plan',
  dev: 'work-items',
  unifier: 'wi-branches',
  review: 'pr',
  'release-finalize': 'verdict',
  reflect: 'verdict',
};

/**
 * True when `run` is a threaded spine run whose lifecycle exceeds the viewed
 * `flow`'s own nodes — i.e. it executed canonical spine phases the flow does not
 * define (architect/pm/reflect on the develop flow). Guards against false positives
 * on a single-stage flow or a user-authored flow that happens to reuse a node id.
 */
export function isThreadedSpineRun(flow: Flow, run: Run | null): boolean {
  if (!run) return false;
  const flowNodeIds = new Set(flow.nodes.map((n) => n.id));
  const ranSpinePhases = SPINE_NODE_IDS.filter((id) => run.phases[id] !== undefined);
  const missingFromFlow = ranSpinePhases.filter((id) => !flowNodeIds.has(id));
  // A real threaded spine ran ≥3 canonical phases and at least one the flow lacks.
  return missingFromFlow.length > 0 && ranSpinePhases.length >= 3;
}

/**
 * The flow to hand the monitor for THIS run: the canonical spine lifecycle (filtered
 * to the phases the run actually ran, edges re-chained in order) when the run is a
 * threaded spine, else the flow unchanged. Pure + deterministic for unit tests.
 */
export function effectiveMonitorFlow(flow: Flow, run: Run | null): Flow {
  if (!isThreadedSpineRun(flow, run)) return flow;
  const present = FULL_SPINE_NODES.filter((n) => run!.phases[n.id] !== undefined);
  const edges = present.slice(1).map((n, i) => ({
    from: present[i].id,
    to: n.id,
    artifact: EDGE_ARTIFACT_BY_TO[n.id],
  }));
  return {
    id: 'forge-spine',
    name: flow.name,
    goal: flow.goal,
    project: flow.project,
    kb: flow.kb,
    nodes: present.map((n) => ({ ...n })),
    edges,
    triggers: [],
    origin: flow.origin,
  };
}
