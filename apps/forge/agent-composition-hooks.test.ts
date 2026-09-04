/**
 * The AGENT loader's handling of `composition.hooks` (R3-03 F1b).
 *
 * MOVED HERE from `packages/library/studio/hook-library.test.ts` by M4-library
 * s3. Its subject is `loadAgentDefinition` — the Agent kind's loader, owned by
 * `@forge/agents` — not anything in library, and library (rank 2) may not
 * import agents (rank 3), so the file it lived in carried a boundary row for a
 * test that was never about library. Ruling 89's shape: a test whose subject
 * is another package's belongs flat at the assembly, where importing any
 * package is what the assembly is for. The three cases and their assertions
 * are byte-identical to the ones deleted there; only the loader's import path
 * changed, from the retired `orchestrator/studio/registry.ts` re-export hub to
 * the module that defines it.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadAgentDefinition } from '@forge/agents/studio/agent-registry.ts';

const createdDirs: string[] = [];
after(() => { for (const d of createdDirs) rmSync(d, { recursive: true, force: true }); });

function makeForgeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-library-'));
  createdDirs.push(dir);
  return dir;
}

function writeAgentSkillMd(
  root: string,
  slug: string,
  composition: { skills?: string[]; tools?: string[]; mcps?: string[]; guards?: string[]; hooks?: string[] } = {},
): string {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const compositionYaml = [
    `  skills: [${(composition.skills ?? []).join(', ')}]`,
    `  tools: [${(composition.tools ?? []).join(', ')}]`,
    `  mcps: [${(composition.mcps ?? []).join(', ')}]`,
    `  guards: [${(composition.guards ?? []).join(', ')}]`,
    ...(composition.hooks !== undefined ? [`  hooks: [${composition.hooks.join(', ')}]`] : []),
  ].join('\n');
  const content = `---
name: ${slug}
description: Test agent ${slug}.
purpose: Test purpose.
composition:
${compositionYaml}
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
  const p = join(dir, 'SKILL.md');
  writeFileSync(p, content, 'utf8');
  return p;
}

// ---------------------------------------------------------------------------
// F1b — composition.hooks REINTRODUCED at the registry layer
// ---------------------------------------------------------------------------

describe('composition.hooks reintroduced (loadAgentDefinition)', () => {
  it('a SKILL.md declaring composition.hooks no longer throws the "retired" error', () => {
    const root = makeForgeRoot();
    const p = writeAgentSkillMd(root, 'hook-composer', { hooks: ['pre-pr-security-review'] });
    assert.doesNotThrow(() => loadAgentDefinition(p));
  });

  it('the parsed composition.hooks array round-trips (cast documented in D-E)', () => {
    const root = makeForgeRoot();
    const p = writeAgentSkillMd(root, 'hook-composer-2', { hooks: ['pre-pr-security-review', 'post-merge-brain-ingest'] });
    const def = loadAgentDefinition(p);
    const hooks = (def.composition as unknown as { hooks: string[] }).hooks;
    assert.deepEqual(hooks, ['pre-pr-security-review', 'post-merge-brain-ingest']);
  });

  it('composition.hooks absent parses as an empty array, not undefined', () => {
    const root = makeForgeRoot();
    const p = writeAgentSkillMd(root, 'no-hooks-agent', {});
    const def = loadAgentDefinition(p);
    const hooks = (def.composition as unknown as { hooks?: string[] }).hooks;
    assert.deepEqual(hooks ?? [], []);
  });
});

