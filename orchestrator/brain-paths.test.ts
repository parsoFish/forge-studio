/**
 * Unit tests for orchestrator/brain-paths.ts.
 *
 * ADR 035: per-project brain + history + contract are forge-owned and CENTRAL
 * (in the forge repo), not in the managed project's repo. Brain 3 lives at
 * `brain/projects/<name>/themes/`; history + contract at
 * `project-artifacts/<name>/`. The in-PR demo (`projectDemoRelDir`,
 * worktree-relative) and `readArtifactRoot` are unchanged.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectArtifactsDir,
  projectBrainDir,
  projectThemesDir,
  projectHistoryDir,
  projectContractPath,
  projectDemoRelDir,
  readArtifactRoot,
} from './brain-paths.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'forge-brain-paths-test-'));
}

function writeProjectJson(projectRoot: string, contents: string): void {
  const dir = join(projectRoot, '.forge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), contents);
}

// ---------------------------------------------------------------------------
// projectArtifactsDir — central forge-owned artifacts home (ADR 035)
// ---------------------------------------------------------------------------

test('projectArtifactsDir: central project-artifacts/<name> under the forge root', () => {
  const forgeRoot = '/srv/forge';
  const result = projectArtifactsDir(forgeRoot, 'my-project');
  assert.equal(result, resolve(forgeRoot, 'project-artifacts', 'my-project'));
});

// ---------------------------------------------------------------------------
// projectBrainDir — Brain 3, central in the brain wiki (ADR 035)
// ---------------------------------------------------------------------------

test('projectBrainDir: central brain/projects/<name> (no longer in the project repo)', () => {
  const forgeRoot = '/srv/forge';
  const result = projectBrainDir(forgeRoot, 'my-project');
  assert.equal(result, resolve(forgeRoot, 'brain', 'projects', 'my-project'));
});

// ---------------------------------------------------------------------------
// projectThemesDir — Brain 3 themes, central (ADR 035)
// ---------------------------------------------------------------------------

test('projectThemesDir: central brain/projects/<name>/themes', () => {
  const forgeRoot = '/srv/forge';
  const result = projectThemesDir(forgeRoot, 'my-project');
  assert.equal(result, resolve(forgeRoot, 'brain', 'projects', 'my-project', 'themes'));
});

// ---------------------------------------------------------------------------
// projectHistoryDir — central archived history per initiative (ADR 035)
// ---------------------------------------------------------------------------

test('projectHistoryDir: central project-artifacts/<name>/demo-history/<initiativeId>', () => {
  const forgeRoot = '/srv/forge';
  const result = projectHistoryDir(forgeRoot, 'my-project', 'INIT-001');
  assert.equal(
    result,
    resolve(forgeRoot, 'project-artifacts', 'my-project', 'demo-history', 'INIT-001'),
  );
});

// ---------------------------------------------------------------------------
// projectContractPath — central SSOT for the resolved contract (ADR 035)
// ---------------------------------------------------------------------------

test('projectContractPath: central project-artifacts/<name>/contract.json', () => {
  const forgeRoot = '/srv/forge';
  const result = projectContractPath(forgeRoot, 'my-project');
  assert.equal(result, resolve(forgeRoot, 'project-artifacts', 'my-project', 'contract.json'));
});

// ---------------------------------------------------------------------------
// projectDemoRelDir
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
// readArtifactRoot
// ---------------------------------------------------------------------------

test('readArtifactRoot: returns "forge" when .forge/project.json contains artifactRoot "forge"', () => {
  const root = newTempDir();
  try {
    writeProjectJson(
      root,
      JSON.stringify({
        artifactRoot: 'forge',
        demo: { shape: 'none' },
        quality_gate_cmd: ['true'],
      }),
    );
    const result = readArtifactRoot(root);
    assert.equal(result, 'forge');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readArtifactRoot: returns "." when .forge/project.json is missing', () => {
  const root = newTempDir();
  try {
    const result = readArtifactRoot(root);
    assert.equal(result, '.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readArtifactRoot: returns "." when .forge/project.json is malformed JSON', () => {
  const root = newTempDir();
  try {
    writeProjectJson(root, '{ not valid json');
    const result = readArtifactRoot(root);
    assert.equal(result, '.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readArtifactRoot: returns "." when artifactRoot field is absent from project.json', () => {
  const root = newTempDir();
  try {
    writeProjectJson(
      root,
      JSON.stringify({ demo: { shape: 'none' }, quality_gate_cmd: ['true'] }),
    );
    const result = readArtifactRoot(root);
    assert.equal(result, '.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readArtifactRoot: unsafe "/abs" value → returns "." (never propagates unsafe root)', () => {
  const root = newTempDir();
  try {
    writeProjectJson(root, JSON.stringify({ artifactRoot: '/abs' }));
    const result = readArtifactRoot(root);
    assert.equal(result, '.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readArtifactRoot: unsafe "../x" value → returns "." (never propagates unsafe root)', () => {
  const root = newTempDir();
  try {
    writeProjectJson(root, JSON.stringify({ artifactRoot: '../x' }));
    const result = readArtifactRoot(root);
    assert.equal(result, '.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readArtifactRoot: non-string artifactRoot (number) → returns "."', () => {
  const root = newTempDir();
  try {
    writeProjectJson(root, JSON.stringify({ artifactRoot: 42 }));
    const result = readArtifactRoot(root);
    assert.equal(result, '.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readArtifactRoot: returns "." when artifactRoot is "." explicitly', () => {
  const root = newTempDir();
  try {
    writeProjectJson(root, JSON.stringify({ artifactRoot: '.' }));
    const result = readArtifactRoot(root);
    assert.equal(result, '.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
