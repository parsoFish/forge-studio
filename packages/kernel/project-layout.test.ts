/**
 * Tests for `packages/kernel/project-layout.ts` — the project-layout SSOT
 * moved verbatim from `orchestrator/studio/registry.ts` (id normalisation +
 * disk discovery) and `packages/knowledge/brain-paths.ts` (the per-project
 * brain dirs, ADR 035). Behaviour-preserving move: these cases pin the same
 * shapes the pre-move implementations pinned (see `orchestrator/studio/
 * registry.test.ts`'s `discoverProjects` describe block and `packages/
 * knowledge/tests/unit/brain-paths.test.ts`), plus one case proving all four
 * symbols are reachable through the `@forge/kernel` barrel door.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normalizeProjectId,
  discoverProjects,
  projectBrainDir,
  projectThemesDir,
  type DiscoveredProject,
} from '@forge/kernel';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'kernel-project-layout-'));
}

describe('normalizeProjectId', () => {
  it('is the identity for a name that already satisfies PROJECT_ID_RE', () => {
    assert.equal(normalizeProjectId('trafficGame'), 'trafficGame');
  });

  it('folds illegal characters (whitespace) to a hyphen', () => {
    assert.equal(normalizeProjectId('my proj'), 'my-proj');
  });
});

describe('discoverProjects', () => {
  it('lists a project dir carrying .forge/project.json as hasConfig: true', () => {
    const root = tmpRoot();
    try {
      const dir = join(root, 'projects', 'withcfg', '.forge');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'project.json'), '{"name":"withcfg"}', 'utf8');

      const found = discoverProjects(join(root, 'projects'), root);
      assert.equal(found.length, 1);
      assert.equal(found[0].id, 'withcfg');
      assert.equal(found[0].hasConfig, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists a project dir missing .forge/project.json as hasConfig: false', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'projects', 'nocfg'), { recursive: true });

      const found = discoverProjects(join(root, 'projects'), root);
      assert.equal(found.length, 1);
      assert.equal(found[0].id, 'nocfg');
      assert.equal(found[0].hasConfig, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips a dot-prefixed dir', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'projects', '.staging-x'), { recursive: true });
      mkdirSync(join(root, 'projects', 'realproj'), { recursive: true });

      const found: DiscoveredProject[] = discoverProjects(join(root, 'projects'), root);
      const ids = found.map((p) => p.id);
      assert.ok(!ids.includes('.staging-x'));
      assert.ok(!ids.includes('staging-x'));
      assert.deepEqual(ids, ['realproj']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips a name failing the id rule', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'projects', 'not a project'), { recursive: true });
      mkdirSync(join(root, 'projects', 'realproj'), { recursive: true });

      const found = discoverProjects(join(root, 'projects'), root);
      assert.deepEqual(found.map((p) => p.id), ['realproj']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns [] for a missing root', () => {
    const root = tmpRoot();
    try {
      assert.deepEqual(discoverProjects(join(root, 'does-not-exist'), root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('projectBrainDir / projectThemesDir', () => {
  it('resolve to <root>/brain/projects/<name> and its themes/ subdir', () => {
    const root = '/somewhere/forge';
    assert.equal(projectBrainDir(root, 'betterado'), join(root, 'brain', 'projects', 'betterado'));
    assert.equal(projectThemesDir(root, 'betterado'), join(root, 'brain', 'projects', 'betterado', 'themes'));
  });
});

describe('the @forge/kernel barrel door', () => {
  it('exports all four project-layout symbols', () => {
    assert.equal(typeof normalizeProjectId, 'function');
    assert.equal(typeof discoverProjects, 'function');
    assert.equal(typeof projectBrainDir, 'function');
    assert.equal(typeof projectThemesDir, 'function');
  });
});
