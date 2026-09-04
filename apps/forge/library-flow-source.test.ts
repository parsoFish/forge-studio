/**
 * The assembly's `FlowSource` binding — proven against the real Flow loader.
 *
 * Library's own tests supply this port from `tests/test-fixtures/flow-fixture.ts`,
 * because library (rank 2) may not import `@forge/flows` (rank 5) even in a
 * test. That leaves one thing unproven on that side: whether the REAL loader
 * answers what those fixtures assume. This file is that proof, and it is the
 * only place both halves are importable.
 *
 * The fixture parses only the fields `buildFlowEdgeIndex` consumes, so the
 * claim under test is deliberately narrow and exact: **for a well-formed flow,
 * the two agree on every field the index reads.** Where they differ is also
 * asserted, because it is the reason the fixture is not the real thing — the
 * real loader VALIDATES and throws where the fixture would hand back a shape.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { listFlowIds, loadFlowDefinition } from '@forge/flows/studio/flow-registry.ts';
import { fixtureFlowSource } from '@forge/library/tests/test-fixtures/flow-fixture.ts';

import { libraryFlowSource } from './library-flow-source.ts';

const createdDirs: string[] = [];
after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'library-flow-source-'));
  createdDirs.push(dir);
  return dir;
}

function writeFlow(root: string, id: string): string {
  const dir = join(root, 'studio', 'flows', id);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'flow.yaml');
  writeFileSync(
    p,
    `id: ${id}
name: Test Flow
version: 1
goal: Test.
project: null
kb: null
costCeilingUsd: 10
origin: seed
nodes:
  - id: plan
    agent: architect
  - id: build
    agent: developer-ralph
edges:
  - from: plan
    to: build
    artifact: work-items
`,
    'utf8',
  );
  return p;
}

describe('the assembly binding IS the real Flow loader', () => {
  it('binds the two functions the port names, not lookalikes', () => {
    assert.equal(libraryFlowSource.listFlowIds, listFlowIds);
    assert.equal(libraryFlowSource.loadFlowDefinition, loadFlowDefinition);
  });

  it('agrees with the library fixture on every field the edge index reads', () => {
    const root = makeRoot();
    writeFlow(root, 'zeta');
    writeFlow(root, 'alpha');

    assert.deepEqual([...libraryFlowSource.listFlowIds(root)], [...fixtureFlowSource.listFlowIds(root)]);
    assert.deepEqual([...libraryFlowSource.listFlowIds(root)], ['alpha', 'zeta'], 'and the order is the one the index walks');

    for (const id of libraryFlowSource.listFlowIds(root)) {
      const p = join(root, 'studio', 'flows', id, 'flow.yaml');
      const real = libraryFlowSource.loadFlowDefinition(p);
      const fixture = fixtureFlowSource.loadFlowDefinition(p);
      assert.deepEqual(
        real.nodes.map((n) => ({ id: n.id, agent: n.agent })),
        fixture.nodes.map((n) => ({ id: n.id, agent: n.agent })),
        `${id}: nodes disagree`,
      );
      assert.deepEqual(
        real.edges.map((e) => ({ from: e.from, to: e.to, artifact: e.artifact })),
        fixture.edges.map((e) => ({ from: e.from, to: e.to, artifact: e.artifact })),
        `${id}: edges disagree`,
      );
    }
  });

  it('an empty tree lists nothing rather than throwing — both sides', () => {
    const root = makeRoot();
    assert.deepEqual([...libraryFlowSource.listFlowIds(root)], []);
    assert.deepEqual([...fixtureFlowSource.listFlowIds(root)], []);
  });

  it('the real loader VALIDATES where the fixture only parses — which is why the fixture is not the real thing', () => {
    const root = makeRoot();
    const dir = join(root, 'studio', 'flows', 'broken');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'flow.yaml');
    writeFileSync(p, 'id: broken\nname: Broken\n', 'utf8'); // no version/nodes/edges

    assert.throws(() => libraryFlowSource.loadFlowDefinition(p), 'the real loader must reject a flow with no nodes/edges');
    // The fixture hands the shape back unvalidated. `buildFlowEdgeIndex` wraps
    // every load in try/catch and skips on throw, so the REAL behaviour on a
    // malformed flow is "skipped"; the fixture reaching this line is the
    // documented divergence, not a defect the index can observe.
    assert.doesNotThrow(() => fixtureFlowSource.loadFlowDefinition(p));
  });
});
