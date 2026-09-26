/**
 * git-residue-guard.test.ts — proof that the tracked-file test-run residue
 * guard's decision logic (M7-D handoff, T1's "cheap fence" ask) actually
 * flips.
 *
 * Drives `trackedPorcelainLines`/`newTrackedChanges`
 * (`./test-preload/git-residue-guard-core.mjs`) against a throwaway
 * `mkdtempSync` + `git init` repo — never this repo's own tree — so this
 * file cannot itself create the exact residue it is proving the guard
 * catches. The preload wiring (`./test-preload/git-residue-guard.mjs`) that
 * points the SAME two functions at the real repo root is exercised
 * separately, as a subprocess, by the mutation check recorded in this
 * initiative's report — not duplicated here, for the same reason
 * `logs-residue-guard.test.ts` gives: doing it from inside this process
 * would mean writing into the real tree from a unit test, exactly what this
 * guard exists to catch elsewhere.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { trackedPorcelainLines, newTrackedChanges } from './test-preload/git-residue-guard-core.mjs';

function withTmpRepo(body: (repo: string) => void): void {
  const repo = mkdtempSync(join(tmpdir(), 'git-residue-guard-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'git-residue-guard test'], { cwd: repo });
    writeFileSync(join(repo, 'tracked.txt'), 'clean\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: repo });
    body(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe('trackedPorcelainLines', () => {
  test('a clean tracked tree reports nothing', () => {
    withTmpRepo((repo) => {
      assert.deepEqual(trackedPorcelainLines(repo), new Set());
    });
  });

  test('an untracked file is invisible — -uno is the point, this guard is not for untracked residue', () => {
    withTmpRepo((repo) => {
      writeFileSync(join(repo, 'scratch.txt'), 'never added\n');
      assert.deepEqual(trackedPorcelainLines(repo), new Set());
    });
  });

  test('a modified tracked file is reported, with its status code', () => {
    withTmpRepo((repo) => {
      writeFileSync(join(repo, 'tracked.txt'), 'dirtied\n');
      const lines = trackedPorcelainLines(repo);
      assert.equal(lines.size, 1);
      const [line] = [...lines];
      assert.ok(line.endsWith('tracked.txt'), line);
      assert.match(line, /^ M /);
    });
  });
});

describe('newTrackedChanges', () => {
  test('identical before/after → no new changes (the clean-run case)', () => {
    const before = new Set([' M pre-existing-dirty.txt']);
    const after = new Set([' M pre-existing-dirty.txt']);
    assert.deepEqual(newTrackedChanges(before, after), []);
  });

  test('an after-only line is reported — the exact residue shape this guard exists for', () => {
    const before = new Set<string>();
    const after = new Set([' M studio/community/registry.yaml']);
    assert.deepEqual(newTrackedChanges(before, after), [' M studio/community/registry.yaml']);
  });

  test('sorted, for a deterministic report, when several appear at once', () => {
    const before = new Set<string>();
    const after = new Set([' M zzz.txt', ' M aaa.txt', ' M mmm.txt']);
    assert.deepEqual(newTrackedChanges(before, after), [' M aaa.txt', ' M mmm.txt', ' M zzz.txt']);
  });

  test('a status flip on a pre-existing dirty path is reported as new — the code, not just the path, must match', () => {
    const before = new Set([' M flip.txt']);
    const after = new Set(['MM flip.txt']);
    assert.deepEqual(newTrackedChanges(before, after), ['MM flip.txt']);
  });

  test('a line removed between before and after is not "new" — only appearances are reported', () => {
    const before = new Set([' M torn-down.txt']);
    const after = new Set<string>();
    assert.deepEqual(newTrackedChanges(before, after), []);
  });
});

describe('end to end against a real throwaway repo (the guard\'s own before/after shape)', () => {
  test('fails (reports a new line) when a test-shaped write dirties a tracked file after the before-snapshot', () => {
    withTmpRepo((repo) => {
      const before = trackedPorcelainLines(repo);
      writeFileSync(join(repo, 'tracked.txt'), 'a suite wrote here\n');
      const after = trackedPorcelainLines(repo);
      assert.deepEqual(newTrackedChanges(before, after), [' M tracked.txt']);
    });
  });

  test('passes (reports nothing) when nothing new is dirtied', () => {
    withTmpRepo((repo) => {
      const before = trackedPorcelainLines(repo);
      writeFileSync(join(repo, 'scratch.txt'), 'untracked, irrelevant\n');
      const after = trackedPorcelainLines(repo);
      assert.deepEqual(newTrackedChanges(before, after), []);
    });
  });
});
