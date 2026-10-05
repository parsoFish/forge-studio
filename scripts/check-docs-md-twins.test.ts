/**
 * check-docs-md-twins.test.ts — every built docs page has its raw-markdown
 * twin at `<path>.md`, the page's agent-readable surface.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingTwins } from './check-docs-md-twins.mjs';

const SCRIPT = join(resolve(dirname(fileURLToPath(import.meta.url))), 'check-docs-md-twins.mjs');

function site(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-md-twins-'));
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), 'x');
  }
  return dir;
}

test('every page has a twin: none missing', () => {
  const dir = site(['index.html', 'a/index.html', 'a.md', 'guides/b/index.html', 'guides/b.md']);
  try {
    assert.deepEqual(missingTwins(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a page without its twin is named', () => {
  const dir = site(['a/index.html', 'a.md', 'guides/b/index.html']);
  try {
    assert.deepEqual(missingTwins(dir), ['guides/b']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the landing page, the 404 page and search assets need no twin', () => {
  const dir = site(['index.html', '404.html', 'pagefind/x/index.html', '_astro/y/index.html']);
  try {
    assert.deepEqual(missingTwins(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: exit 1 naming the page; exit 0 when complete; exit 1 when the build is missing', () => {
  const bad = site(['a/index.html']);
  const good = site(['a/index.html', 'a.md']);
  try {
    const r1 = spawnSync(process.execPath, [SCRIPT, '--dist', bad], { encoding: 'utf8' });
    assert.equal(r1.status, 1, r1.stderr);
    assert.match(r1.stderr, /a\/index\.html has no a\.md/);
    const r2 = spawnSync(process.execPath, [SCRIPT, '--dist', good], { encoding: 'utf8' });
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /PASS — 1 page/);
    const r3 = spawnSync(process.execPath, [SCRIPT, '--dist', join(good, 'nope')], { encoding: 'utf8' });
    assert.equal(r3.status, 1);
    assert.match(r3.stderr, /no built site/);
  } finally {
    rmSync(bad, { recursive: true, force: true });
    rmSync(good, { recursive: true, force: true });
  }
});
