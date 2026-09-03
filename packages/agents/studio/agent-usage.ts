/**
 * The reverse index — which agents compose a given skill, hook or connection.
 *
 * WHY THE PACKAGE THAT OWNS AGENTS ANSWERS THIS. Three library modules build
 * this answer today, each with a private copy of the same agent-roster walk:
 * `studio/hook-library.ts` (`computeHookUsage`), `studio/connection-library.ts`
 * (`computeConnectionUsage`) and `studio/skill-trust.ts` (`deriveSkillUsage`
 * over its own `listAgentDefinitionsResilient`). Library is rank 2 and agents
 * is rank 3, so library reading agent files at all is what ruling 13 forbids:
 * the answer must come from here and reach library by INJECTION at
 * `apps/forge/routes.ts`, never by import.
 *
 * WHY AN INDEX AND NOT `agentsUsing(kind, id)` ALONE (ruling 73). Ruling 13
 * names a per-id function, and it is exported below — but the real consumers
 * are LISTINGS: `listHookLibrary` renders every hook with its carriers,
 * `listSkillLibrary` every skill. Asking per id would walk the whole roster
 * once per id, turning one scan into N, and a per-id answer cannot carry
 * `scanned`, which all three call sites report as `derivation.scanned`. So the
 * primitive is the index and `agentsUsing` is a thin read of it.
 *
 * THIS COPIES LIBRARY'S BEHAVIOUR, INCLUDING ITS EDGES, ON PURPOSE. Library s3
 * replaces its three copies with this one and proves the answers identical
 * before and after; anything "improved" here fails that parity test on this
 * package's account rather than its own. So: a malformed agent is skipped
 * rather than fatal ("a single bad sibling must not crash the whole scan"),
 * `scanned` counts the agents successfully LOADED after that filter rather
 * than the directories walked, and a connection is `composition.tools` ∪
 * `composition.mcps` rather than a field of its own. The three call sites also
 * differ cosmetically in what they pass — two hand a forge root and join
 * `skills` themselves, one hands `skillsDir(forgeRoot)` — and those resolve to
 * the same directory, since `skillsDir(root)` IS `join(root, 'skills')`.
 * Checked, not assumed.
 */
import { join } from 'node:path';

import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

import { listSkillMdDirs, skillsDir } from '../skill-path.ts';
import { isStudioAgent, loadAgentDefinition } from './agent-registry.ts';

/** The composable kinds an agent can name. A connection spans two fields. */
export type AgentUsageKind = 'skill' | 'hook' | 'connection';

export type AgentUsageIndex = {
  /** id → the slugs of every agent composing it, sorted, de-duplicated. */
  byId: Map<string, string[]>;
  /** Well-formed studio agents scanned — what library reports as `derivation.scanned`. */
  scanned: number;
};

/** The ids one agent composes for a kind. The only place a kind names a field. */
function idsFor(kind: AgentUsageKind, agent: AgentDefinition): string[] {
  switch (kind) {
    case 'skill':
      return agent.composition.skills;
    case 'hook':
      return agent.composition.hooks;
    case 'connection':
      // A connection IS a tools/mcps entry (library's connection-library D2) —
      // an agent naming the same id in both is one carrier, not two, which the
      // `Set` below collapses.
      return [...agent.composition.tools, ...agent.composition.mcps];
  }
}

/**
 * Studio agents under `<forgeRoot>/skills`, tolerating a malformed one.
 *
 * `listAgentDefinitions` is deliberately NOT resilient — its own callers catch
 * per entry to produce a lint Finding — but a usage index needs only the
 * well-formed agents, and a failing agent's load error is already surfaced as
 * a Finding elsewhere. Identical to the three copies in library, which is the
 * point.
 */
function listAgentsResilient(forgeRoot: string): AgentDefinition[] {
  const defs: AgentDefinition[] = [];
  for (const dir of listSkillMdDirs(skillsDir(forgeRoot))) {
    const mdPath = join(dir, 'SKILL.md');
    if (!isStudioAgent(mdPath)) continue;
    try {
      defs.push(loadAgentDefinition(mdPath));
    } catch {
      /* malformed studio agent — already reported elsewhere; skip here */
    }
  }
  return defs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Every id of `kind`, with the agents composing it — one roster walk.
 *
 * Never throws on an unreadable root: a checkout with no `skills/` directory
 * yields an empty index, because `listSkillMdDirs` already returns `[]` there
 * and a caller asking "who uses this?" of an empty roster has its answer.
 */
export function agentUsageIndex(kind: AgentUsageKind, forgeRoot: string): AgentUsageIndex {
  const agents = listAgentsResilient(forgeRoot);
  const collected = new Map<string, Set<string>>();
  for (const agent of agents) {
    for (const id of new Set(idsFor(kind, agent))) {
      if (!collected.has(id)) collected.set(id, new Set());
      collected.get(id)!.add(agent.slug);
    }
  }
  const byId = new Map<string, string[]>();
  for (const [id, slugs] of collected) byId.set(id, [...slugs].sort((a, b) => a.localeCompare(b)));
  return { byId, scanned: agents.length };
}

/**
 * The agents composing one id — ruling 13's named surface, over the same
 * index. `[]` for an id nobody composes, never `undefined`: "nobody uses this"
 * is an answer, and a caller should not have to tell it apart from "I did not
 * look".
 *
 * Prefer {@link agentUsageIndex} when answering for more than one id; this
 * walks the whole roster per call by construction.
 */
export function agentsUsing(kind: AgentUsageKind, id: string, forgeRoot: string): string[] {
  return agentUsageIndex(kind, forgeRoot).byId.get(id) ?? [];
}
