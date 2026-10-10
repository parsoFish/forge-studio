/**
 * Bead forge-mfv5.1.27 — the Resume act on a parked fix round. Before it, a
 * plain requeue of the stranded shape wiped the worktree and deleted the
 * branch, and Studio Resume (`resumeFromIntegrate`) jumped to integrate and
 * skipped the pending gate-fix WI. Now: resume_from develop, everything kept —
 * and refused BY NAME, with nothing moved, once the branch head has moved.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRequeue } from '../../forge-requeue.ts';
import { parseManifest } from '../../manifest.ts';
import { readWorkItemsFromDir } from '../../work-item.ts';
import { FixRoundRefusedError } from '../../requeue-resume.ts';
import { FIX_BRANCH, FIX_INIT, plantStrandedFixRound } from '../test-fixtures/stranded-fix-round.ts';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
}

for (const resumeFromIntegrate of [false, true]) {
  test(`fix round (${resumeFromIntegrate ? 'Studio Resume' : 'plain requeue'}): resume_from develop, worktree + branch + delivered WIs kept`, () => {
    const root = mkdtempSync(join(tmpdir(), 'fix-round-requeue-'));
    try {
      const fx = plantStrandedFixRound(root, { withGit: true });
      const r = runRequeue(FIX_INIT, { forgeRoot: root, resumeFromIntegrate });
      assert.deepEqual([r.resumeDecision.resume, r.resumeDecision.resume ? r.resumeDecision.resume_from : null], [true, 'develop'], r.resumeDecision.reason);
      assert.equal(r.worktreeRemoved, false);
      assert.equal(r.branchDeleted, false);
      assert.equal(parseManifest(readFileSync(join(root, '_queue', 'pending', `${FIX_INIT}.md`), 'utf8')).resume_from, 'develop');
      assert.ok(existsSync(fx.worktree), 'the worktree is kept');
      assert.equal(git(fx.repo, ['rev-parse', FIX_BRANCH]), fx.deliveredHead, 'the branch is kept at the delivered head');
      const items = readWorkItemsFromDir(join(fx.worktree, '.forge', 'work-items')).items;
      assert.equal(items.filter((w) => w.status === 'complete').length, 5, 'the 5 delivered WIs stay complete');
      assert.deepEqual(items.filter((w) => w.status === 'pending').map((w) => w.work_item_id), ['WI-6']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('fix round: a moved branch head is refused by name, and nothing moves', () => {
  const root = mkdtempSync(join(tmpdir(), 'fix-round-refuse-'));
  try {
    const fx = plantStrandedFixRound(root, { withGit: true });
    writeFileSync(join(fx.worktree, 'stray.txt'), 'operator edit\n');
    git(fx.worktree, ['add', 'stray.txt']);
    git(fx.worktree, ['commit', '-q', '-m', 'stray']);
    const moved = git(fx.repo, ['rev-parse', FIX_BRANCH]);

    assert.throws(
      () => runRequeue(FIX_INIT, { forgeRoot: root, resumeFromIntegrate: true }),
      (err: unknown) => err instanceof FixRoundRefusedError
        && err.message.includes(`branch head moved since the last delivered work item (expected ${fx.deliveredHead.slice(0, 7)}, found ${moved.slice(0, 7)}) — not resuming`),
    );
    assert.ok(existsSync(fx.manifestPath), 'the manifest stays in ready-for-review');
    assert.ok(!existsSync(join(root, '_queue', 'pending', `${FIX_INIT}.md`)), 'nothing reaches pending');
    assert.ok(existsSync(fx.worktree), 'the worktree is untouched');
    assert.equal(git(fx.repo, ['rev-parse', FIX_BRANCH]), moved, 'the branch is untouched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
