/**
 * flow-fanout.ts — the fan-out predicate, shared by the authoring lint and the
 * flow engine's runtime enforcement.
 *
 * ADR 028 §1: a `fanOut` node resolves its multiplicity at runtime from a named
 * upstream artifact, so a node declaring `fanOut` must have at least one
 * inbound edge whose `artifact` matches the declaration. A node with zero
 * inbound edges (a flow's entry node) can never satisfy that, so `fanOut` on an
 * entry node is always a violation.
 *
 * ONE predicate, two call sites — `validateFlow` at authoring time and
 * `runFlow`'s pre-walk at runtime — precisely so the two can never drift. It
 * lives here rather than in the studio validator because it is a statement
 * about flow SEMANTICS (`SPEC.md` §2, Station), not about the studio object
 * model, and because the runner may not import `orchestrator/`.
 */
import type { FlowDefinition } from '@forge/contracts/studio/types.ts';

export type FanOutViolation = { nodeId: string; fanOut: string };

export function findFanOutViolations(flow: FlowDefinition): FanOutViolation[] {
  const violations: FanOutViolation[] = [];
  for (const node of flow.nodes) {
    if (node.fanOut) {
      const hasMatchingInbound = flow.edges.some(
        (e) => e.to === node.id && e.artifact === node.fanOut,
      );
      if (!hasMatchingInbound) {
        violations.push({ nodeId: node.id, fanOut: node.fanOut });
      }
    }
  }
  return violations;
}
