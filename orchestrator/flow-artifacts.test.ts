import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  resolveRequiredFile,
  assertInboundArtifacts,
  writeVerdictJson,
  verdictJsonPath,
  type ArtifactContract,
  type ArtifactGuardInput,
} from './flow-artifacts.ts';
import type { FlowDefinition } from './studio/types.ts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'flow-artifacts-'));
}

// Minimal flow: pm consumes `plan`, dev consumes `work-items`, review consumes
// `pr`, unifier consumes `wi-branches` (git-state).
const FLOW: FlowDefinition = {
  id: 'forge-cycle',
  name: 'Forge Cycle',
  version: 1,
  goal: 'x',
  project: null,
  kb: null,
  costCeilingUsd: 30,
  origin: 'seed',
  nodes: [],
  edges: [
    { from: 'architect', to: 'pm', artifact: 'plan' },
    { from: 'pm', to: 'dev', artifact: 'work-items' },
    { from: 'dev', to: 'unifier', artifact: 'wi-branches' },
    { from: 'unifier', to: 'review', artifact: 'pr' },
  ],
  triggers: [],
  path: '/x/flow.yaml',
};

const TEMPLATES = new Map<string, ArtifactContract>([
  ['plan', { id: 'plan', kind: 'file', schema: { requiredFiles: ['_queue/in-flight/<initiative-id>.md'] } }],
  ['work-items', { id: 'work-items', kind: 'file', schema: { requiredFiles: ['.forge/work-items/'] } }],
  ['wi-branches', { id: 'wi-branches', kind: 'git-state', schema: { gitInvariants: ['commitsAhead>0'] } as never }],
  [
    'pr',
    {
      id: 'pr',
      kind: 'file',
      schema: { requiredFiles: ['.forge/pr-description.md', 'demo/<initiative-id>/demo.json'] },
    },
  ],
]);

function guardInput(root: string): ArtifactGuardInput {
  return {
    initiativeId: 'INIT-2026-06-16-x',
    manifestPath: join(root, '_queue', 'in-flight', 'INIT-2026-06-16-x.md'),
    worktreePath: join(root, 'wt'),
    cycleId: 'CY-1',
  };
}

test('resolveRequiredFile: plan artifact resolves to the manifest path itself', () => {
  const root = tmp();
  const input = guardInput(root);
  const got = resolveRequiredFile('_queue/in-flight/<initiative-id>.md', input, root);
  assert.equal(got, input.manifestPath);
  rmSync(root, { recursive: true, force: true });
});

test('resolveRequiredFile: worktree-rooted path substitutes <initiative-id>', () => {
  const root = tmp();
  const input = guardInput(root);
  const got = resolveRequiredFile('demo/<initiative-id>/demo.json', input, root);
  assert.equal(got, resolve(input.worktreePath, 'demo', 'INIT-2026-06-16-x', 'demo.json'));
  rmSync(root, { recursive: true, force: true });
});

test('resolveRequiredFile: demo path is artifactRoot-aware (default "." → demo/<id>)', () => {
  const root = tmp();
  const input = guardInput(root);
  // No .forge/project.json on the worktree ⇒ readArtifactRoot returns "." ⇒
  // the canonical legacy `demo/<id>` location is unchanged.
  const got = resolveRequiredFile('demo/<initiative-id>/demo.json', input, root);
  assert.equal(got, resolve(input.worktreePath, 'demo', 'INIT-2026-06-16-x', 'demo.json'));
  rmSync(root, { recursive: true, force: true });
});

test('resolveRequiredFile: demo path follows artifactRoot when the worktree declares one', () => {
  const root = tmp();
  const input = guardInput(root);
  // A worktree whose .forge/project.json sets artifactRoot: "forge" lands its
  // demo under forge/history/<id>/demo (NOT a parallel top-level demo/).
  mkdirSync(join(input.worktreePath, '.forge'), { recursive: true });
  writeFileSync(
    join(input.worktreePath, '.forge', 'project.json'),
    JSON.stringify({ artifactRoot: 'forge', demo: { shape: 'none' }, quality_gate_cmd: ['true'] }),
  );
  const got = resolveRequiredFile('demo/<initiative-id>/demo.json', input, root);
  assert.equal(
    got,
    resolve(input.worktreePath, 'forge', 'history', 'INIT-2026-06-16-x', 'demo', 'demo.json'),
  );
  rmSync(root, { recursive: true, force: true });
});

test('resolveRequiredFile: <cycleId> in _logs resolves to forge root; unbound → null', () => {
  const root = tmp();
  const input = guardInput(root);
  assert.equal(
    resolveRequiredFile('_logs/<cycleId>/artifacts/verdict.json', input, root),
    resolve(root, '_logs', 'CY-1', 'artifacts', 'verdict.json'),
  );
  assert.equal(resolveRequiredFile('_logs/<cycleId>/artifacts/verdict.json', { ...input, cycleId: undefined }, root), null);
  rmSync(root, { recursive: true, force: true });
});

test('assertInboundArtifacts: passes when the required file is present', () => {
  const root = tmp();
  const input = guardInput(root);
  mkdirSync(join(root, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(input.manifestPath, '# manifest');
  assert.doesNotThrow(() =>
    assertInboundArtifacts({ flow: FLOW, nodeId: 'pm', input, forgeRoot: root, templates: TEMPLATES }),
  );
  rmSync(root, { recursive: true, force: true });
});

test('assertInboundArtifacts: throws flow-runner.artifact-missing when absent', () => {
  const root = tmp();
  const input = guardInput(root);
  const seen: Array<{ artifact: string; required: string }> = [];
  assert.throws(
    () =>
      assertInboundArtifacts({
        flow: FLOW,
        nodeId: 'pm',
        input,
        forgeRoot: root,
        templates: TEMPLATES,
        onMissing: (d) => seen.push(d),
      }),
    /flow-runner\.artifact-missing/,
  );
  assert.equal(seen[0]?.artifact, 'plan');
  rmSync(root, { recursive: true, force: true });
});

test('assertInboundArtifacts: directory artifact must be non-empty', () => {
  const root = tmp();
  const input = guardInput(root);
  const wiDir = join(input.worktreePath, '.forge', 'work-items');
  mkdirSync(wiDir, { recursive: true });
  // empty dir → throws
  assert.throws(() => assertInboundArtifacts({ flow: FLOW, nodeId: 'dev', input, forgeRoot: root, templates: TEMPLATES }));
  // non-empty → passes
  writeFileSync(join(wiDir, 'WI-1.md'), '# wi');
  assert.doesNotThrow(() =>
    assertInboundArtifacts({ flow: FLOW, nodeId: 'dev', input, forgeRoot: root, templates: TEMPLATES }),
  );
  rmSync(root, { recursive: true, force: true });
});

test('assertInboundArtifacts: git-state artifact is skipped (no file check)', () => {
  const root = tmp();
  const input = guardInput(root);
  // unifier's inbound is wi-branches (git-state) — nothing on disk, must not throw.
  assert.doesNotThrow(() =>
    assertInboundArtifacts({ flow: FLOW, nodeId: 'unifier', input, forgeRoot: root, templates: TEMPLATES }),
  );
  rmSync(root, { recursive: true, force: true });
});

test('assertInboundArtifacts: a node with no inbound edges is a no-op', () => {
  const root = tmp();
  const input = guardInput(root);
  assert.doesNotThrow(() =>
    assertInboundArtifacts({ flow: FLOW, nodeId: 'architect', input, forgeRoot: root, templates: TEMPLATES }),
  );
  rmSync(root, { recursive: true, force: true });
});

test('writeVerdictJson: writes the record; overwrite:false keeps the first', () => {
  const root = tmp();
  const logsRoot = join(root, '_logs');
  const p1 = writeVerdictJson(logsRoot, {
    kind: 'approve',
    initiative_id: 'INIT-x',
    cycleId: 'CY-1',
    decidedBy: 'operator',
    rationale: 'lgtm',
    at: '2026-06-16T00:00:00.000Z',
  });
  assert.equal(p1, verdictJsonPath(logsRoot, 'CY-1'));
  assert.ok(existsSync(p1!));
  const rec = JSON.parse(readFileSync(p1!, 'utf8'));
  assert.equal(rec.kind, 'approve');
  assert.equal(rec.decidedBy, 'operator');

  // overwrite:false → skipped, original preserved
  const p2 = writeVerdictJson(
    logsRoot,
    { kind: 'approve', initiative_id: 'INIT-x', cycleId: 'CY-1', decidedBy: 'merge', at: '2026-06-16T01:00:00.000Z' },
    { overwrite: false },
  );
  assert.equal(p2, null);
  assert.equal(JSON.parse(readFileSync(p1!, 'utf8')).decidedBy, 'operator');
  rmSync(root, { recursive: true, force: true });
});
