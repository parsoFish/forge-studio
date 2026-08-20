/**
 * W7-B4 (flows-09, lint half) — the starter flow must be SAVEABLE by
 * construction: every node agent in studio/starters/flows/basic.yaml must
 * resolve in skills/ OR studio/starters/agents/ (the closed set the flow PUT
 * materialises from). A starter canvas referencing an agent in neither place
 * is the filed defect — an unsaveable seeded canvas — and must fail
 * `forge studio lint`.
 *
 * Pinned RED at branch base: runStudioLint has no starter-flow check yet.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runStudioLint } from './studio-lint.ts';

const REAL_ROOT = process.cwd();
const CHECK = 'starter-flow/agent-unresolvable';

function scaffoldRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-starter-flow-'));
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(root, 'studio', 'starters', 'flows'), { recursive: true });
  mkdirSync(join(root, 'studio', 'starters', 'agents'), { recursive: true });
  cpSync(join(REAL_ROOT, 'studio', 'catalog.yaml'), join(root, 'studio', 'catalog.yaml'));
  return root;
}

test('a starter flow naming an agent that resolves NOWHERE is a lint error', () => {
  const root = scaffoldRoot();
  try {
    writeFileSync(
      join(root, 'studio', 'starters', 'flows', 'basic.yaml'),
      [
        'id: basic',
        'name: Basic Flow',
        'version: 1',
        'goal: g',
        'project: null',
        'kb: null',
        'costCeilingUsd: 5',
        'origin: starter',
        'nodes:',
        '  - { id: ghost, agent: agent-that-exists-nowhere }',
        'edges: []',
        'triggers: []',
        '',
      ].join('\n'),
      'utf8',
    );
    const result = runStudioLint(root);
    const hits = result.findings.filter((f) => f.check === CHECK && f.level === 'error');
    assert.equal(hits.length, 1, `expected one ${CHECK} error, got: ${JSON.stringify(hits)}`);
    assert.match(hits[0].message, /agent-that-exists-nowhere/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a starter-agent-backed node is resolvable (no finding) — the materialisation set covers it', () => {
  const root = scaffoldRoot();
  try {
    // node agent lives ONLY under studio/starters/agents/ — resolvable by
    // the flow PUT's materialisation, so lint must stay clean.
    // A starter agent is a real AgentDefinition (runtime block — the same
    // shape studio/starters/agents/{plan,dev,review} ship with).
    mkdirSync(join(root, 'studio', 'starters', 'agents', 'planner'), { recursive: true });
    writeFileSync(
      join(root, 'studio', 'starters', 'agents', 'planner', 'SKILL.md'),
      [
        '---',
        'name: Planner',
        'description: d',
        'purpose: p',
        'composition:',
        '  skills: []',
        '  tools: []',
        '  mcps: []',
        '  guards: [event-log]',
        'runtime:',
        '  sdk: claude',
        '  strategy: fixed',
        '  model: claude-sonnet-4-6',
        'brainAccess: none',
        'interactivity: autonomous',
        'budgets: {}',
        '---',
        '',
        '# Planner',
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(root, 'studio', 'starters', 'flows', 'basic.yaml'),
      [
        'id: basic',
        'name: Basic Flow',
        'version: 1',
        'goal: g',
        'project: null',
        'kb: null',
        'costCeilingUsd: 5',
        'origin: starter',
        'nodes:',
        '  - { id: p, agent: planner }',
        'edges: []',
        'triggers: []',
        '',
      ].join('\n'),
      'utf8',
    );
    const result = runStudioLint(root);
    assert.equal(result.findings.filter((f) => f.check === CHECK).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the SHIPPED starter flow resolves against the shipped tree (repo-root acceptance)', () => {
  const result = runStudioLint(REAL_ROOT);
  const hits = result.findings.filter((f) => f.check === CHECK);
  assert.equal(hits.length, 0, JSON.stringify(hits));
});
