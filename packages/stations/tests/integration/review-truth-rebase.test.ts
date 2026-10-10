/**
 * Bead forge-mfv5.1.30 — a resume's rebase must not erase the record the review
 * reads. The review scopes a D-20 fix work item by its `wi(<id>): merge` commit
 * (`review-truth.ts`); a plain `git rebase` onto a moved main flattens merges,
 * so a delivered fix would read "no delivery recorded" (MISSED) — the same
 * untruth by another path. Real temp git repos; no origin, so no push.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { rebasePreservedBranchOntoMain } from '@forge/flows';

import { recordedDeliveries } from '../../phases/review-truth.ts';

type Repo = { dir: string; git: (a: string[]) => string; commit: (f: string, c: string, m: string) => void; cleanup: () => void };

function repo(): Repo {
  const dir = mkdtempSync(join(tmpdir(), 'review-truth-rebase-'));
  const git = (a: string[]): string => execFileSync('git', a, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
  const commit = (f: string, c: string, m: string): void => {
    writeFileSync(join(dir, f), c);
    git(['add', '--', f]);
    git(['commit', '-q', '-m', m]);
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  commit('a.txt', 'base\n', 'base');
  commit('old_test.py', 'def test_x():\n    pass\n', 'an April spec');
  git(['checkout', '-q', '-b', 'forge/INIT-x']);
  // WI-7 delivered the way the dev loop delivers: its own branch, merged --no-ff.
  git(['checkout', '-q', '-b', 'wi/WI-7']);
  git(['rm', '-q', 'old_test.py']);
  commit('a.txt', 'fixed\n', 'fix: retire April specs');
  git(['checkout', '-q', 'forge/INIT-x']);
  git(['merge', '-q', '--no-ff', 'wi/WI-7', '-m', 'wi(WI-7): merge']);
  return { dir, git, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const gitOf = (r: Repo) => (args: string[]): { ok: boolean; out: string } => {
  try { return { ok: true, out: r.git(args) }; } catch { return { ok: false, out: '' }; }
};

test('a resume rebase onto a moved main keeps the wi(<id>): merge commit, so the review still finds what WI-7 delivered', () => {
  const r = repo();
  try {
    r.git(['checkout', '-q', 'main']);
    r.commit('other.txt', 'another cycle\n', 'feat: another cycle merged');
    r.git(['checkout', '-q', 'forge/INIT-x']);

    const res = rebasePreservedBranchOntoMain(r.dir);
    assert.deepEqual([res.ok, res.rebased], [true, true], JSON.stringify(res));
    assert.doesNotThrow(() => r.git(['merge-base', '--is-ancestor', 'main', 'HEAD']));
    const subjects = r.git(['log', '--format=%s', 'main..HEAD']).split('\n');
    assert.ok(subjects.includes('wi(WI-7): merge'), `the merge commit survives the rebase: ${JSON.stringify(subjects)}`);
    assert.deepEqual(recordedDeliveries(gitOf(r), 'main')?.get('WI-7')?.sort(), ['a.txt', 'old_test.py']);
  } finally {
    r.cleanup();
  }
});

test('a CONFLICTING main still aborts the rebase by name, leaving no rebase in progress', () => {
  const r = repo();
  try {
    r.git(['checkout', '-q', 'main']);
    r.commit('a.txt', 'main change\n', 'feat: conflicting cycle');
    r.git(['checkout', '-q', 'forge/INIT-x']);
    const head = r.git(['rev-parse', 'HEAD']).trim();

    const res = rebasePreservedBranchOntoMain(r.dir);
    assert.equal(res.ok, false);
    assert.equal(res.rebased, false);
    assert.match(res.reason ?? '', /rebase onto main conflicted — manual rebase required/);
    assert.equal(r.git(['rev-parse', 'HEAD']).trim(), head, 'the branch is left exactly where it was');
    assert.throws(() => r.git(['rev-parse', '--verify', '-q', 'REBASE_HEAD']), 'no rebase left in progress');
  } finally {
    r.cleanup();
  }
});
