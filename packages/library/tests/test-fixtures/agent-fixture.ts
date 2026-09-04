/**
 * agent-fixture.ts — studio agents on disk, plus the `AgentFacts` those files
 * imply, for library's own tests.
 *
 * WHY A FIXTURE AND NOT THE REAL PROVIDER. Library is rank 2 and may not
 * import `@forge/agents` — a test edge is still an edge in the import graph
 * `check-boundaries` reads. So these tests supply the port themselves. What
 * that costs is the proof that the REAL provider agrees with this one; that
 * proof lives at the assembly, in `apps/forge/library-agent-facts.test.ts`,
 * which drives the same fixture through the real binding and asserts the same
 * facts. Neither half is sufficient alone, which is why both exist.
 *
 * THE RECORD IS THE FILE'S OWN CONTENT. `writeFixtureAgent` writes the
 * SKILL.md AND records the composition it wrote, so a test can never assert
 * against facts that disagree with the tree it built — the two come from one
 * call. `resetFixtureAgents` clears a root between cases.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentComposition } from '@forge/contracts/studio/types.ts';
import type { AgentFacts, ComposableKind, ComposingAgent } from '../../studio/agent-facts.ts';

const EMPTY: AgentComposition = { skills: [], tools: [], mcps: [], guards: [], hooks: [] };

/** Rosters by forge root — a test's own tmp dir, so entries never collide. */
const rosters = new Map<string, ComposingAgent[]>();

/** Forget every agent recorded for one root. */
export function resetFixtureAgents(forgeRoot: string): void {
  rosters.delete(forgeRoot);
}

/**
 * Write `skills/<slug>/SKILL.md` and record what it composes.
 *
 * `malformed` writes the file but records nothing — the shape the resilient
 * roster walk skips, so a test can assert `scanned` counts only the agents
 * that actually loaded.
 */
export function writeFixtureAgent(
  forgeRoot: string,
  slug: string,
  composition: Partial<AgentComposition> = {},
  opts: { malformed?: boolean } = {},
): string {
  const full: AgentComposition = { ...EMPTY, ...composition };
  const dir = join(forgeRoot, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const mdPath = join(dir, 'SKILL.md');
  writeFileSync(mdPath, opts.malformed ? MALFORMED : skillMd(slug, full), 'utf8');
  if (!opts.malformed) {
    const roster = rosters.get(forgeRoot) ?? [];
    roster.push({ slug, composition: full });
    rosters.set(forgeRoot, roster);
  }
  return mdPath;
}

/**
 * The facts the files written for this root imply.
 *
 * `usage` derives exactly what `agentUsageIndex` derives — per-agent dedupe,
 * carrier lists sorted by slug, `scanned` counting the agents that loaded —
 * and a connection is `tools ∪ mcps`, which is one carrier, not two.
 */
export function fixtureAgentFacts(forgeRoot: string): AgentFacts {
  const roster = (): readonly ComposingAgent[] =>
    [...(rosters.get(forgeRoot) ?? [])].sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    compositions: roster,
    isAgentSkillMd: (mdPath) =>
      roster().some((a) => mdPath === join(forgeRoot, 'skills', a.slug, 'SKILL.md')),
    usage: (kind: ComposableKind) => {
      const agents = roster();
      const collected = new Map<string, Set<string>>();
      for (const agent of agents) {
        for (const id of new Set(idsFor(kind, agent.composition))) {
          if (!collected.has(id)) collected.set(id, new Set());
          collected.get(id)!.add(agent.slug);
        }
      }
      const byId = new Map<string, string[]>();
      for (const [id, slugs] of collected) byId.set(id, [...slugs].sort((a, b) => a.localeCompare(b)));
      return { byId, scanned: agents.length };
    },
  };
}

function idsFor(kind: ComposableKind, c: AgentComposition): string[] {
  if (kind === 'skill') return [...c.skills];
  if (kind === 'hook') return [...c.hooks];
  return [...c.tools, ...c.mcps];
}

const MALFORMED = `---\nname: [unclosed\n---\n`;

function skillMd(slug: string, c: AgentComposition): string {
  const list = (xs: readonly string[]): string => `[${xs.join(', ')}]`;
  return `---
name: ${slug}
description: Test agent ${slug}.
purpose: Test purpose.
composition:
  skills: ${list(c.skills)}
  tools: ${list(c.tools)}
  mcps: ${list(c.mcps)}
  guards: ${list(c.guards)}
  hooks: ${list(c.hooks)}
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: none
interactivity: Fully autonomous.
allowed-tools: []
disallowed-tools: []
budgets:
  iterationCap: 5
---

Process body.
`;
}
