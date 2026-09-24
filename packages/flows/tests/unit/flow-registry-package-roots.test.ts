/**
 * SEAM F1 (operator ruling, item 81) at the Flow kind's own resolver:
 * `listFlowIds` (packages/flows/studio/flow-registry.ts) and `flowPathForId`
 * (packages/flows/flow-runner.ts) must search every flow root
 * (`@forge/kernel`'s `flowRoots`) — `studio/flows/` AND every
 * `packages/<pkg>/flows/` — not just the hardcoded `studio/flows/` root.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listFlowIds, loadFlowDefinition } from '../../studio/flow-registry.ts';
import { flowPathForId } from '../../flow-runner.ts';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'flow-registry-package-roots-'));
}

/** Minimal valid flow.yaml (satisfies loadFlowDefinition's required fields). */
function makeFlowYaml(id: string): string {
  return [
    `id: ${id}`,
    `name: ${id}`,
    'version: 1',
    'goal: g',
    'project: null',
    'kb: null',
    'costCeilingUsd: 2',
    'origin: studio',
    'nodes:',
    '  - id: n',
    '    gate: human',
    'edges: []',
    'triggers: []',
  ].join('\n');
}

function withFixtureRoot(build: (root: string) => void, run: (root: string) => void): void {
  const root = tmpRoot();
  try {
    build(root);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** studio/flows/a + packages/demo-pkg/flows/b — the fixture shared by the
 *  run-door and write-refusal acceptance tests (apps/forge). */
function seedTwoRootFixture(root: string): void {
  mkdirSync(join(root, 'studio', 'flows', 'a'), { recursive: true });
  writeFileSync(join(root, 'studio', 'flows', 'a', 'flow.yaml'), makeFlowYaml('a'), 'utf8');
  mkdirSync(join(root, 'packages', 'demo-pkg', 'flows', 'b'), { recursive: true });
  writeFileSync(join(root, 'packages', 'demo-pkg', 'flows', 'b', 'flow.yaml'), makeFlowYaml('b'), 'utf8');
}

describe('listFlowIds — package roots', () => {
  it('lists a flow from studio/flows AND a flow from a package flows/ dir', () => {
    withFixtureRoot(seedTwoRootFixture, (root) => {
      assert.deepEqual(listFlowIds(root), ['a', 'b']);
    });
  });

  it('THROWS naming both roots when the same flow id is a real directory under two roots', () => {
    withFixtureRoot(
      (root) => {
        mkdirSync(join(root, 'studio', 'flows', 'dup'), { recursive: true });
        mkdirSync(join(root, 'packages', 'demo-pkg', 'flows', 'dup'), { recursive: true });
      },
      (root) => {
        assert.throws(
          () => listFlowIds(root),
          (err: Error) =>
            err.message.includes(join(root, 'studio', 'flows')) &&
            err.message.includes(join(root, 'packages', 'demo-pkg', 'flows')),
        );
      },
    );
  });
});

describe('flowPathForId — package roots', () => {
  it('resolves a package-owned flow id to its package path', () => {
    withFixtureRoot(seedTwoRootFixture, (root) => {
      assert.equal(
        flowPathForId('b', root),
        join(root, 'packages', 'demo-pkg', 'flows', 'b', 'flow.yaml'),
      );
      // And it loads: the resolver found the real file, not a dead end.
      const flow = loadFlowDefinition(flowPathForId('b', root));
      assert.equal(flow.id, 'b');
    });
  });

  it('still resolves a studio-owned flow id to its studio path', () => {
    withFixtureRoot(seedTwoRootFixture, (root) => {
      assert.equal(flowPathForId('a', root), join(root, 'studio', 'flows', 'a', 'flow.yaml'));
    });
  });

  it('falls back to the studio/flows path for an unknown id (unchanged pre-seam behavior)', () => {
    withFixtureRoot(seedTwoRootFixture, (root) => {
      assert.equal(flowPathForId('missing', root), join(root, 'studio', 'flows', 'missing', 'flow.yaml'));
    });
  });

  it('THROWS naming both paths when a flow id resolves under two roots', () => {
    withFixtureRoot(
      (root) => {
        mkdirSync(join(root, 'studio', 'flows', 'dup'), { recursive: true });
        writeFileSync(join(root, 'studio', 'flows', 'dup', 'flow.yaml'), makeFlowYaml('dup'), 'utf8');
        mkdirSync(join(root, 'packages', 'demo-pkg', 'flows', 'dup'), { recursive: true });
        writeFileSync(join(root, 'packages', 'demo-pkg', 'flows', 'dup', 'flow.yaml'), makeFlowYaml('dup'), 'utf8');
      },
      (root) => {
        assert.throws(
          () => flowPathForId('dup', root),
          (err: Error) =>
            err.message.includes(join(root, 'studio', 'flows', 'dup', 'flow.yaml')) &&
            err.message.includes(join(root, 'packages', 'demo-pkg', 'flows', 'dup', 'flow.yaml')),
        );
      },
    );
  });
});
