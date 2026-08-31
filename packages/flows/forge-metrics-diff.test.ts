/**
 * Regression test for computeDeliveredDiff (cli/forge-metrics.ts).
 *
 * Guards the recurring "report diff inverted on a pr-open / resumed cycle" bug:
 * the report's "What landed" section rendered files the cycle ADDED as
 * `deleted file mode` / `+0 −N` because the diff range tried `branch..main`
 * first (the inverted direction) for an unmerged branch. The fix anchors on
 * `merge-base(main, branch)..branch`, so additions read as insertions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeDeliveredDiff } from './forge-metrics.ts';

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

test('computeDeliveredDiff: an unmerged branch that ADDS a file reports insertions, not all-deletions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-diff-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    git(dir, ['config', 'user.email', 'test@forge']);
    git(dir, ['config', 'user.name', 'forge-test']);
    writeFileSync(join(dir, 'README.md'), 'base\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'base']);

    // A forge branch that adds a new file (the cycle's deliverable), unmerged.
    const branch = 'forge/INIT-test';
    git(dir, ['checkout', '-q', '-b', branch]);
    writeFileSync(join(dir, 'data_release_folder.go'), 'package release\n\nfunc DataReleaseFolder() {}\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'feat: add data source']);
    git(dir, ['checkout', '-q', 'main']); // report is generated while main is still at baseline

    const diff = computeDeliveredDiff(dir, branch);
    assert.ok(diff, 'expected a diff result');
    assert.ok(diff!.insertions > 0, `expected insertions > 0, got +${diff!.insertions} −${diff!.deletions}`);
    assert.equal(diff!.deletions, 0, 'a pure-addition branch must report zero deletions (not the inverted all-deletions)');
    assert.ok(diff!.filesChanged >= 1, 'expected at least one changed file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeDeliveredDiff: returns null for a non-git directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-diff-nogit-'));
  try {
    assert.equal(computeDeliveredDiff(dir, 'forge/whatever'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
