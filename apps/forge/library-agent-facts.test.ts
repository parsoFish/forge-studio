/**
 * The assembly's `AgentFacts` binding — proven against the real provider.
 *
 * Library's own tests supply the port from a fixture, because library (rank 2)
 * may not import `@forge/agents` (rank 3) even in a test. That leaves exactly
 * one thing unproven on that side: whether the REAL binding answers what those
 * fixtures assume. This file is that proof, and it is the only place both
 * halves are importable.
 *
 * It also carries the drift guard the inversion made necessary. `usage` is
 * agents' `agentUsageIndex`, built on a resilient roster walk that is private
 * to `packages/agents/studio/agent-usage.ts`; `compositions` rebuilds that walk
 * from agents' exported primitives because the private one cannot be reached.
 * Two walks that must agree is exactly the shape that rots quietly, so the
 * first test below derives an index FROM `compositions` and asserts it equals
 * `agentUsageIndex` — on a fixture that includes a malformed agent, which is
 * the case the two walks could most plausibly disagree about, and on the real
 * `skills/` tree, which carries shapes no fixture would think to plant.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import { agentUsageIndex } from '@forge/agents/studio/agent-usage.ts';
import { isStudioAgent } from '@forge/agents/studio/agent-registry.ts';
import type { ComposableKind } from '@forge/library/studio/agent-facts.ts';

import { libraryAgentFacts } from './library-agent-facts.ts';

const KINDS: readonly ComposableKind[] = ['skill', 'hook', 'connection'];

const createdDirs: string[] = [];
after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'library-agent-facts-'));
  createdDirs.push(dir);
  return dir;
}

function writeAgent(
  root: string,
  slug: string,
  c: { skills?: string[]; tools?: string[]; mcps?: string[]; guards?: string[]; hooks?: string[] } = {},
): string {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'SKILL.md');
  writeFileSync(
    p,
    `---
name: ${slug}
description: Test agent ${slug}.
purpose: Test purpose.
composition:
  skills: [${(c.skills ?? []).join(', ')}]
  tools: [${(c.tools ?? []).join(', ')}]
  mcps: [${(c.mcps ?? []).join(', ')}]
  guards: [${(c.guards ?? []).join(', ')}]
  hooks: [${(c.hooks ?? []).join(', ')}]
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
`,
    'utf8',
  );
  return p;
}

/** A plain skill package — a SKILL.md with no `runtime:`, so never an agent. */
function writePlainSkill(root: string, id: string): string {
  const dir = join(root, 'skills', id);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'SKILL.md');
  writeFileSync(p, `---\nname: ${id}\ndescription: A plain skill.\n---\n\nBody.\n`, 'utf8');
  return p;
}

function indexFromCompositions(root: string, kind: ComposableKind): Map<string, string[]> {
  const collected = new Map<string, Set<string>>();
  for (const agent of libraryAgentFacts.compositions(root)) {
    const ids =
      kind === 'skill'
        ? agent.composition.skills
        : kind === 'hook'
          ? agent.composition.hooks
          : [...agent.composition.tools, ...agent.composition.mcps];
    for (const id of new Set(ids)) {
      if (!collected.has(id)) collected.set(id, new Set());
      collected.get(id)!.add(agent.slug);
    }
  }
  const out = new Map<string, string[]>();
  for (const [id, slugs] of collected) out.set(id, [...slugs].sort((a, b) => a.localeCompare(b)));
  return out;
}

function sameMap(a: ReadonlyMap<string, readonly string[]>, b: ReadonlyMap<string, readonly string[]>): string | null {
  if (a.size !== b.size) return `sizes differ: ${a.size} vs ${b.size}`;
  for (const [k, v] of a) {
    const other = b.get(k);
    if (other === undefined) return `missing id ${k}`;
    if (v.join(',') !== other.join(',')) return `id ${k}: [${v}] vs [${other}]`;
  }
  return null;
}

describe('the two roster walks agree', () => {
  it('an index derived from `compositions` equals `agentUsageIndex`, malformed sibling included', () => {
    const root = makeRoot();
    writeAgent(root, 'zeta', { skills: ['brain-query'], hooks: ['pre-commit'], tools: ['git'] });
    writeAgent(root, 'alpha', { skills: ['brain-query', 'brain-query'], mcps: ['memory'] });
    writeAgent(root, 'beta', { skills: [], hooks: ['pre-commit'] });
    writePlainSkill(root, 'brain-query');
    // A studio agent whose frontmatter does not parse. Both walks must SKIP it
    // rather than throw, and both must leave it out of `scanned`.
    mkdirSync(join(root, 'skills', 'broken'), { recursive: true });
    writeFileSync(join(root, 'skills', 'broken', 'SKILL.md'), `---\nname: [unclosed\nruntime:\n---\n`, 'utf8');

    for (const kind of KINDS) {
      const fromIndex = libraryAgentFacts.usage(kind, root).byId;
      assert.equal(sameMap(fromIndex, indexFromCompositions(root, kind)), null, `${kind} derivations drifted`);
    }
    assert.equal(libraryAgentFacts.usage('skill', root).scanned, 3, 'scanned counts the agents that LOADED');
    assert.equal(libraryAgentFacts.compositions(root).length, 3);
  });

  it('they agree on the REAL skills/ tree too — shapes no fixture would plant', () => {
    for (const kind of KINDS) {
      assert.equal(
        sameMap(libraryAgentFacts.usage(kind, FORGE_ROOT).byId, indexFromCompositions(FORGE_ROOT, kind)),
        null,
        `${kind} derivations drifted on the real roster`,
      );
    }
  });

  it('the agreement is not vacuous — the real roster was walked, and composes skills and connections', () => {
    // Two empty maps compare equal, so the real-tree test above would pass on a
    // roster nobody could read. Every kind must therefore show a non-zero
    // `scanned`, and the kinds the shipped roster actually composes must show
    // ids.
    //
    // `hook` is deliberately NOT in the second list, and the reason is a finding
    // rather than a tolerance: measured on this tree, NO shipped agent composes
    // a library hook (skill 6 ids, connection 2, hook 0, all across 11 agents).
    // Asserting hook ids here would fail on a true statement about the repo;
    // asserting nothing would hide the day that changes. So the count is pinned
    // at its honest value and named. `packages/agents/tests/unit/agent-usage.test.ts`
    // reached the same wall and made the same split.
    for (const kind of KINDS) {
      assert.ok(libraryAgentFacts.usage(kind, FORGE_ROOT).scanned > 0, `no agent was scanned for ${kind}`);
    }
    for (const kind of ['skill', 'connection'] as const) {
      assert.ok(libraryAgentFacts.usage(kind, FORGE_ROOT).byId.size > 0, `the real roster composes no ${kind}`);
    }
    assert.equal(
      libraryAgentFacts.usage('hook', FORGE_ROOT).byId.size,
      0,
      'a shipped agent now composes a library hook — widen the list above, this is no longer a finding',
    );
    assert.ok(libraryAgentFacts.compositions(FORGE_ROOT).length > 0);
  });
});

describe('`usage` is the provider ruling 73 named', () => {
  it('it IS `agentUsageIndex` — same answer, same scanned', () => {
    const root = makeRoot();
    writeAgent(root, 'alpha', { hooks: ['pre-commit'] });
    for (const kind of KINDS) {
      const mine = libraryAgentFacts.usage(kind, root);
      const theirs = agentUsageIndex(kind, root);
      assert.equal(sameMap(mine.byId, theirs.byId), null);
      assert.equal(mine.scanned, theirs.scanned);
    }
  });

  it('an empty roster answers empty rather than throwing', () => {
    const root = makeRoot();
    assert.deepEqual([...libraryAgentFacts.usage('skill', root).byId], []);
    assert.equal(libraryAgentFacts.usage('skill', root).scanned, 0);
    assert.deepEqual(libraryAgentFacts.compositions(root), []);
  });
});

describe('`isAgentSkillMd` is the agent-kind predicate, not a shape guess', () => {
  it('true for a studio agent, false for a plain skill — same answer as `isStudioAgent`', () => {
    const root = makeRoot();
    const agentMd = writeAgent(root, 'alpha');
    const plainMd = writePlainSkill(root, 'brain-query');

    assert.equal(libraryAgentFacts.isAgentSkillMd(agentMd), true);
    assert.equal(libraryAgentFacts.isAgentSkillMd(plainMd), false);
    assert.equal(libraryAgentFacts.isAgentSkillMd(agentMd), isStudioAgent(agentMd));
    assert.equal(libraryAgentFacts.isAgentSkillMd(plainMd), isStudioAgent(plainMd));
  });

  it('false for a path that does not exist', () => {
    const root = makeRoot();
    assert.equal(libraryAgentFacts.isAgentSkillMd(join(root, 'skills', 'nope', 'SKILL.md')), false);
  });
});
