/**
 * Unit tests for orchestrator/brain-paths.ts.
 *
 * Covers the project-scoped helpers that incorporate the optional
 * `artifactRoot` field: projectArtifactDir, projectBrainDir, projectThemesDir,
 * projectHistoryDir, and readArtifactRoot.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectArtifactDir,
  projectBrainDir,
  projectThemesDir,
  projectHistoryDir,
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
// projectArtifactDir
// ---------------------------------------------------------------------------

test('projectArtifactDir: default artifactRoot "." resolves to legacy path (projects/<name>)', () => {
  const forgeRoot = '/srv/forge';
  const name = 'my-project';
  const result = projectArtifactDir(forgeRoot, name);
  const expected = resolve(forgeRoot, 'projects', name, '.');
  assert.equal(result, expected);
});

test('projectArtifactDir: artifactRoot "forge" resolves under projects/<name>/forge', () => {
  const forgeRoot = '/srv/forge';
  const name = 'my-project';
  const result = projectArtifactDir(forgeRoot, name, 'forge');
  const expected = resolve(forgeRoot, 'projects', name, 'forge');
  assert.equal(result, expected);
});

// ---------------------------------------------------------------------------
// projectBrainDir
// ---------------------------------------------------------------------------

test('projectBrainDir: default artifactRoot → legacy brain path (projects/<name>/brain)', () => {
  const forgeRoot = '/srv/forge';
  const name = 'my-project';
  const result = projectBrainDir(forgeRoot, name);
  const expected = resolve(forgeRoot, 'projects', name, 'brain');
  assert.equal(result, expected);
});

test('projectBrainDir: artifactRoot "forge" → projects/<name>/forge/brain', () => {
  const forgeRoot = '/srv/forge';
  const name = 'my-project';
  const result = projectBrainDir(forgeRoot, name, 'forge');
  const expected = resolve(forgeRoot, 'projects', name, 'forge', 'brain');
  assert.equal(result, expected);
});

// ---------------------------------------------------------------------------
// projectThemesDir
// ---------------------------------------------------------------------------

test('projectThemesDir: default artifactRoot → legacy themes path (projects/<name>/brain/themes)', () => {
  const forgeRoot = '/srv/forge';
  const name = 'my-project';
  const result = projectThemesDir(forgeRoot, name);
  const expected = resolve(forgeRoot, 'projects', name, 'brain', 'themes');
  assert.equal(result, expected);
});

test('projectThemesDir: artifactRoot "forge" → projects/<name>/forge/brain/themes', () => {
  const forgeRoot = '/srv/forge';
  const name = 'my-project';
  const result = projectThemesDir(forgeRoot, name, 'forge');
  const expected = resolve(forgeRoot, 'projects', name, 'forge', 'brain', 'themes');
  assert.equal(result, expected);
});

// ---------------------------------------------------------------------------
// projectHistoryDir
// ---------------------------------------------------------------------------

test('projectHistoryDir: default artifactRoot "." → <projectRoot>/history/<initiativeId>', () => {
  const projectRoot = '/srv/projects/my-project';
  const initiativeId = 'INIT-001';
  const result = projectHistoryDir(projectRoot, initiativeId);
  const expected = resolve(projectRoot, '.', 'history', initiativeId);
  assert.equal(result, expected);
});

test('projectHistoryDir: artifactRoot "forge" → <projectRoot>/forge/history/<initiativeId>', () => {
  const projectRoot = '/srv/projects/my-project';
  const initiativeId = 'INIT-001';
  const result = projectHistoryDir(projectRoot, initiativeId, 'forge');
  const expected = resolve(projectRoot, 'forge', 'history', initiativeId);
  assert.equal(result, expected);
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
