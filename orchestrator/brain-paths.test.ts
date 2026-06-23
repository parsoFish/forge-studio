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
  projectBrainDir,
  projectThemesDir,
  projectDemoRelDir,
  readArtifactRoot,
  resolveKbBrainDir,
} from './brain-paths.ts';
import * as brainPaths from './brain-paths.ts';

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
// resolveKbBrainDir — kbId → brain dir, with the project-brain fallback (ADR 035)
// ---------------------------------------------------------------------------

test('resolveKbBrainDir: top-level brain/<id> with a kb.yaml resolves directly', () => {
  const forgeRoot = newTempDir();
  try {
    const dir = join(forgeRoot, 'brain', 'cycles');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'kb.yaml'), 'id: cycles\n');
    assert.equal(resolveKbBrainDir(forgeRoot, 'cycles'), dir);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('resolveKbBrainDir: a per-project brain resolves via the brain/projects/<id> fallback', () => {
  const forgeRoot = newTempDir();
  try {
    const dir = join(forgeRoot, 'brain', 'projects', 'gitpulse');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'kb.yaml'), 'id: gitpulse\n');
    // No brain/gitpulse — only brain/projects/gitpulse exists.
    assert.equal(resolveKbBrainDir(forgeRoot, 'gitpulse'), dir);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('resolveKbBrainDir: unknown kbId (no kb.yaml either place) → null', () => {
  const forgeRoot = newTempDir();
  try {
    mkdirSync(join(forgeRoot, 'brain'), { recursive: true });
    assert.equal(resolveKbBrainDir(forgeRoot, 'nope'), null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('resolveKbBrainDir: top-level brain wins over a same-named project brain', () => {
  const forgeRoot = newTempDir();
  try {
    const top = join(forgeRoot, 'brain', 'shared');
    const proj = join(forgeRoot, 'brain', 'projects', 'shared');
    mkdirSync(top, { recursive: true });
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(top, 'kb.yaml'), 'id: shared\n');
    writeFileSync(join(proj, 'kb.yaml'), 'id: shared\n');
    assert.equal(resolveKbBrainDir(forgeRoot, 'shared'), top);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Central demo-history / contract SSOT was specified by ADR 035 but never wired
// (zero callers) — removed. Guard against the dead scheme silently returning.
// ---------------------------------------------------------------------------

test('brain-paths: the never-wired central-artifacts helpers stay deleted', () => {
  for (const dead of ['projectArtifactsDir', 'projectHistoryDir', 'projectContractPath']) {
    assert.ok(
      !(dead in brainPaths),
      `${dead} was dead code (no callers) — do not re-add it; cycle artifacts live in _logs/<cycle>/artifacts/`,
    );
  }
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
