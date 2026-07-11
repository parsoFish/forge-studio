/**
 * Conflict-context injection (2026-07-12, live cycle 2026-07-11T14-57-10_
 * INIT-2026-07-11-csv-output-flag) — unit coverage for the WHY-it-conflicted
 * capture `mergeWiIntoCycle` now runs before `git merge --abort` discards the
 * conflicted state. Real git repos throughout (same fixture pattern as
 * `wi-merge-back.test.ts`), asserting the returned `conflict` field: the
 * unmerged files, the WI branch's own tip subject, the sibling commits that
 * touched those files since a supplied fork point, and the bounded
 * truncation (`MERGE_CONFLICT_MAX_FILES` / `MERGE_CONFLICT_MAX_SIBLING_COMMITS`)
 * that keeps a pathological conflict from producing an unbounded payload.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  mergeWiIntoCycle,
  MERGE_CONFLICT_MAX_FILES,
  MERGE_CONFLICT_MAX_SIBLING_COMMITS,
} from './wi-merge-back.ts';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

function setup(): { proj: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-merge-conflict-detail-'));
  const proj = join(root, 'proj');
  mkdirSync(proj, { recursive: true });
  sh(proj, ['init', '-q', '-b', 'main']);
  sh(proj, ['config', 'user.email', 't@forge']);
  sh(proj, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(proj, 'README.md'), 'base\n');
  sh(proj, ['add', '.']);
  sh(proj, ['commit', '-q', '-m', 'base']);
  sh(proj, ['checkout', '-q', '-b', 'cycle-branch']);
  return { proj, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('conflict detail: a single-file conflict reports the file, the WI branch tip, and no sibling commits without a startPointRef', () => {
  const { proj, cleanup } = setup();
  try {
    const startPoint = sh(proj, ['rev-parse', 'HEAD']).trim();

    // Diverge: cycle-branch changes shared.txt...
    writeFileSync(join(proj, 'shared.txt'), 'cycle change\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'cycle: change shared']);

    // ...and wi-branch, forked from the ORIGINAL tip, changes it differently.
    sh(proj, ['checkout', '-q', '-b', 'wi-branch', startPoint]);
    writeFileSync(join(proj, 'shared.txt'), 'wi change\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: distinctive commit subject']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'wi-branch', workItemId: 'WI-1' });

    assert.equal(result.merged, false);
    if (result.merged) return;
    assert.deepEqual(result.conflict.conflictingFiles, ['shared.txt']);
    assert.equal(result.conflict.filesTruncated, false);
    assert.equal(result.conflict.wiBranchTipSubject, 'wi: distinctive commit subject');
    // No startPointRef supplied to mergeWiIntoCycle — the sibling-commit
    // lookup must not run at all, not merely return empty by accident.
    assert.deepEqual(result.conflict.siblingCommits, []);
    assert.equal(result.conflict.commitsTruncated, false);
  } finally {
    cleanup();
  }
});

test('conflict detail: with a startPointRef, sibling commits that touched the conflicting file since the fork point are captured', () => {
  const { proj, cleanup } = setup();
  try {
    const startPoint = sh(proj, ['rev-parse', 'HEAD']).trim();

    writeFileSync(join(proj, 'shared.txt'), 'cycle change 1\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'cycle: first sibling change']);
    writeFileSync(join(proj, 'shared.txt'), 'cycle change 2\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'cycle: second sibling change']);
    // An unrelated commit that must NOT show up — it never touches shared.txt.
    writeFileSync(join(proj, 'unrelated.txt'), 'noise\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'cycle: unrelated commit']);

    sh(proj, ['checkout', '-q', '-b', 'wi-branch', startPoint]);
    writeFileSync(join(proj, 'shared.txt'), 'wi change\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: change']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const result = mergeWiIntoCycle({
      cycleWorktreePath: proj,
      wiBranch: 'wi-branch',
      workItemId: 'WI-2',
      startPointRef: startPoint,
    });

    assert.equal(result.merged, false);
    if (result.merged) return;
    assert.equal(result.conflict.siblingCommits.length, 2, 'both sibling commits touching shared.txt are captured, the unrelated commit is not');
    assert.ok(result.conflict.siblingCommits.every((c) => !c.includes('unrelated')));
    assert.ok(result.conflict.siblingCommits.some((c) => c.includes('first sibling change')));
    assert.ok(result.conflict.siblingCommits.some((c) => c.includes('second sibling change')));
    assert.equal(result.conflict.commitsTruncated, false);
  } finally {
    cleanup();
  }
});

test('conflict detail: bounded truncation on conflicting files', () => {
  const { proj, cleanup } = setup();
  try {
    const startPoint = sh(proj, ['rev-parse', 'HEAD']).trim();
    const fileCount = MERGE_CONFLICT_MAX_FILES + 5;
    const names = Array.from({ length: fileCount }, (_, i) => `file-${String(i).padStart(3, '0')}.txt`);

    for (const name of names) writeFileSync(join(proj, name), 'cycle\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'cycle: many files']);

    sh(proj, ['checkout', '-q', '-b', 'wi-branch', startPoint]);
    for (const name of names) writeFileSync(join(proj, name), 'wi\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: many files, all conflicting']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'wi-branch', workItemId: 'WI-3' });

    assert.equal(result.merged, false);
    if (result.merged) return;
    assert.equal(result.conflict.conflictingFiles.length, MERGE_CONFLICT_MAX_FILES, 'file list is bounded to MERGE_CONFLICT_MAX_FILES');
    assert.equal(result.conflict.filesTruncated, true, 'more files conflicted than the bound captured');
  } finally {
    cleanup();
  }
});

test('conflict detail: bounded truncation on sibling commits', () => {
  const { proj, cleanup } = setup();
  try {
    const startPoint = sh(proj, ['rev-parse', 'HEAD']).trim();
    const commitCount = MERGE_CONFLICT_MAX_SIBLING_COMMITS + 5;
    for (let i = 0; i < commitCount; i++) {
      writeFileSync(join(proj, 'shared.txt'), `cycle change ${i}\n`);
      sh(proj, ['add', '.']);
      sh(proj, ['commit', '-q', '-m', `cycle: change ${i}`]);
    }

    sh(proj, ['checkout', '-q', '-b', 'wi-branch', startPoint]);
    writeFileSync(join(proj, 'shared.txt'), 'wi change\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: change']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const result = mergeWiIntoCycle({
      cycleWorktreePath: proj,
      wiBranch: 'wi-branch',
      workItemId: 'WI-4',
      startPointRef: startPoint,
    });

    assert.equal(result.merged, false);
    if (result.merged) return;
    assert.equal(
      result.conflict.siblingCommits.length,
      MERGE_CONFLICT_MAX_SIBLING_COMMITS,
      'sibling commit list is bounded to MERGE_CONFLICT_MAX_SIBLING_COMMITS',
    );
    assert.equal(result.conflict.commitsTruncated, true, 'more sibling commits touched the file than the bound captured');
  } finally {
    cleanup();
  }
});

test('conflict detail: a non-conflict merge failure (unknown branch) captures an empty, non-throwing detail', () => {
  const { proj, cleanup } = setup();
  try {
    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'does-not-exist', workItemId: 'WI-5' });
    assert.equal(result.merged, false);
    if (result.merged) return;
    assert.deepEqual(result.conflict.conflictingFiles, []);
    assert.equal(result.conflict.filesTruncated, false);
    assert.equal(result.conflict.wiBranchTipSubject, '');
    assert.deepEqual(result.conflict.siblingCommits, []);
  } finally {
    cleanup();
  }
});
