/**
 * Node-kind resolution — which executor shape a flow node resolves to.
 *
 * Beside the runner rather than inside it, so BOTH the runner (for the
 * reflection-close artifact exemption) and the factory-side executor table read
 * it without either importing the other (`docs/roadmaps/1.0.md` §4 M2 Lane B).
 * It imports no phase.
 */

import type { FlowNode, AgentDefinition } from '@forge/contracts/studio/types.ts';
import { PHASE_EXECUTOR_KINDS } from '../../orchestrator/studio/registry.ts';

export type NodeKind =
  | 'architect'   // has gate:'plan' — pre-satisfied, emit synthetic events
  | 'review'      // has gate:'verdict' — openPrInline + runClosure
  | 'agent'       // agent def exists, no executor declared — generic path (R2-01-F2); ADR-039 declared dispatch: a band guard (wi-contract / reflection-close) or loopStrategy:'ralph' routes to its orchestrator band inside execAgent
  | 'unknown';    // defensive fallback — no def, or an invalid declared executor

/**
 * Gate id → node kind. A gate ALWAYS wins over the agent field (the architect
 * node carries both agent:'architect' and gate:'plan' and must classify as
 * 'architect'). Extend by adding a row — no control-flow edit.
 *
 * `contract: 'agent'` (R4-18; the OOTB onboard flow wrapper was retired in
 * W7-C1 — this stays authorable vocabulary): an onboard-shaped flow's
 * `contract-check` node carries BOTH `gate:'contract'` and `agent:'contract-check'` (ADR-039
 * declared dispatch — no privileged executor enum). Mapping the gate id to
 * the ordinary `'agent'` kind does two things at once: it declares `contract`
 * as known gate vocabulary (so `resolveNodeKind` never falls through to
 * `'unknown'` for it), AND it routes the node through the SAME `execAgent` →
 * band-guard dispatch every other declared-dispatch node uses — so a
 * `{gate:'contract'}` node that lost its `agent:` field fails LOUD via
 * execAgent's "no agent definition" throw, instead of silently no-opping
 * through `execUnknown` the way an unmapped gate id would.
 */
const GATE_KIND: Readonly<Record<string, NodeKind>> = {
  plan: 'architect',
  verdict: 'review',
  contract: 'agent',
};

type PhaseExecutorKind = (typeof PHASE_EXECUTOR_KINDS)[number];

function isPhaseExecutorKind(value: string): value is PhaseExecutorKind {
  return (PHASE_EXECUTOR_KINDS as readonly string[]).includes(value);
}

/**
 * Resolve a node's executor kind from its gate/agent fields. Gates resolve
 * via the GATE_KIND table (unchanged). Agent nodes resolve from the AGENT
 * DEFINITION (R2-01-F2) instead of a hardcoded slug table:
 *   - no def for `node.agent` → 'unknown' (genuinely unresolvable ref).
 *   - def declares a valid `executor` (one of PHASE_EXECUTOR_KINDS) → that kind.
 *   - def declares an `executor` NOT in PHASE_EXECUTOR_KINDS → 'unknown'
 *     (invalid declared executor; also caught by lint's node-executor check).
 *   - def exists with no `executor` → 'agent' (generic library agent, runs
 *     via the F1 execAgent path).
 */
export function resolveNodeKind(node: FlowNode, agents: ReadonlyMap<string, AgentDefinition>): NodeKind {
  if (node.gate && GATE_KIND[node.gate]) return GATE_KIND[node.gate];
  if (!node.agent) return 'unknown';
  const def = agents.get(node.agent);
  if (!def) return 'unknown';
  if (def.executor !== undefined) return isPhaseExecutorKind(def.executor) ? def.executor : 'unknown';
  return 'agent';
}
