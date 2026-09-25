/**
 * `eventToNodeId`: the shared attribution leaf (bead forge-8vfn.15 size
 * split — see design.md).
 */
import type { EventLogEntry } from '@forge/kernel';

export function eventToNodeId(
  phase: string,
  nodeMapping: Map<string, string | null>,
  agentSlugToNodeId: Map<string, string>,
  metadata?: EventLogEntry['metadata'],
): string | null {
  // R2-01-F4: execAgent/runAgent (packages/agents/run-agent.ts) always emits its
  // events with phase:'orchestrator' + metadata.agent_slug (the frozen F1
  // contract, run-agent.test.ts:121) — resolve THAT to the flow node
  // declaring the agent slug before the orchestrator→null canonical override
  // below ever applies, so a generic-agent node's status/cost populate.
  // Flow-runner's own orchestrator-phase bookkeeping (skill:'flow-runner' /
  // 'flow-budgets' / 'cycle') carries no agent_slug, so it falls through to
  // the override untouched — this branch is purely additive.
  if (phase === 'orchestrator') {
    const agentSlug = metadata?.agent_slug;
    if (typeof agentSlug === 'string') {
      const nodeId = agentSlugToNodeId.get(agentSlug);
      if (nodeId !== undefined) return nodeId;
    }
  }
  // An explicit mapping entry wins — including an explicit `null` (orchestrator
  // and brain are deliberately ignored for phase status).
  if (nodeMapping.has(phase)) return nodeMapping.get(phase) ?? null;
  // Otherwise the event names its own node. For user-authored flows (ADR-028 /
  // J5) the agent slug = node id = event phase, so a run surfaces statuses on
  // the right hexes without the canonical seed-flow mapping knowing them.
  return phase;
}
