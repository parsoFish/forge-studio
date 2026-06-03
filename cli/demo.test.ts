/**
 * Tests for demo.ts pure/testable helpers (REV-2 post-cull):
 * materialiseWorktree, cleanupWorktreeAt, imageToDataUri.
 *
 * The heavy orchestrator (generateComparisonDemo + Playwright author stack)
 * was deleted in REV-2. The capture path (captureCheckpoints) is side-effecting
 * and validated via the live trafficGame run — same split as cycle.ts.
 *
 * The following tests that covered deleted code were also deleted:
 *   - pairCheckpoints (moved to demo.ts from demo-html.ts — deleted with manifest stack)
 *   - loadDemoManifest (deleted)
 *   - buildComparisonModel (deleted)
 *   - computeDiffStat (deleted)
 *   - writeComparisonBundle (deleted)
 *   - runHarness (deleted)
 *   - pairHarnessMetrics (deleted)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  materialiseWorktree,
  cleanupWorktreeAt,
  imageToDataUri,
} from './demo.ts';

// A 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
  'base64',
);

function makeRepo(): { dir: string; baseRef: string; changedRef: string } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-demo-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@forge']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'forge-test']);
  writeFileSync(join(dir, 'app.txt'), 'v1\n');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'base']);
  const baseRef = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', dir, 'checkout', '-q', '-b', 'feature']);
  writeFileSync(join(dir, 'app.txt'), 'v2 — new behaviour\n');
  writeFileSync(join(dir, 'extra.txt'), 'added\n');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'feature change']);
  const changedRef = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  execFileSync('git', ['-C', dir, 'checkout', '-q', 'main']);
  return { dir, baseRef, changedRef };
}

test('materialiseWorktree + cleanupWorktreeAt: detached tree at a ref, then gone', () => {
  const { dir, baseRef } = makeRepo();
  const wtPath = join(dir, '.demo-wt', 'before');
  try {
    const h = materialiseWorktree(dir, baseRef, wtPath);
    assert.equal(existsSync(join(wtPath, 'app.txt')), true);
    assert.equal(readFileSync(join(wtPath, 'app.txt'), 'utf8'), 'v1\n');
    cleanupWorktreeAt(h);
    assert.equal(existsSync(wtPath), false, 'worktree dir removed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('materialiseWorktree: throws on a non-git directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-demo-nogit-'));
  try {
    assert.throws(() => materialiseWorktree(dir, 'main', join(dir, 'wt')), /not a git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanupWorktreeAt: idempotent — second call does not throw', () => {
  const { dir, changedRef } = makeRepo();
  const wtPath = join(dir, '.demo-wt', 'after');
  try {
    const h = materialiseWorktree(dir, changedRef, wtPath);
    cleanupWorktreeAt(h);
    cleanupWorktreeAt(h); // again
    assert.ok(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('imageToDataUri: encodes a png; null on missing file', () => {
  const d = mkdtempSync(join(tmpdir(), 'forge-demo-img-'));
  try {
    const p = join(d, 'shot.png');
    writeFileSync(p, PNG);
    const uri = imageToDataUri(p);
    assert.ok(uri && uri.startsWith('data:image/png;base64,'));
    assert.equal(imageToDataUri(join(d, 'missing.png')), null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('imageToDataUri: returns null for oversized file', () => {
  const d = mkdtempSync(join(tmpdir(), 'forge-demo-img-big-'));
  try {
    const p = join(d, 'big.png');
    // 4 MB > MAX_INLINE_IMAGE_BYTES (3 MB)
    writeFileSync(p, Buffer.alloc(4 * 1024 * 1024, 0xff));
    assert.equal(imageToDataUri(p), null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
