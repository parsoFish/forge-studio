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
  runBoundaryCheck,
} from './lib/post-run-boundary.mjs';

/** `gh pr list` stand-in used everywhere PR-state isn't itself under test. */
const noPrs = (): null => null;

function initTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'post-run-boundary-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  return dir;
}

function withTmpRepo(fn: (dir: string) => void): void {
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

test('captureBoundaryBaseline: reports untracked files expanded, never collapsed to a directory', () => {
  withTmpRepo((dir) => {
    // git's default porcelain collapses a wholly-untracked directory to its
    // shallowest line (`?? demos/`); --untracked-files=all must expand it so
    // the ignore-prefix matching always sees real file paths.
    mkdirSync(join(dir, 'demos', 'e2e'), { recursive: true });
    writeFileSync(join(dir, 'demos', 'e2e', 'index.html'), '<html></html>');
    const snapshot = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    assert.match(snapshot.statusPorcelain, /\?\? demos\/e2e\/index\.html/);
    assert.doesNotMatch(snapshot.statusPorcelain, /\?\? demos\/$/m);
  });
});

test('captureBoundaryBaseline: requires repoRoot (fails fast, no silent default)', () => {
  assert.throws(
    // @ts-expect-error — intentional: proving runtime fail-fast on missing repoRoot
    () => captureBoundaryBaseline({ ghPrList: noPrs }),
    /repoRoot is required/,
  );
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
    if (!violation || violation.type !== 'tree-dirtied') throw new Error('expected a tree-dirtied violation');
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

test('compareBoundary: ignorePathPrefixes exempts files under a caller-declared surface', () => {
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

test('compareBoundary: a rogue write under an excused parent directory is still a violation', () => {
  withTmpRepo((dir) => {
    // verify-cycle excuses only ITS OWN demos/verify/<handle>/ output; a rogue
    // sibling under demos/verify/ must not ride along on the shared parent.
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    mkdirSync(join(dir, 'demos', 'verify', 'handle-a'), { recursive: true });
    writeFileSync(join(dir, 'demos', 'verify', 'handle-a', 'summary.json'), '{}');
    mkdirSync(join(dir, 'demos', 'verify', 'other'), { recursive: true });
    writeFileSync(join(dir, 'demos', 'verify', 'other', 'x'), 'rogue\n');
    const current = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });

    const result = compareBoundary(baseline, current, {
      ignorePathPrefixes: ['demos/verify/handle-a/'],
    });

    assert.equal(result.clean, false);
    const paths = result.violations.map((v) => (v.type === 'tree-dirtied' ? v.path : null));
    assert.deepEqual(paths, ['demos/verify/other/x']);
  });
});

test('compareBoundary: no bare string-prefix matches — demos/e is not excused by demos/e2e/', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    mkdirSync(join(dir, 'demos'), { recursive: true });
    writeFileSync(join(dir, 'demos', 'e'), 'not the same path\n');
    const current = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });

    const result = compareBoundary(baseline, current, { ignorePathPrefixes: ['demos/e2e/'] });

    assert.equal(result.clean, false);
  });
});

test('compareBoundary: prefixes normalize to a trailing slash (segment-exact, not string-prefix)', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    mkdirSync(join(dir, 'demos', 'e2e'), { recursive: true });
    writeFileSync(join(dir, 'demos', 'e2e', 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'demos', 'e2e-extra.txt'), 'sibling, different segment\n');
    const current = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });

    // Prefix given WITHOUT a trailing slash still means the directory, and
    // must not excuse the e2e-extra.txt sibling via bare string-prefixing.
    const result = compareBoundary(baseline, current, { ignorePathPrefixes: ['demos/e2e'] });

    assert.equal(result.clean, false);
    const paths = result.violations.map((v) => (v.type === 'tree-dirtied' ? v.path : null));
    assert.deepEqual(paths, ['demos/e2e-extra.txt']);
  });
});

test('compareBoundary: an ignore entry can name one exact file (e.g. brain/INDEX.md)', () => {
  withTmpRepo((dir) => {
    mkdirSync(join(dir, 'brain'), { recursive: true });
    writeFileSync(join(dir, 'brain', 'INDEX.md'), 'index v1\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'add index'], { cwd: dir });
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    writeFileSync(join(dir, 'brain', 'INDEX.md'), 'index v2 (regenerated)\n');
    writeFileSync(join(dir, 'brain', 'INDEX.md.bak'), 'not the exact file\n');
    const current = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });

    const result = compareBoundary(baseline, current, { ignorePathPrefixes: ['brain/INDEX.md'] });

    assert.equal(result.clean, false);
    const paths = result.violations.map((v) => (v.type === 'tree-dirtied' ? v.path : null));
    assert.deepEqual(paths, ['brain/INDEX.md.bak']);
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
    if (!violation || violation.type !== 'pr-state-changed') throw new Error('expected a pr-state-changed violation');
    assert.equal(violation.prNumber, 23);
    assert.equal(violation.before?.state, 'OPEN');
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
    if (!violation || violation.type !== 'pr-state-changed') throw new Error('expected a pr-state-changed violation');
    assert.equal(violation.before?.state, 'OPEN');
    assert.equal(violation.after?.state, 'MERGED');
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

// ---------------------------------------------------------------------------
// runBoundaryCheck (R5-01-F3fix Defect A) — e2e-journey.mjs's finally block
// used to run captureBoundaryBaseline/compareBoundary/formatBoundaryReport
// inline, buried among ~20 other cleanup steps; that wiring silently failed
// to execute on a real run. `runBoundaryCheck` is the single guaranteed,
// unit-tested call the harness now makes instead — these tests prove it
// actually prints the report and calls `check()`, not just that its
// underlying pieces work in isolation.
// ---------------------------------------------------------------------------

/** Capture console.log output for the duration of `fn`. */
function captureLog(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test('runBoundaryCheck: clean run prints CLEAN and calls check(true, ...)', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    const calls: Array<{ cond: boolean; msg: string }> = [];
    let result: ReturnType<typeof runBoundaryCheck>;

    const logged = captureLog(() => {
      result = runBoundaryCheck({
        baseline,
        repoRoot: dir,
        ignorePathPrefixes: [],
        check: (cond: boolean, msg: string) => calls.push({ cond, msg }),
      });
    });

    assert.equal(result!.clean, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cond, true);
    assert.match(calls[0].msg, /post-run boundary: forge repo\/PR state unchanged \(0 violation/);
    assert.ok(logged.some((line) => line.includes('[post-run boundary] CLEAN')), 'prints the CLEAN report');
  });
});

test('runBoundaryCheck: flags a head-moved violation, prints VIOLATION(S), and calls check(false, ...)', () => {
  withTmpRepo((dir) => {
    const baseline = captureBoundaryBaseline({ repoRoot: dir, ghPrList: noPrs });
    writeFileSync(join(dir, 'new.txt'), 'x\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'stray commit'], { cwd: dir });

    const calls: Array<{ cond: boolean; msg: string }> = [];
    let result: ReturnType<typeof runBoundaryCheck>;

    const logged = captureLog(() => {
      result = runBoundaryCheck({
        baseline,
        repoRoot: dir,
        ignorePathPrefixes: [],
        check: (cond: boolean, msg: string) => calls.push({ cond, msg }),
      });
    });

    assert.equal(result!.clean, false);
    assert.equal(result!.violations[0]?.type, 'head-moved');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cond, false);
    assert.ok(
      logged.some((line) => line.includes('1 VIOLATION(S)') && line.includes('head-moved')),
      'prints the violation report',
    );
  });
});

test('runBoundaryCheck: a failure to even run degrades to a failed check() rather than throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'post-run-boundary-notgit-'));
  try {
    const calls: Array<{ cond: boolean; msg: string }> = [];
    const result = runBoundaryCheck({
      baseline: { headSha: 'x'.repeat(40), statusPorcelain: '', prs: null },
      repoRoot: dir,
      ignorePathPrefixes: [],
      check: (cond: boolean, msg: string) => calls.push({ cond, msg }),
    });

    assert.equal(result, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cond, false);
    assert.match(calls[0].msg, /check failed to run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
