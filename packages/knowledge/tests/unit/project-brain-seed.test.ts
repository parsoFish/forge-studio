import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { seedProjectBrain } from '../../project-brain-seed.ts';
import { projectBrainDir, projectThemesDir, resolveKbBrainDir } from '../../brain-paths.ts';
import { runBrainLint } from '../../brain-lint.ts';

function makeForgeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'project-brain-seed-test-'));
}

test('seedProjectBrain: fresh project — creates kb.yaml + profile.md + themes/README.md', () => {
  const forgeRoot = makeForgeRoot();
  try {
    const result = seedProjectBrain(forgeRoot, 'acme-cli', 'Acme CLI');

    assert.equal(result.projectId, 'acme-cli');
    assert.equal(result.brainDir, projectBrainDir(forgeRoot, 'acme-cli'));
    assert.equal(result.files.length, 3);
    assert.ok(result.files.every((f) => f.action === 'created'));

    const kbYamlPath = join(result.brainDir, 'kb.yaml');
    const profilePath = join(result.brainDir, 'profile.md');
    const themesReadmePath = join(projectThemesDir(forgeRoot, 'acme-cli'), 'README.md');
    assert.ok(existsSync(kbYamlPath));
    assert.ok(existsSync(profilePath));
    assert.ok(existsSync(themesReadmePath));

    // kb.yaml matches the R1-01 contract shape (id/name/binding/desc/backend).
    const kb = yaml.load(readFileSync(kbYamlPath, 'utf8')) as Record<string, unknown>;
    assert.equal(kb.id, 'acme-cli');
    assert.equal(kb.name, 'acme-cli (project)');
    assert.deepEqual(kb.binding, { kind: 'project', ref: 'acme-cli' });
    assert.equal(kb.backend, 'filesystem');
    assert.equal(typeof kb.desc, 'string');
    assert.ok((kb.desc as string).includes('acme-cli'));

    // profile.md: title + central-brain framing + the documented (escaped,
    // inert) forge:constraint example.
    const profile = readFileSync(profilePath, 'utf8');
    assert.ok(profile.startsWith('# Acme CLI — project brain (Brain 3 profile)'));
    assert.ok(profile.includes('brain/projects/acme-cli/'));
    assert.ok(profile.includes('&lt;!-- forge:constraint'));
    assert.ok(profile.includes('applies_to:'));
    assert.ok(!profile.includes('<!-- forge:constraint'), 'the example must be HTML-escaped, not a live block');

    const themesReadme = readFileSync(themesReadmePath, 'utf8');
    assert.ok(themesReadme.includes('acme-cli'));
    assert.ok(themesReadme.toLowerCase().includes('theme'));
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('seedProjectBrain: reported paths are forge-root-relative, forward-slash separated', () => {
  const forgeRoot = makeForgeRoot();
  try {
    const result = seedProjectBrain(forgeRoot, 'acme-cli', 'Acme CLI');
    const paths = result.files.map((f) => f.path).sort();
    assert.deepEqual(paths, [
      'brain/projects/acme-cli/kb.yaml',
      'brain/projects/acme-cli/profile.md',
      'brain/projects/acme-cli/themes/README.md',
    ]);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('seedProjectBrain: idempotent — an existing profile.md is never overwritten', () => {
  const forgeRoot = makeForgeRoot();
  try {
    const brainDir = projectBrainDir(forgeRoot, 'acme-cli');
    mkdirSync(brainDir, { recursive: true });
    const handAuthored = '# acme-cli — hand-authored profile, do not clobber\n';
    writeFileSync(join(brainDir, 'profile.md'), handAuthored, 'utf8');

    const result = seedProjectBrain(forgeRoot, 'acme-cli', 'Acme CLI');

    const byPath = new Map(result.files.map((f) => [f.path, f.action]));
    assert.equal(byPath.get('brain/projects/acme-cli/profile.md'), 'skipped-existing');
    assert.equal(byPath.get('brain/projects/acme-cli/kb.yaml'), 'created');
    assert.equal(byPath.get('brain/projects/acme-cli/themes/README.md'), 'created');

    assert.equal(readFileSync(join(brainDir, 'profile.md'), 'utf8'), handAuthored);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('seedProjectBrain: idempotent — calling twice on a fully-seeded project is a pure no-op', () => {
  const forgeRoot = makeForgeRoot();
  try {
    const first = seedProjectBrain(forgeRoot, 'acme-cli', 'Acme CLI');
    assert.ok(first.files.every((f) => f.action === 'created'));

    const kbYamlPath = join(first.brainDir, 'kb.yaml');
    const before = readFileSync(kbYamlPath, 'utf8');

    const second = seedProjectBrain(forgeRoot, 'acme-cli', 'Acme CLI');
    assert.ok(second.files.every((f) => f.action === 'skipped-existing'));
    assert.equal(readFileSync(kbYamlPath, 'utf8'), before);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('seedProjectBrain: Studio KB graph picks the project up via resolveKbBrainDir, no special-casing', () => {
  const forgeRoot = makeForgeRoot();
  try {
    assert.equal(resolveKbBrainDir(forgeRoot, 'acme-cli'), null, 'not yet seeded — not resolvable');
    const result = seedProjectBrain(forgeRoot, 'acme-cli', 'Acme CLI');
    assert.equal(resolveKbBrainDir(forgeRoot, 'acme-cli'), result.brainDir);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// The `forge:constraint` inertness oracle moved to
// `apps/forge/project-brain-seed-constraint-parity.test.ts`: it needs the REAL
// `@forge/projects` parser as well as this package's seeder, and rank-2
// siblings may not import each other. `apps/forge/` is the one tree with no
// rule, so the oracle keeps both real implementations instead of one of them
// being replaced by a copy that could drift.

test('seedProjectBrain: forge brain lint stays clean on a freshly seeded project', () => {
  const forgeRoot = makeForgeRoot();
  try {
    mkdirSync(join(forgeRoot, 'brain'), { recursive: true });
    seedProjectBrain(forgeRoot, 'acme-cli', 'Acme CLI');

    const result = runBrainLint({ cwd: forgeRoot, scope: 'full' });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.findings, []);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('seedProjectBrain: different project ids seed independent, non-colliding brain dirs', () => {
  const forgeRoot = makeForgeRoot();
  try {
    const a = seedProjectBrain(forgeRoot, 'acme-cli', 'Acme CLI');
    const b = seedProjectBrain(forgeRoot, 'acme-web', 'Acme Web');
    assert.notEqual(a.brainDir, b.brainDir);
    assert.ok(existsSync(join(a.brainDir, 'kb.yaml')));
    assert.ok(existsSync(join(b.brainDir, 'kb.yaml')));
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
