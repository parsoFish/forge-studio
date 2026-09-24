/**
 * Unit tests for orchestrator/brain-paths.ts.
 *
 * ADR 035: per-project brain + history + contract are forge-owned and CENTRAL
 * (in the forge repo), not in the managed project's repo. Brain 3 lives at
 * `brain/projects/<name>/themes/`; history + contract at
 * `project-artifacts/<name>/`. `readArtifactRoot` is unchanged; the in-PR
 * demo path helpers moved to demo-paths.ts (plan 2.5 / N3) and are tested in
 * demo-paths.test.ts.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveKbIdFromBrainPath,
  projectBrainDir,
  projectThemesDir,
  readArtifactRoot,
  resolveKbBrainDir,
} from '../../brain-paths.ts';
import * as brainPaths from '../../brain-paths.ts';

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

// projectDemoRelDir tests moved to demo-paths.test.ts (plan 2.5 / N3).

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

// ---------------------------------------------------------------------------
// deriveKbIdFromBrainPath — forge-8vfn.8.3.5. The ONE kbId-from-path regex,
// shared by the PM's brain.read (forge-8vfn.5.16 / M7-C U2, repo-relative
// input) and the architect's own (M7-C ABR, absolute tool-call `file_path`
// input, since the architect's SDK session cwd is the PROJECT repo).
// ---------------------------------------------------------------------------

test('deriveKbIdFromBrainPath: repo-relative Brain 1/2 path (e.g. "brain/cycles/themes/x.md") → "cycles"', () => {
  assert.equal(deriveKbIdFromBrainPath('brain/cycles/themes/x.md'), 'cycles');
});

test('deriveKbIdFromBrainPath: repo-relative Brain 3 path ("brain/projects/<id>/...") → the project id', () => {
  assert.equal(deriveKbIdFromBrainPath('brain/projects/gitpulse/themes/a.md'), 'gitpulse');
});

test('deriveKbIdFromBrainPath: ABSOLUTE path with a brain/ segment mid-string → still resolves', () => {
  assert.equal(deriveKbIdFromBrainPath('/home/parso/forge/brain/forge-dev/themes/x.md'), 'forge-dev');
  assert.equal(deriveKbIdFromBrainPath('/home/parso/forge/brain/projects/kbB/themes/z.md'), 'kbB');
});

test('deriveKbIdFromBrainPath: an ordinary project-repo path names no KB → null', () => {
  assert.equal(deriveKbIdFromBrainPath('README.md'), null);
  assert.equal(deriveKbIdFromBrainPath('/home/parso/projects/p1/src/index.ts'), null);
});

test('deriveKbIdFromBrainPath: "brain/" with no further segment (no trailing slash after the id) → null, never a truncated id', () => {
  assert.equal(deriveKbIdFromBrainPath('brain/kb.yaml'), null);
});
