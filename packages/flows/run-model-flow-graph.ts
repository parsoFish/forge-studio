/**
 * The flow-graph derivations behind the run model: event phase → flow node id,
 * agent slug → node id, the per-flow node sets, and a run's flow lineage.
 *
 * Carved out of `run-model.ts` under the 800-line cap (M4-flows exit row 4).
 * These are pure functions over the flow definitions and agent frontmatter on
 * disk; `run-model.ts` aggregates over the EVENT LOG and consumes them.
 *
 * The direction is one-way, and that was MEASURED rather than assumed: the two
 * references to `aggregateRun` / `listRuns` inside this block are both PROSE in
 * doc comments, not calls.
 *
 * The three constants travel too, because they are flow-graph vocabulary rather
 * than run vocabulary — the fallback flow id, the canonicalization overrides and
 * the fallback phase→node table are what these derivations fall back TO.
 * `run-model.ts` imports them back.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listAgentDefinitions } from '@forge/agents/studio/agent-registry.ts';
import { loadFlowDefinition } from './studio/flow-registry.ts';
import { skillsDir as toSkillsDir } from '@forge/agents/skill-path.ts';

// A run's flow id comes from its manifest's `flow_id` (architect → forge-architect,
// develop → forge-develop). This constant
// is the fallback ONLY for pre-S8 manifests that predate the flow_id field — the
// flow they ran (forge-cycle) was retired (S8/DEC-3), so it is honestly labelled
// 'unknown' rather than pointing at a seed that no longer exists. The M4 edit-lock
// predicate (bridge-studio.ts: r.flowId === id) never matches 'unknown', which is
// correct — an unknowable archival flow is not editable.
export const FALLBACK_FLOW_ID = 'unknown';
/**
 * Canonicalization overrides applied on top of the derived mapping.
 * ADR-028 engine will own this table in M3.
 *
 * - reflection → reflect (frontmatter phase is 'reflector', events emit 'reflection')
 * - review-loop/closure → review (gate-only node; no agent in flow.yaml)
 * - orchestrator/brain → null (ignored for phase status)
 */
export const CANONICAL_PHASE_OVERRIDES: Record<string, string | null> = {
  reflection: 'reflect',   // events say 'reflection'; frontmatter says 'reflector'
  'review-loop': 'review', // gate-only node has no agent
  closure: 'review',       // closure folds into review node
  // R4-10-F1: the adversarial-review AGENT carries `phase: review` in its
  // frontmatter, so the flow-node derivation below would otherwise claim
  // `review → adversarial-review` and steal the mapping from the verdict GATE
  // node (id `review`). Pin it: literal `review`-phase events (a user-authored
  // flow's review node, the seeded spine runs) resolve to the `review` gate,
  // while the adversarial-review NODE resolves via its `agent_slug` (the
  // pipeline emits `phase:'orchestrator' + agent_slug`, never `phase:'review'`).
  review: 'review',
  orchestrator: null,      // ignored for phase status
  brain: null,             // ignored for phase status
};
/**
 * Fallback mapping used when flow.yaml or registry loading fails.
 * Kept in sync with the expected derived result manually.
 */
export const FALLBACK_PHASE_TO_NODE: Record<string, string | null> = {
  architect: 'architect',
  'project-manager': 'pm',
  'developer-loop': 'dev',
  unifier: 'unifier',
  'review-loop': 'review',
  closure: 'review',
  review: 'review', // R4-10-F1: pin the verdict gate (see CANONICAL_PHASE_OVERRIDES)
  reflection: 'reflect',
  orchestrator: null,
  brain: null,
};
/**
 * Build the event-phase → flow-node-id mapping from the seed flow definitions on
 * disk + agent SKILL.md frontmatter. Falls back to the hardcoded table if the
 * studio/ directory or any required file is missing.
 *
 * S8/DEC-3: forge-cycle was retired, so this derives from the UNION of EVERY flow
 * under studio/flows/ (forge-architect / forge-develop)
 * rather than the single monolith. Each flow node with an
 * `agent` maps SKILL.md[phase] → node.id; the first flow to map a phase wins (all
 * seed flows share the canonical node ids, so the union is unambiguous), and any
 * canonical phase a flow never declares is back-filled from the hardcoded table.
 *
 * Called once per aggregateRun / listRuns invocation. Results are not cached
 * (bridge adds none in M1 — definitions are small).
 *
 * Exported for testing; not part of the public run-aggregation API.
 */
export function buildNodeMapping(root: string): Map<string, string | null> {
  try {
    const flowsDir = join(resolve(root), 'studio', 'flows');
    const skillsDir = toSkillsDir(resolve(root));

    const agents = listAgentDefinitions(skillsDir);
    // Index agents by slug for O(1) lookup
    const agentBySlug = new Map(agents.map((a) => [a.slug, a]));

    const mapping = new Map<string, string | null>();

    // Apply canonicalization overrides first so they take precedence
    for (const [phase, nodeId] of Object.entries(CANONICAL_PHASE_OVERRIDES)) {
      mapping.set(phase, nodeId);
    }

    // Derive from every seed flow's nodes (union; first-write-wins per phase).
    const flowDirs = existsSync(flowsDir) ? readdirSync(flowsDir) : [];
    for (const entry of flowDirs) {
      const flowPath = join(flowsDir, entry, 'flow.yaml');
      if (!existsSync(flowPath)) continue;
      let flow;
      try {
        flow = loadFlowDefinition(flowPath);
      } catch {
        continue; // a single malformed flow must not sink the whole mapping
      }
      for (const node of flow.nodes) {
        if (!node.agent) continue; // gate-only nodes have no agent
        const agentDef = agentBySlug.get(node.agent);
        if (!agentDef?.phase) continue;
        if (!mapping.has(agentDef.phase)) mapping.set(agentDef.phase, node.id);
      }
    }

    // Back-fill any canonical phase no flow declared, so the mapping is always
    // complete (e.g. a stripped studio/ dir). Never overwrites a derived value.
    for (const [phase, nodeId] of Object.entries(FALLBACK_PHASE_TO_NODE)) {
      if (!mapping.has(phase)) mapping.set(phase, nodeId);
    }

    return mapping;
  } catch (err) {
    // Registry unavailable — fall back to the hardcoded table so the bridge
    // never crashes mid-edit. Log anything that is NOT a plain ENOENT so real
    // configuration errors are observable.
    const isEnoent =
      (err as NodeJS.ErrnoException).code === 'ENOENT' ||
      (err instanceof Error && err.message.includes('no such file'));
    if (!isEnoent) {
      console.error('[run-model] definition load failed, using fallback mapping:', err);
    }
    return new Map(Object.entries(FALLBACK_PHASE_TO_NODE));
  }
}

/**
 * R2-01-F4: agent slug → flow-node-id, built directly from every seed flow's
 * `node.agent` field (union over studio/flows/*, same pattern as
 * buildNodeMapping; first-write-wins per slug — every seed flow shares
 * canonical node ids for a shared agent, so the union is unambiguous).
 *
 * Deliberately a DIFFERENT derivation from buildNodeMapping: that map routes
 * through the agent's SKILL.md `phase:` frontmatter (event.phase → node.id),
 * because phase-named events (architect/project-manager/…) carry that phase
 * string directly. A generic execAgent/runAgent event (orchestrator/
 * run-agent.ts) never carries a resolvable phase — it always carries the
 * literal `phase:'orchestrator'` plus `metadata.agent_slug` — so it needs the
 * agent's own slug resolved straight to the node id declaring it, no
 * frontmatter indirection. Consumed by eventToNodeId (run-model-derive.ts)
 * as an additive resolution path ahead of the orchestrator→null override.
 *
 * Missing/unreadable studio/flows/ degrades to an empty map (no generic-agent
 * node resolves) — the same fail-safe shape as buildFlowNodeSets, and never
 * throws so aggregateRun/listRuns stay crash-safe.
 *
 * Exported for testing; not part of the public run-aggregation API.
 */
export function buildAgentSlugToNodeId(root: string): Map<string, string> {
  const mapping = new Map<string, string>();
  try {
    const flowsDir = join(resolve(root), 'studio', 'flows');
    const flowDirs = existsSync(flowsDir) ? readdirSync(flowsDir).sort() : [];
    for (const entry of flowDirs) {
      const flowPath = join(flowsDir, entry, 'flow.yaml');
      if (!existsSync(flowPath)) continue;
      let flow;
      try {
        flow = loadFlowDefinition(flowPath);
      } catch {
        continue; // a single malformed flow must not sink the whole mapping
      }
      for (const node of flow.nodes) {
        if (!node.agent) continue; // gate-only nodes have no agent
        if (!mapping.has(node.agent)) mapping.set(node.agent, node.id);
      }
    }
  } catch {
    // Registry unavailable — degrade to an empty map, same effect as a flow
    // set that declares no generic-agent nodes; existing eventToNodeId
    // resolution is entirely untouched either way (additive fix).
  }
  return mapping;
}

/**
 * S9: map each seed flow id → its set of node ids, so a run's flow LINEAGE can be
 * derived (the flows whose nodes the run actually executed). Built once per list
 * pass, alongside buildNodeMapping. Empty map when studio/flows is unavailable.
 */
export function buildFlowNodeSets(root: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  try {
    const flowsDir = join(resolve(root), 'studio', 'flows');
    const flowDirs = existsSync(flowsDir) ? readdirSync(flowsDir).sort() : [];
    for (const entry of flowDirs) {
      const flowPath = join(flowsDir, entry, 'flow.yaml');
      if (!existsSync(flowPath)) continue;
      try {
        const flow = loadFlowDefinition(flowPath);
        result.set(flow.id, new Set(flow.nodes.map((n) => n.id)));
      } catch {
        continue; // a malformed flow must not sink the lineage of every run
      }
    }
  } catch {
    /* registry unavailable — degrade to flow-id-only lineage */
  }
  return result;
}

/**
 * S9 (DEC-2/DEC-3): the seed flows this run traversed — every flow at least one of
 * whose nodes the run executed (its phases). A threaded spine run (one cycle_id whose
 * manifest flow_id is repointed architect→develop at the hand-off) therefore surfaces
 * under forge-architect + forge-develop, so each flow's monitor renders
 * its own slice. The manifest's own flow is always included.
 */
export function computeFlowLineage(
  phaseNodeIds: readonly string[],
  manifestFlowId: string,
  flowNodeSets: Map<string, Set<string>>,
): string[] {
  const ran = new Set(phaseNodeIds);
  // Count how many flows each node id appears in, so we can key lineage off nodes
  // GLOBALLY UNIQUE to a flow.
  const nodeFlowCount = new Map<string, number>();
  for (const nodeIds of flowNodeSets.values()) {
    for (const nid of nodeIds) nodeFlowCount.set(nid, (nodeFlowCount.get(nid) ?? 0) + 1);
  }
  const lineage: string[] = [];
  for (const [flowId, nodeIds] of flowNodeSets) {
    if (flowId === manifestFlowId) { lineage.push(flowId); continue; }
    // Include another flow only if the run executed a node UNIQUE to it (present in
    // exactly one flow). The spine stages own unique nodes (architect+pm, reflect),
    // so they join the lineage; a parity copy/subset flow (e.g. forge-develop-scratch,
    // whose dev/unifier/review are shared with forge-develop) owns no unique node, so
    // it never falsely claims a run.
    let hasUniqueRanNode = false;
    for (const nid of nodeIds) {
      if (ran.has(nid) && nodeFlowCount.get(nid) === 1) { hasUniqueRanNode = true; break; }
    }
    if (hasUniqueRanNode) lineage.push(flowId);
  }
  if (manifestFlowId !== FALLBACK_FLOW_ID && !lineage.includes(manifestFlowId)) lineage.push(manifestFlowId);
  return lineage;
}
