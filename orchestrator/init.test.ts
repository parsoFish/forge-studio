/**
 * Tests for orchestrator/init.ts — `forge init` scaffolding (ADR-033, J1).
 * Pure-logic + idempotent-I/O against a temp dir.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { layoutDirs, defaultConfigJson, runInit, QUEUE_SUBDIRS } from './init.ts';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'forge-init-'));
}

describe('forge init — layoutDirs (pure)', () => {
  it('includes the queue root, all five queue states, _worktrees and _logs', () => {
    const dirs = layoutDirs('/somewhere/forge');
    assert.ok(dirs.some((d) => d.endsWith('/_queue')));
    for (const s of QUEUE_SUBDIRS) {
      assert.ok(dirs.some((d) => d.endsWith(`/_queue/${s}`)), `missing _queue/${s}`);
    }
    assert.ok(dirs.some((d) => d.endsWith('/_worktrees')));
    assert.ok(dirs.some((d) => d.endsWith('/_logs')));
  });
});

describe('forge init — defaultConfigJson (pure)', () => {
  it('is valid JSON with the documented minimal shape', () => {
    const parsed = JSON.parse(defaultConfigJson());
    assert.equal(parsed.projectsDir, './projects');
    assert.equal(parsed.scheduler.maxConcurrentInitiatives, 2);
    assert.equal(parsed.notify.webhook_url, null);
  });
});

describe('forge init — runInit (I/O, idempotent)', () => {
  it('creates the full layout + config on a clean root', () => {
    const root = tmpRoot();
    try {
      const report = runInit(root, { isGhAuthed: () => true });
      for (const dir of layoutDirs(root)) {
        assert.ok(existsSync(dir), `expected dir created: ${dir}`);
      }
      assert.ok(existsSync(join(root, 'forge.config.json')));
      assert.equal(report.configWritten, true);
      assert.ok(report.created.length > 0);
      assert.equal(report.skipped.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is idempotent — a second run creates nothing and preserves an edited config', () => {
    const root = tmpRoot();
    try {
      runInit(root, { isGhAuthed: () => true });
      // operator edits the config
      const cfgPath = join(root, 'forge.config.json');
      writeFileSync(cfgPath, JSON.stringify({ projectsDir: './custom' }), 'utf8');

      const second = runInit(root, { isGhAuthed: () => true });
      assert.equal(second.created.length, 0, 'second run must create nothing');
      assert.equal(second.configWritten, false);
      // config preserved, not clobbered
      assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).projectsDir, './custom');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('hints to run gh auth login when gh is not authenticated', () => {
    const root = tmpRoot();
    try {
      const report = runInit(root, { isGhAuthed: () => false });
      assert.ok(report.hints.some((h) => h.includes('gh auth login')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not clobber a pre-existing queue dir', () => {
    const root = tmpRoot();
    try {
      const pending = join(root, '_queue', 'pending');
      mkdirSync(pending, { recursive: true });
      writeFileSync(join(pending, 'sentinel.md'), 'keep me', 'utf8');

      runInit(root, { isGhAuthed: () => true });
      assert.equal(readFileSync(join(pending, 'sentinel.md'), 'utf8'), 'keep me');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
