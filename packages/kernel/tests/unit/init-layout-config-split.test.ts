/**
 * Tests for the ensureLayout split (forge-8vfn.6.11.46): the dir-scaffolding
 * step and the forge.config.json write are separate, honestly-named
 * functions, so a caller that only needs dirs can never silently produce
 * (or fail to produce) a config file.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureLayoutDirs, ensureDefaultConfig, layoutDirs } from '../../init.ts';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'forge-init-split-'));
}

describe('ensureLayoutDirs — dirs only, never touches config', () => {
  it('creates the layout dirs but leaves forge.config.json absent', () => {
    const root = tmpRoot();
    try {
      ensureLayoutDirs(root);
      for (const dir of layoutDirs(root)) {
        assert.ok(existsSync(dir), `expected dir created: ${dir}`);
      }
      assert.equal(
        existsSync(join(root, 'forge.config.json')),
        false,
        'ensureLayoutDirs must never write forge.config.json',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('ensureDefaultConfig — the config write, named for what it does', () => {
  it('writes forge.config.json once on a clean root', () => {
    const root = tmpRoot();
    try {
      const result = ensureDefaultConfig(root);
      assert.equal(result.written, true);
      assert.ok(existsSync(join(root, 'forge.config.json')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves an existing config byte-identical', () => {
    const root = tmpRoot();
    try {
      const cfgPath = join(root, 'forge.config.json');
      const original = JSON.stringify({ projectsDir: './custom' });
      writeFileSync(cfgPath, original, 'utf8');

      const result = ensureDefaultConfig(root);
      assert.equal(result.written, false);
      assert.equal(
        readFileSync(cfgPath, 'utf8'),
        original,
        'ensureDefaultConfig must not touch an existing config',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
