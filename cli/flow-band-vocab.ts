/**
 * Real flow band vocabulary (R1-06 WI-1, T1 ruling Q8).
 *
 * Placed in `cli/` rather than `orchestrator/` — ADR-042 caps the surface
 * area of `orchestrator/`, and `cli/` routes are not capped; this is a small,
 * pure helper consumed by the KB-create bridge route and by `forge studio
 * lint`, neither of which is orchestrator hot-path code.
 *
 * Derives a flow's DECLARED band vocabulary from the actual SKILL.md
 * `composition.guards` of every agent-bearing node in the flow, resolved via
 * `resolveBandGuard`/`BAND_CANONICAL_SLUG` (orchestrator/agent-bands.ts) —
 * never a hardcoded per-flow guess. Reuses the existing flow/agent loaders
 * (orchestrator/studio/registry.ts, orchestrator/skill-path.ts) rather than
 * re-parsing yaml/frontmatter here.
 */
import { join, resolve } from 'node:path';

import { loadFlowDefinition, loadAgentDefinition } from '../orchestrator/studio/registry.ts';
import { resolveBandGuard, BAND_GUARD_IDS } from '../orchestrator/agent-bands.ts';
import { skillPath } from '../orchestrator/skill-path.ts';

/**
 * Returns the distinct band ids the flow's own nodes actually declare.
 *
 * A flow directory whose `flow.yaml` is missing or unparsable (e.g. a
 * freshly scaffolded, not-yet-authored flow — `flowId` is trusted to be a
 * real `studio/flows/` directory name, but that says nothing about the file
 * inside it) has no discoverable REAL vocabulary to report. Rather than
 * throw and block every caller that only wants to validate a candidate band
 * id against SOME closed vocabulary, this falls back to the full closed
 * platform band vocabulary (`BAND_GUARD_IDS`) — a caller still rejects an
 * invented band id, it just cannot narrow to this flow's true subset yet.
 *
 * A node whose `agent` does not resolve to a loadable SKILL.md (a dangling
 * flow reference — flagged separately by `forge studio lint`) contributes no
 * band rather than throwing, so one broken node doesn't crash vocabulary
 * derivation for every other node's real, resolvable band.
 */
export function listFlowBandIds(forgeRoot: string, flowId: string): string[] {
  const root = resolve(forgeRoot);
  const flowYamlPath = join(root, 'studio', 'flows', flowId, 'flow.yaml');

  let nodes: ReturnType<typeof loadFlowDefinition>['nodes'];
  try {
    nodes = loadFlowDefinition(flowYamlPath).nodes;
  } catch {
    return [...BAND_GUARD_IDS];
  }

  const bandIds = new Set<string>();
  for (const node of nodes) {
    if (!node.agent) continue; // gate-only node — no SKILL.md to consult
    try {
      const def = loadAgentDefinition(skillPath(node.agent, root));
      const band = resolveBandGuard(def);
      if (band) bandIds.add(band);
    } catch {
      continue; // unresolvable node agent — contributes no band
    }
  }
  return [...bandIds];
}
