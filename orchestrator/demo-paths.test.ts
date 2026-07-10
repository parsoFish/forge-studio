/**
 * demo-paths.ts — the demo-artifact path SSOT (refinement plan 2.5 / N3).
 *
 * The demo path was previously computed in MULTIPLE places (composed unifier
 * gate, PR-open prerequisite, unifier prompt, cycle snapshot, flow-artifact
 * guard, forge demo render/capture, UWI scope strings) and one divergence —
 * unifier wrote `forge/history/<id>/demo/demo.json`, a consumer looked at
 * `demo/<id>/demo.json` — false-failed pr-open after a clean delivery
 * (2026-07-05 producer/contract path-mismatch theme). Every producer/consumer
 * must resolve through this ONE module.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DEMO_JSON_BASENAME,
  DEMO_MD_BASENAME,
  projectDemoRelDir,
  worktreeDemoRelDir,
  worktreeDemoDir,
  worktreeDemoJsonPath,
  worktreeDemoJsonRelPath,
  worktreeDemoMdPath,
} from './demo-paths.ts';

const INIT = 'INIT-2026-07-01-new-api-pipelinesapproval';

function tmpWorktree(artifactRoot?: string): string {
  const wt = mkdtempSync(join(tmpdir(), 'forge-demo-paths-'));
  if (artifactRoot !== undefined) {
    mkdirSync(join(wt, '.forge'), { recursive: true });
    writeFileSync(join(wt, '.forge', 'project.json'), JSON.stringify({ artifactRoot }));
  }
  return wt;
}

// ---------------------------------------------------------------------------
// projectDemoRelDir (moved from brain-paths.ts — the raw rel-dir rule)
// ---------------------------------------------------------------------------

test('projectDemoRelDir: default artifactRoot "." → legacy demo/<initiativeId>', () => {
  assert.equal(projectDemoRelDir('INIT-001'), 'demo/INIT-001');
  assert.equal(projectDemoRelDir('INIT-001', '.'), 'demo/INIT-001');
});

test('projectDemoRelDir: empty artifactRoot collapses to the legacy demo/<initiativeId>', () => {
  assert.equal(projectDemoRelDir('INIT-001', ''), 'demo/INIT-001');
  assert.equal(projectDemoRelDir('INIT-001', '  '), 'demo/INIT-001');
});

test('projectDemoRelDir: artifactRoot "forge" → forge/history/<initiativeId>/demo', () => {
  assert.equal(projectDemoRelDir('INIT-001', 'forge'), 'forge/history/INIT-001/demo');
});

// ---------------------------------------------------------------------------
// worktree-composed helpers — the pattern every call site previously
// hand-rolled as join(worktreePath, projectDemoRelDir(id, readArtifactRoot(…)))
// ---------------------------------------------------------------------------

test('worktreeDemoRelDir: no .forge/project.json → legacy demo/<id>', () => {
  const wt = tmpWorktree();
  try {
    assert.equal(worktreeDemoRelDir(wt, INIT), `demo/${INIT}`);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('worktreeDemoRelDir: artifactRoot "forge" read from the WORKTREE project.json', () => {
  const wt = tmpWorktree('forge');
  try {
    assert.equal(worktreeDemoRelDir(wt, INIT), `forge/history/${INIT}/demo`);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('worktreeDemoDir/JsonPath/MdPath: absolute paths under the resolved rel dir', () => {
  const wt = tmpWorktree('forge');
  try {
    const dir = resolve(wt, 'forge', 'history', INIT, 'demo');
    assert.equal(worktreeDemoDir(wt, INIT), dir);
    assert.equal(worktreeDemoJsonPath(wt, INIT), join(dir, DEMO_JSON_BASENAME));
    assert.equal(worktreeDemoMdPath(wt, INIT), join(dir, DEMO_MD_BASENAME));
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('worktreeDemoJsonRelPath: rel path for prompts/scope strings', () => {
  const legacy = tmpWorktree();
  const rooted = tmpWorktree('forge');
  try {
    assert.equal(worktreeDemoJsonRelPath(legacy, INIT), `demo/${INIT}/demo.json`);
    assert.equal(worktreeDemoJsonRelPath(rooted, INIT), `forge/history/${INIT}/demo/demo.json`);
  } finally {
    rmSync(legacy, { recursive: true, force: true });
    rmSync(rooted, { recursive: true, force: true });
  }
});

test('basenames are the canonical artifact names', () => {
  assert.equal(DEMO_JSON_BASENAME, 'demo.json');
  assert.equal(DEMO_MD_BASENAME, 'DEMO.md');
});
