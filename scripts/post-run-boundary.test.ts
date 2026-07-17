/**
 * post-run-boundary.test.ts — TDD contract for scripts/lib/post-run-boundary.mjs
 * (R5-01-F3). Seeded tmp-git-repo fixtures; PR capture is injected so no
 * network call is ever made.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  captureBoundaryBaseline,
  compareBoundary,
  defaultGhPrList,
  formatBoundaryReport,
} from './lib/post-run-boundary.mjs';

/** `gh pr list` stand-in used everywhere PR-state isn't itself under test. */
const noPrs = () => null;

function initTmpRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'post-run-boundary-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  return dir;
}

function withTmpRepo(fn) {
  const dir = initTmpRepo();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('captureBoundaryBaseline: captures headSha, empty status, and injected prs', () => {
  withTmpRepo((dir) => {
    const snapshot = captureBoundaryBaseline({
      repoRoot: dir,
      ghPrList: () => [{ number: 1, state: 'OPEN', headRefName: 'feat/x' }],
    });
    assert.equal(snapshot.headSha.length, 40);
    assert.equal(snapshot.statusPorcelain, '');
    assert.deepEqual(snapshot.prs, [{ number: 1, state: 'OPEN', headRefName: 'feat/x' }]);
  });
});

test('captureBoundaryBaseline: requires repoRoot (fails fast, no silent default)', () => {
  assert.throws(() => captureBoundaryBaseline({ ghPrList: noPrs }), /repoRoot is required/);
});

test('captureBoundaryBaseline: a hard git failure throws (git checks stay hard)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'post-run-boundary-notgit-'));
  try {
    assert.throws(
      () => captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs }),
      /post-run-boundary: git/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compareBoundary: clean when nothing changed between captures', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    const current = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    const result = compareBoundary(baseline, current);
    assert.equal(result.clean, true);
    assert.deepEqual(result.violations, []);
    assert.equal(result.prsSkipped, true);
  });
});

test('compareBoundary: head-moved violation when a stray commit lands after baseline', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    writeFileSync(join(dir, 'new.txt'), 'x\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'stray commit'], { cwd: dir });
    const current = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });

    const result = compareBoundary(baseline, current);

    assert.equal(result.clean, false);
    assert.deepEqual(result.violations, [
      { type: 'head-moved', before: baseline.headSha, after: current.headSha },
    ]);
  });
});

test('compareBoundary: tree-dirtied violation on NEW dirt absent from baseline', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    writeFileSync(join(dir, 'stray.txt'), 'oops\n');
    const current = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });

    const result = compareBoundary(baseline, current);

    assert.equal(result.clean, false);
    const violation = result.violations.find((v) => v.type === 'tree-dirtied');
    assert.ok(violation, 'expected a tree-dirtied violation');
    assert.equal(violation.path, 'stray.txt');
    assert.equal(violation.before, null);
  });
});

test('compareBoundary: pre-existing dirt at baseline is tolerated, even if it changes further', () => {
  withTmpRepo((dir) => {
    // Dirty BEFORE the baseline is captured — a legitimately-dirty operator tree.
    writeFileSync(join(dir, 'README.md'), 'hello\nalready dirty\n');
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });

    // The same path changes further during the run — still tolerated (path-level match).
    writeFileSync(join(dir, 'README.md'), 'hello\nchanged again\n');
    const current = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });

    const result = compareBoundary(baseline, current);

    assert.equal(result.clean, true);
    assert.deepEqual(result.violations, []);
  });
});

test('compareBoundary: ignorePathPrefixes exempts a caller-declared output surface', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    mkdirSync(join(dir, 'demos', 'e2e'), { recursive: true });
    writeFileSync(join(dir, 'demos', 'e2e', 'index.html'), '<html></html>');
    const current = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });

    const result = compareBoundary(baseline, current, { ignorePathPrefixes: ['demos/e2e/'] });

    assert.equal(result.clean, true);
  });
});

test('compareBoundary: ignorePathPrefixes does not exempt paths outside the declared prefix', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    writeFileSync(join(dir, 'stray.txt'), 'oops\n');
    const current = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });

    const result = compareBoundary(baseline, current, { ignorePathPrefixes: ['demos/e2e/'] });

    assert.equal(result.clean, false);
  });
});

test('compareBoundary: pr-state-changed when an open PR disappears (merged/closed mid-run)', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({
      repoRoot: dir,
      ghPrList: () => [{ number: 23, state: 'OPEN', headRefName: 'feat/x' }],
    });
    const current = captureBoundaryBaseline({ repoRoot: dir, ghPrList: () => [] });

    const result = compareBoundary(baseline, current);

    assert.equal(result.clean, false);
    assert.equal(result.prsSkipped, false);
    const violation = result.violations.find((v) => v.type === 'pr-state-changed');
    assert.ok(violation, 'expected a pr-state-changed violation');
    assert.equal(violation.prNumber, 23);
    assert.equal(violation.before.state, 'OPEN');
    assert.equal(violation.after, null);
  });
});

test('compareBoundary: pr-state-changed when a PR state/branch changes without disappearing', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({
      repoRoot: dir,
      ghPrList: () => [{ number: 23, state: 'OPEN', headRefName: 'feat/x' }],
    });
    const current = captureBoundaryBaseline({
      repoRoot: dir,
      ghPrList: () => [{ number: 23, state: 'MERGED', headRefName: 'feat/x' }],
    });

    const result = compareBoundary(baseline, current);

    assert.equal(result.clean, false);
    const violation = result.violations.find((v) => v.type === 'pr-state-changed');
    assert.equal(violation.before.state, 'OPEN');
    assert.equal(violation.after.state, 'MERGED');
  });
});

test('compareBoundary: gh-degrade — prs:null on either snapshot skips PR checks without throwing', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: () => null });
    const current = captureBoundaryBaseline({
      repoRoot: dir,
      ghPrList: () => [{ number: 1, state: 'OPEN', headRefName: 'x' }],
    });

    const result = compareBoundary(baseline, current);

    assert.equal(result.prsSkipped, true);
    assert.equal(result.violations.some((v) => v.type === 'pr-state-changed'), false);
  });
});

test('defaultGhPrList: degrades to null when the gh binary is unavailable (no network)', () => {
  withTmpRepo((dir) => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/nonexistent-bin-dir-for-post-run-boundary-test';
    try {
      const result = defaultGhPrList(dir);
      assert.equal(result, null);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test('formatBoundaryReport: reports CLEAN with no violations and pr-state checked', () => {
  const report = formatBoundaryReport({ clean: true, violations: [], prsSkipped: false });
  assert.match(report, /CLEAN/);
  assert.match(report, /pr-state: checked/);
});

test('formatBoundaryReport: renders each violation type and the gh-skipped line', () => {
  const report = formatBoundaryReport({
    clean: false,
    prsSkipped: true,
    violations: [
      { type: 'head-moved', before: 'aaa', after: 'bbb' },
      { type: 'tree-dirtied', path: 'stray.txt', before: null, after: '?? stray.txt' },
      {
        type: 'pr-state-changed',
        prNumber: 23,
        before: { number: 23, state: 'OPEN', headRefName: 'feat/x' },
        after: null,
      },
    ],
  });
  assert.match(report, /3 VIOLATION\(S\)/);
  assert.match(report, /head-moved: aaa -> bbb/);
  assert.match(report, /tree-dirtied: new dirt at stray\.txt/);
  assert.match(report, /pr-state-changed: #23 OPEN \(feat\/x\) -> \(absent\)/);
  assert.match(report, /pr-state: skipped \(gh unavailable\)/);
});
