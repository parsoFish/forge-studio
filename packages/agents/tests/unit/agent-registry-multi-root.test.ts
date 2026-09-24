/**
 * SEAM F1 (operator ruling, item 81): `listAgentDefinitions` accepts several
 * skill roots (`@forge/kernel`'s `skillRoots`) so a package-owned
 * `packages/<pkg>/skills/<slug>/SKILL.md` appears in the agent roster
 * alongside `skills/<slug>/SKILL.md` — with no registration code.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listAgentDefinitions } from '../../studio/agent-registry.ts';
import { skillRoots } from '@forge/kernel/discovery-roots.ts';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'agent-registry-multi-root-'));
}

/** Minimal studio-agent SKILL.md (satisfies validateAgentDocument's required fields). */
function makeAgentSkillMd(name: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: Minimal agent "${name}" for the multi-root test.`,
    'phase: architect',
    'purpose: Run tests.',
    'brainAccess: none',
    'interactivity: none',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  guards: [event-log]',
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    'allowed-tools: []',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    'Test agent process body.',
  ].join('\n');
}

function writeAgent(dir: string, slug: string): void {
  mkdirSync(join(dir, slug), { recursive: true });
  writeFileSync(join(dir, slug, 'SKILL.md'), makeAgentSkillMd(slug), 'utf8');
}

describe('listAgentDefinitions — package skill roots', () => {
  it('unions an operator skill and a package-owned skill into one roster', () => {
    const root = tmpRoot();
    try {
      writeAgent(join(root, 'skills'), 'operator-agent');
      writeAgent(join(root, 'packages', 'demo-pkg', 'skills'), 'x');

      const slugs = listAgentDefinitions(skillRoots(root)).map((a) => a.slug).sort();
      assert.deepEqual(slugs, ['operator-agent', 'x']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still accepts a single directory string (the historical call shape)', () => {
    const root = tmpRoot();
    try {
      writeAgent(join(root, 'skills'), 'solo-agent');
      const slugs = listAgentDefinitions(join(root, 'skills')).map((a) => a.slug);
      assert.deepEqual(slugs, ['solo-agent']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('THROWS, naming both roots, when the same slug is a real agent under two roots', () => {
    const root = tmpRoot();
    try {
      writeAgent(join(root, 'skills'), 'dup');
      writeAgent(join(root, 'packages', 'demo-pkg', 'skills'), 'dup');

      assert.throws(
        () => listAgentDefinitions(skillRoots(root)),
        (err: Error) =>
          err.message.includes(join(root, 'skills', 'dup')) &&
          err.message.includes(join(root, 'packages', 'demo-pkg', 'skills', 'dup')),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
