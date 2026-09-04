/**
 * `deriveFlowKickoff` — which launch surface a flow gets, read off its own
 * topology at save time (T1 ruling 167, bead `forge-8vfn.6.11.1`).
 *
 * THE DEFECT IT CLOSES. `FlowDefinition.kickoff` (ADR 027 Stage C) decides
 * which launcher `/flows/<id>` renders — `idea` (the architect's NewIdeaBox),
 * `initiative-select` (the planned-initiative picker), `trigger-only` (none),
 * absent ⇒ the generic Start-Run picker (ADR 028). It was DECLARED-only: the
 * two seed flows carry a hand-written `kickoff:` block and the Studio flow
 * builder writes none, so every flow an operator built rendered
 * `data-kickoff-kind="generic"` and could not be launched from an idea however
 * it was assembled. A flow that BEGINS with the architect and cannot be given
 * an idea is a flow whose first station has no input.
 *
 * WHY DERIVE RATHER THAN ADD A PICKER. The kickoff kind is not an independent
 * choice — it is a restatement of what the first station needs in order to
 * start. The architect starts from a free-text idea; a work-item fan-out starts
 * from a planned initiative. A picker beside the canvas could disagree with the
 * canvas, which is the `declared-data-fails-open` class this repo keeps paying
 * for (`flows-25`: `canStartFlow` as a second enumeration of which kinds
 * launch). One source — the graph — and the builder RENDERS the answer rather
 * than re-deriving it (`apps/studio` imports contracts only, so it structurally
 * cannot hold a second copy).
 *
 * FILL, NEVER OVERWRITE. A declared `kickoff:` wins, always. §15.166 measured
 * the cost of the other reading one package over: `fillOnly`'s
 * `starterValue !== undefined ? starterValue : current` reads as a fill and
 * behaves as a rewrite, and would have retargeted a live project's CI gate.
 * Here the same slip would silently retarget a hand-authored launch surface.
 *
 * WHAT IS NOT DERIVED, AND WHY. `trigger-only` stays DECLARED-only. A flow's
 * own file carries no signal that it is trigger-ENTERED: `FlowNode` is
 * `{id, agent, gate, fanOut, resumable, x, y}` — there is no trigger station,
 * and the builder's palette can only place `agent | project | artifact` chips;
 * and `FlowTrigger` rows are OUTBOUND dispatches (`forge-develop` fires the
 * reflector agent `on: merged`), so `triggers.length > 0` says nothing about
 * how this flow starts — deriving from it would mislabel `forge-develop`
 * itself. ADR 028's W7-C1 amendment records the same fact from the other end:
 * the `trigger-only` example "is historical … no seed flow uses it today". A
 * branch that can never be true is decorative (§15.162), so there is no such
 * branch — the kind stays authorable in YAML and authoritative when present.
 * If a trigger-entry signal is ever declared, it is one row in the table below.
 */
import type {
  AgentDefinition,
  FlowDefinition,
  FlowEdge,
  FlowKickoff,
  FlowKickoffKind,
  FlowNode,
} from '@forge/contracts/studio/types.ts';

import { resolveNodeKind } from '../flow-node-kind.ts';

/**
 * The shapes a first station can have, as far as launching is concerned.
 * Exhaustive over the table below — a new shape cannot compile without a kind.
 */
export type FlowHeadShape =
  | 'architect'         // carries the plan gate: it turns an idea into a plan
  | 'work-item-fanout'  // fans out over an initiative's work items
  | 'plain';            // an ordinary station: nothing about it names an input

/** Head shape → the launch surface it implies. `null` ⇒ the generic launcher. */
const HEAD_SHAPE_KICKOFF: Readonly<Record<FlowHeadShape, FlowKickoffKind | null>> = {
  architect: 'idea',
  'work-item-fanout': 'initiative-select',
  plain: null,
};

/**
 * The graph's entry station: the one node no edge points at. NOT `nodes[0]` —
 * the builder serialises react-flow's own node order, so a station placed after
 * the seeded three sits last in the array while being the flow's entry. Returns
 * null when the entry is not decidable: a cycle has no head, and a flow with
 * two heads has no FIRST station to read a launch surface off.
 */
function headNode(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): FlowNode | null {
  const hasInbound = new Set(edges.map((e) => e.to));
  const heads = nodes.filter((n) => !hasInbound.has(n.id));
  return heads.length === 1 ? heads[0] : null;
}

/**
 * The head's shape, from its DECLARED facts only, and no slug is named here.
 * Three of them, in order:
 *
 *  1. the plan gate — `resolveNodeKind`, the same table the flow-runner
 *     dispatches on, which is how the SHIPPED `forge-architect` head reads;
 *  2. the agent definition's `phase: 'architect'`. This row is not redundant
 *     with (1): `FlowBuilderCanvas.placeStationAt` creates a station carrying
 *     `{agentRef}` and NOTHING else, so an architect an operator drags out of
 *     the palette saves as `{id, agent: 'architect', x, y}` with no gate at
 *     all. Deriving on the gate alone would have answered `generic` for every
 *     flow the builder can actually produce — the exact defect this module
 *     exists to close. `phase` is the package's own dispatch vocabulary
 *     already (`run-model-flow-graph.ts` maps `event.phase` → node id);
 *  3. the agent definition's `fanout.drivingArtifact: 'work-items'` — a
 *     station that fans out over an initiative's work items must be launched
 *     by picking one.
 *
 * Returns null for a head whose agent is not installed: an unresolvable
 * reference is a lint error elsewhere, never a guess here.
 *
 * The one imprecision, named: `architect-completeness-critic` also declares
 * `phase: 'architect'`, so as a flow HEAD it would derive `idea`. It is
 * `library: false` — the palette cannot place it — and no flow declares it as
 * an entry, so the case is unreachable by construction; and a hand-authored
 * flow that did so can declare its own `kickoff:`, which always wins.
 */
function headShape(head: FlowNode, agents: ReadonlyMap<string, AgentDefinition>): FlowHeadShape | null {
  const kind = resolveNodeKind(head, agents);
  if (kind === 'architect') return 'architect';
  if (kind === 'unknown') return null;
  const def = head.agent === undefined ? undefined : agents.get(head.agent);
  if (def?.phase === 'architect') return 'architect';
  if (def?.fanout?.drivingArtifact === 'work-items') return 'work-item-fanout';
  return 'plain';
}

/**
 * The kickoff a flow should carry. A declared one is returned unchanged; an
 * absent one is derived from the head station, or left absent when the graph
 * does not decide it.
 */
export function deriveFlowKickoff(
  def: Pick<FlowDefinition, 'nodes' | 'edges'> & { kickoff?: FlowKickoff },
  agents: ReadonlyMap<string, AgentDefinition>,
): FlowKickoff | undefined {
  if (def.kickoff !== undefined) return def.kickoff;
  const head = headNode(def.nodes, def.edges);
  if (head === null) return undefined;
  const shape = headShape(head, agents);
  if (shape === null) return undefined;
  const kind = HEAD_SHAPE_KICKOFF[shape];
  return kind === null ? undefined : { kind };
}
