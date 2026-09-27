/**
 * The demo-run driver's ground readiness (forge-1rk5.3 row 132): a provisioned fixture gets the operator's
 * install step, and the declared quality gate must run green at HEAD in the initiative worktree before any
 * hand-off — a red baseline is caught free, not minutes into a funded develop run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDeclaredGateAtHead } from './d12-demo-runs-ground.mjs';

function project(testScript: string, localCmd: string[] | null) {
  const root = mkdtempSync(join(tmpdir(), 'd12-ground-'));
  const repo = join(root, 'repo');
  const wt = join(root, 'wt');
  for (const d of [repo, wt]) {
    mkdirSync(join(d, '.forge'), { recursive: true });
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: testScript } }));
  }
  const cfg = localCmd ? { testProcess: { local: { cmd: localCmd } } } : {};
  writeFileSync(join(repo, '.forge', 'project.json'), JSON.stringify(cfg));
  return { root, repo, wt };
}

test('runDeclaredGateAtHead: a green declared gate in the worktree is ok, naming the command', () => {
  const p = project('node -e "process.exit(0)"', ['npm', 'test']);
  try {
    const r = runDeclaredGateAtHead(p.repo, p.wt);
    assert.equal(r.ok, true, r.detail);
    assert.match(r.detail, /npm test/);
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test('runDeclaredGateAtHead: a red declared gate is not ok and carries the exit and output tail', () => {
  const p = project('node -e "console.error(\'boom\'); process.exit(3)"', ['npm', 'test']);
  try {
    const r = runDeclaredGateAtHead(p.repo, p.wt);
    assert.equal(r.ok, false);
    assert.match(r.detail, /exit 3/);
    assert.match(r.detail, /boom/);
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test('runDeclaredGateAtHead: no declared gate is not ok — a baseline nothing can check is never green', () => {
  const p = project('node -e "process.exit(0)"', null);
  try {
    const r = runDeclaredGateAtHead(p.repo, p.wt);
    assert.equal(r.ok, false);
    assert.match(r.detail, /testProcess/);
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});
