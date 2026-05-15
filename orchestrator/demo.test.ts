/**
 * Tests for the demo generator's pure/testable helpers (F-44):
 * materialiseWorktree, cleanupWorktreeAt, pairCheckpoints, loadDemoManifest,
 * buildComparisonModel, computeDiffStat, writeComparisonBundle.
 *
 * The heavy orchestrator (generateComparisonDemo) is exercised via the live
 * trafficGame validation run, not here — same split as cycle.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
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
  pairCheckpoints,
  loadDemoManifest,
  buildComparisonModel,
  computeDiffStat,
  writeComparisonBundle,
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

test('pairCheckpoints: pairs by filename, honours spec order, fills missing side', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-demo-cp-'));
  try {
    const before = join(root, 'before');
    const after = join(root, 'after');
    mkdirSync(before, { recursive: true });
    mkdirSync(after, { recursive: true });
    // 'home' captured in both; 'inspector' only in after (new behaviour).
    writeFileSync(join(before, 'home.png'), PNG);
    writeFileSync(join(after, 'home.png'), PNG);
    writeFileSync(join(after, 'inspector.png'), PNG);

    const cps = pairCheckpoints(before, after, [
      { label: 'home', caption: 'Landing screen' },
      { label: 'inspector', caption: 'Inspector after node select', afterNote: 'New panel' },
    ]);

    assert.equal(cps.length, 2);
    assert.equal(cps[0].label, 'home');
    assert.ok(cps[0].beforeImage && cps[0].afterImage);
    assert.equal(cps[1].label, 'inspector');
    assert.equal(cps[1].beforeImage, null, 'no baseline capture for the new panel');
    assert.ok(cps[1].afterImage);
    assert.equal(cps[1].afterNote, 'New panel');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pairCheckpoints: unknown screenshots are appended, not dropped', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-demo-cp2-'));
  try {
    const before = join(root, 'before');
    const after = join(root, 'after');
    mkdirSync(before, { recursive: true });
    mkdirSync(after, { recursive: true });
    writeFileSync(join(after, 'surprise.png'), PNG);
    const cps = pairCheckpoints(before, after, []);
    assert.equal(cps.length, 1);
    assert.equal(cps[0].label, 'surprise');
    assert.equal(cps[0].caption, 'surprise');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadDemoManifest: reads a valid manifest; falls back when absent/malformed', () => {
  const d = mkdtempSync(join(tmpdir(), 'forge-demo-man-'));
  try {
    // absent → fallback
    const fb = loadDemoManifest(d, 'Fallback Title');
    assert.equal(fb.title, 'Fallback Title');
    assert.equal(fb.checkpoints.length, 0);

    // valid
    writeFileSync(
      join(d, 'demo-manifest.json'),
      JSON.stringify({
        essence: 'Node selection now opens an inspector.',
        title: 'Node inspector',
        checkpoints: [{ label: 'home', caption: 'Landing' }],
        acceptanceCriteria: ['GIVEN x WHEN y THEN z'],
      }),
    );
    const m = loadDemoManifest(d, 'Fallback Title');
    assert.equal(m.title, 'Node inspector');
    assert.equal(m.essence, 'Node selection now opens an inspector.');
    assert.equal(m.checkpoints[0].label, 'home');
    assert.deepEqual(m.acceptanceCriteria, ['GIVEN x WHEN y THEN z']);

    // malformed → fallback
    writeFileSync(join(d, 'demo-manifest.json'), '{ not json');
    const bad = loadDemoManifest(d, 'FB');
    assert.equal(bad.title, 'FB');

    // partially-valid: essence present but checkpoints missing → fallback
    writeFileSync(join(d, 'demo-manifest.json'), JSON.stringify({ essence: 'x' }));
    const partial = loadDemoManifest(d, 'FB2');
    assert.equal(partial.title, 'FB2');
    assert.equal(partial.checkpoints.length, 0);

    // partially-valid: checkpoints present but essence missing → fallback
    writeFileSync(
      join(d, 'demo-manifest.json'),
      JSON.stringify({ checkpoints: [{ label: 'a', caption: 'b' }] }),
    );
    const partial2 = loadDemoManifest(d, 'FB3');
    assert.equal(partial2.title, 'FB3');
    assert.equal(partial2.checkpoints.length, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('computeDiffStat: returns a stat string for a real ref range', () => {
  const { dir, baseRef, changedRef } = makeRepo();
  try {
    const stat = computeDiffStat(dir, baseRef, changedRef);
    assert.match(stat, /app\.txt/);
    assert.match(stat, /extra\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildComparisonModel + writeComparisonBundle: assembles model and writes self-contained html', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-demo-bundle-'));
  try {
    const before = join(root, 'before');
    const after = join(root, 'after');
    mkdirSync(before, { recursive: true });
    mkdirSync(after, { recursive: true });
    writeFileSync(join(before, 'home.png'), PNG);
    writeFileSync(join(after, 'home.png'), PNG);

    const model = buildComparisonModel({
      manifest: {
        essence: 'The landing screen now shows a grade badge.',
        title: 'Grade badge',
        checkpoints: [{ label: 'home', caption: 'Landing screen' }],
        acceptanceCriteria: ['GIVEN the home screen WHEN it loads THEN a grade badge is visible'],
      },
      project: 'trafficGame',
      initiativeId: 'INIT-x',
      baseRef: 'origin/main',
      changedRef: 'feature',
      beforeDir: before,
      afterDir: after,
      baselineBuild: { ok: true },
      changedBuild: { ok: true },
      diffStat: ' app.txt | 2 +-',
    });
    assert.equal(model.title, 'Grade badge');
    assert.equal(model.checkpoints.length, 1);
    assert.ok(model.checkpoints[0].beforeImage?.startsWith('data:image/png;base64,'));

    const bundleDir = join(root, 'bundle');
    const htmlPath = writeComparisonBundle(bundleDir, model);
    assert.ok(existsSync(htmlPath));
    assert.ok(existsSync(join(bundleDir, 'README.md')));
    const html = readFileSync(htmlPath, 'utf8');
    assert.match(html, /Grade badge/);
    assert.match(html, /grade badge is visible/);
    assert.match(html, /data:image\/png;base64,/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
