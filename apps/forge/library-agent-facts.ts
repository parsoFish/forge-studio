/**
 * library-agent-facts.ts — the assembly's binding for `@forge/library`'s
 * `AgentFacts` port (M4 rulings 13 / 73 / 127).
 *
 * Library is rank 2 and cannot read agent files; `apps/forge` sits above every
 * package and is where the two sides meet, beside the Agent-kind loaders. The
 * `AgentFacts` annotation below is the drift check between them: if either
 * side's shape moves, this fails to compile rather than silently satisfying a
 * port that no longer describes it.
 *
 * WHY `compositions` WALKS THE ROSTER HERE RATHER THAN CALLING INTO AGENTS.
 * `agentUsageIndex` is built on a RESILIENT walk (a malformed studio agent is
 * skipped, not fatal — one bad sibling must not crash a whole scan), but that
 * walk is module-private in `packages/agents/studio/agent-usage.ts`, and the
 * exported `listAgentDefinitions` deliberately THROWS instead, because its own
 * callers catch per entry to raise a lint Finding. So the resilient form is
 * rebuilt here from agents' exported primitives — twelve lines that must agree
 * with the private copy. That agreement is not left to a comment:
 * `library-agent-facts.test.ts` derives an index from `compositions` and
 * asserts it EQUALS `agentUsageIndex` on the same fixture, including a
 * malformed agent, so a divergence in either walk fails there. Agents
 * exporting its resilient roster would delete this duplication outright; that
 * is an agents edit, recorded in this lane's OUTCOME as an M5 note rather than
 * made from here.
 */
import { join } from 'node:path';

import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import type { AgentFacts, ComposingAgent } from '@forge/library/studio/agent-facts.ts';
// DEEP imports, not the `@forge/agents` barrel, and the reason is measured:
// importing the door pulls every module it re-exports into
// `check-request-path-sinks`'s REACHABLE set, which made
// `packages/agents/agents-md-compose.ts` — a file nothing on this path calls —
// newly request-reachable and its three sinks newly un-baselined. Baselining
// them would have recorded a phantom; naming the four modules keeps the
// scanner's view of what a request can reach true (§15.85's shape).
import { agentUsageIndex } from '@forge/agents/studio/agent-usage.ts';
import { isStudioAgent, loadAgentDefinition } from '@forge/agents/studio/agent-registry.ts';
import { listSkillMdDirs, skillsDir } from '@forge/agents/skill-path.ts';

/** Studio agents under `<forgeRoot>/skills`, tolerating a malformed one. */
function resilientRoster(forgeRoot: string): AgentDefinition[] {
  const defs: AgentDefinition[] = [];
  for (const dir of listSkillMdDirs(skillsDir(forgeRoot))) {
    const mdPath = join(dir, 'SKILL.md');
    if (!isStudioAgent(mdPath)) continue;
    try {
      defs.push(loadAgentDefinition(mdPath));
    } catch {
      /* malformed studio agent — surfaced as a lint Finding elsewhere; skip */
    }
  }
  return defs.sort((a, b) => a.slug.localeCompare(b.slug));
}

export const libraryAgentFacts: AgentFacts = {
  usage: (kind, forgeRoot) => agentUsageIndex(kind, forgeRoot),
  compositions: (forgeRoot): readonly ComposingAgent[] =>
    resilientRoster(forgeRoot).map((a) => ({ slug: a.slug, composition: a.composition })),
  isAgentSkillMd: (mdPath) => isStudioAgent(mdPath),
};
