/**
 * The reverse index: which agents compose a given skill, hook or connection
 * (ruling 13's `agentsUsing`, shaped as an index per ruling 73).
 *
 * WHY THIS EXISTS. Three library modules — `studio/hook-library.ts`,
 * `studio/connection-library.ts`, `studio/skill-trust.ts` — each carry a
 * PRIVATE copy of "walk the agent roster and count who composes what". Library
 * is rank 2 and agents is rank 3, so library reading agent files at all is the
 * thing ruling 13 forbids: the answer has to come from the package that owns
 * agents, injected at assembly.
 *
 * THESE TESTS COPY LIBRARY'S BEHAVIOUR ON PURPOSE, INCLUDING ITS ROUGH EDGES.
 * Library s3 (wave 4) will replace its three copies with this one and prove
 * the answers identical before and after. Anything "improved" here fails that
 * parity test on MY account rather than its own, so three behaviours are
 * pinned exactly as library has them:
 *
 *  - a malformed agent is SKIPPED, never fatal — "a single bad sibling must
 *    not crash the whole scan";
 *  - `scanned` counts the agents successfully LOADED, after that filter, not
 *    the directories walked. Off by one here and every `derivation.scanned`
 *    figure in the UI shifts;
 *  - a connection is `composition.tools` ∪ `composition.mcps`, not a field of
 *    its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { agentUsageIndex, agentsUsing } from './agent-usage.ts';

type Composition = { skills?: string[]; tools?: string[]; mcps?: string[]; hooks?: string[] };

/** Write a well-formed studio agent under `<root>/skills/<slug>/SKILL.md`. */
function plantAgent(root: string, slug: string, composition: Composition = {}): void {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const comp = {
    skills: composition.skills ?? [],
    tools: composition.tools ?? [],
    mcps: composition.mcps ?? [],
    hooks: composition.hooks ?? [],
    guards: [],
  };
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---
name: ${slug}
description: Agent ${slug}.
purpose: Usage-index fixture.
brainAccess: none
interactivity: Fully autonomous.
runtime:
  sdk: claude
  strategy: fixed
composition:
  skills: [${comp.skills.join(', ')}]
  tools: [${comp.tools.join(', ')}]
  mcps: [${comp.mcps.join(', ')}]
  hooks: [${comp.hooks.join(', ')}]
  guards: []
---

Body.
`,
  );
}

/** A SKILL.md with a `runtime:` block (so it IS a studio agent) that fails to load. */
function plantMalformedAgent(root: string, slug: string): void {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  // `runtime` present so `isStudioAgent` admits it; `purpose` missing so
  // `loadAgentDefinition` throws. That is the real shape of a bad sibling.
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---
name: ${slug}
description: Broken.
runtime:
  sdk: claude
  strategy: fixed
---

Body.
`,
  );
}

function withRoot<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'agent-usage-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Positive and negative, for each kind.
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: an agent composing skill X appears under X, and is counted', () =>
  withRoot((root) => {
    plantAgent(root, 'alpha', { skills: ['brain-query'] });
    plantAgent(root, 'beta', { skills: ['brain-query', 'other-skill'] });
    const idx = agentUsageIndex('skill', root);
    assert.deepEqual(idx.byId.get('brain-query'), ['alpha', 'beta']);
    assert.deepEqual(idx.byId.get('other-skill'), ['beta']);
    assert.equal(idx.scanned, 2);
  }));

test('NEGATIVE CONTROL: an agent composing nothing is absent from every id, but IS scanned', () =>
  withRoot((root) => {
    plantAgent(root, 'alpha', { skills: ['brain-query'] });
    plantAgent(root, 'idle', {});
    const idx = agentUsageIndex('skill', root);
    assert.deepEqual(idx.byId.get('brain-query'), ['alpha']);
    assert.ok(
      ![...idx.byId.values()].some((slugs) => slugs.includes('idle')),
      'an agent that composes nothing must not appear under any id',
    );
    assert.equal(idx.scanned, 2, 'scanned counts every well-formed agent, not only the ones that matched');
  }));

test('a hook index reads composition.hooks', () =>
  withRoot((root) => {
    plantAgent(root, 'alpha', { hooks: ['pre-commit'] });
    plantAgent(root, 'beta', { skills: ['pre-commit'] }); // same id, WRONG field
    const idx = agentUsageIndex('hook', root);
    assert.deepEqual(idx.byId.get('pre-commit'), ['alpha'], 'a skill id must not leak into the hook index');
  }));

test('a connection index is tools UNION mcps — not a field of its own', () =>
  withRoot((root) => {
    plantAgent(root, 'alpha', { tools: ['github'] });
    plantAgent(root, 'beta', { mcps: ['github'] });
    plantAgent(root, 'gamma', { tools: ['github'], mcps: ['github'] });
    const idx = agentUsageIndex('connection', root);
    assert.deepEqual(
      idx.byId.get('github'),
      ['alpha', 'beta', 'gamma'],
      'an agent naming the same connection in BOTH tools and mcps is listed once',
    );
  }));

// ---------------------------------------------------------------------------
// The edges copied from library rather than improved.
// ---------------------------------------------------------------------------

test('a malformed agent is SKIPPED, its healthy siblings still found, and it is NOT counted', () =>
  withRoot((root) => {
    plantAgent(root, 'alpha', { skills: ['brain-query'] });
    plantMalformedAgent(root, 'broken');
    plantAgent(root, 'beta', { skills: ['brain-query'] });
    const idx = agentUsageIndex('skill', root);
    assert.deepEqual(idx.byId.get('brain-query'), ['alpha', 'beta'], 'one bad sibling must not crash the scan');
    assert.equal(idx.scanned, 2, '`scanned` counts agents LOADED, after the filter — library reports it the same way');
  }));

test('slugs are sorted and de-duplicated within one agent', () =>
  withRoot((root) => {
    plantAgent(root, 'zeta', { skills: ['s', 's'] });
    plantAgent(root, 'alpha', { skills: ['s'] });
    assert.deepEqual(agentUsageIndex('skill', root).byId.get('s'), ['alpha', 'zeta']);
  }));

test('a root with no skills directory yields an empty index rather than throwing', () =>
  withRoot((root) => {
    const idx = agentUsageIndex('skill', root);
    assert.equal(idx.byId.size, 0);
    assert.equal(idx.scanned, 0);
  }));

test('a non-agent SKILL.md (no runtime block) is not scanned at all', () =>
  withRoot((root) => {
    const dir = join(root, 'skills', 'plain-skill');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: plain-skill\ndescription: A plain skill.\n---\n\nBody.\n');
    plantAgent(root, 'alpha', { skills: ['plain-skill'] });
    const idx = agentUsageIndex('skill', root);
    assert.equal(idx.scanned, 1, 'a library skill is not an agent');
    assert.deepEqual(idx.byId.get('plain-skill'), ['alpha']);
  }));

// ---------------------------------------------------------------------------
// Ruling 13's named export, over the same index.
// ---------------------------------------------------------------------------

test('agentsUsing answers one id over the same index', () =>
  withRoot((root) => {
    plantAgent(root, 'alpha', { hooks: ['pre-commit'] });
    plantAgent(root, 'beta', {});
    assert.deepEqual(agentsUsing('hook', 'pre-commit', root), ['alpha']);
    assert.deepEqual(agentsUsing('hook', 'never-composed', root), [], 'an unused id answers [], never undefined');
  }));

// ---------------------------------------------------------------------------
// PARITY WITH THE THREE COPIES THIS REPLACES — on the REAL roster.
//
// The tests above pin behaviour against planted fixtures. This one pins the
// only thing library s3 actually needs: that swapping its private walks for
// this index changes NO answer. Run against the real `skills/` tree, so it
// covers shapes no fixture would think to plant, and it fails the moment the
// two derivations drift — whichever side moves.
//
// Importing library from agents is legal (agents is rank 3, library rank 2)
// and mints no boundary row.
// ---------------------------------------------------------------------------
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import { deriveHookUsage } from '@forge/library/studio/hook-library.ts';
import { deriveConnectionUsage } from '@forge/library/studio/connection-library.ts';

function sameMap(a: Map<string, string[]>, b: Map<string, string[]>): string | null {
  if (a.size !== b.size) return `sizes differ: ${a.size} vs ${b.size}`;
  for (const [k, v] of a) {
    const other = b.get(k);
    if (other === undefined) return `missing id ${k}`;
    if (v.join(',') !== other.join(',')) return `id ${k}: [${v}] vs [${other}]`;
  }
  return null;
}

test('PARITY: the hook index equals library deriveHookUsage on the real roster', () => {
  const mine = agentUsageIndex('hook', FORGE_ROOT).byId;
  const theirs = deriveHookUsage(FORGE_ROOT);
  assert.equal(sameMap(mine, theirs), null, 'the hook derivation drifted from library\'s');
});

test('PARITY: the connection index equals library deriveConnectionUsage on the real roster', () => {
  const mine = agentUsageIndex('connection', FORGE_ROOT).byId;
  const theirs = deriveConnectionUsage(FORGE_ROOT);
  assert.equal(sameMap(mine, theirs), null, 'the connection derivation drifted from library\'s');
});

test('PARITY: the index is not vacuously equal — the real roster composes something', () => {
  // Two empty maps compare equal. If the roster ever stops carrying hooks or
  // connections, the parity tests above would pass while proving nothing.
  const hooks = agentUsageIndex('hook', FORGE_ROOT);
  const skills = agentUsageIndex('skill', FORGE_ROOT);
  assert.ok(hooks.scanned > 0, `the real roster scanned ${hooks.scanned} agents`);
  assert.ok(skills.byId.size > 0, 'the real roster composes at least one skill');
});
