/**
 * cascade-v4 #4: rebasePreservedBranchOntoMain — on a resume, rebase the
 * preserved initiative branch onto current main. Hermetic real-git repos (no
 * origin, so the force-push path is a no-op).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rebasePreservedBranchOntoMain } from './pr.ts';

function gitRepo(): { dir: string; git: (args: string[]) => string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-rebase-'));
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' }).toString();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'a.txt'), 'base\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  return { dir, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('rebasePreservedBranchOntoMain: no divergence ⇒ no-op (ok, rebased:false)', () => {
  const r = gitRepo();
  try {
    r.git(['checkout', '-q', '-b', 'init/x']);
    writeFileSync(join(r.dir, 'b.txt'), 'feature\n');
    r.git(['add', '-A']);
    r.git(['commit', '-q', '-m', 'wi']);
    const res = rebasePreservedBranchOntoMain(r.dir);
    assert.equal(res.ok, true);
    assert.equal(res.rebased, false);
  } finally {
    r.cleanup();
  }
});

test('rebasePreservedBranchOntoMain: main moved (non-conflicting) ⇒ clean rebase', () => {
  const r = gitRepo();
  try {
    r.git(['checkout', '-q', '-b', 'init/x']);
    writeFileSync(join(r.dir, 'b.txt'), 'feature\n');
    r.git(['add', '-A']);
    r.git(['commit', '-q', '-m', 'wi']);
    // Another cycle merged to main during the "stall": a non-conflicting file.
    r.git(['checkout', '-q', 'main']);
    writeFileSync(join(r.dir, 'c.txt'), 'other cycle\n');
    r.git(['add', '-A']);
    r.git(['commit', '-q', '-m', 'other']);
    r.git(['checkout', '-q', 'init/x']);

    const res = rebasePreservedBranchOntoMain(r.dir);
    assert.equal(res.ok, true);
    assert.equal(res.rebased, true);
    // main is now an ancestor of HEAD (the close invariant would pass), and the
    // branch carries the other cycle's file.
    assert.doesNotThrow(() => r.git(['merge-base', '--is-ancestor', 'main', 'HEAD']));
    assert.ok(existsSync(join(r.dir, 'c.txt')));
    assert.ok(existsSync(join(r.dir, 'b.txt')));
  } finally {
    r.cleanup();
  }
});

test('rebasePreservedBranchOntoMain: conflicting main ⇒ abort + clear resume-needs-rebase reason', () => {
  const r = gitRepo();
  try {
    r.git(['checkout', '-q', '-b', 'init/x']);
    writeFileSync(join(r.dir, 'a.txt'), 'branch change\n');
    r.git(['add', '-A']);
    r.git(['commit', '-q', '-m', 'wi edits a.txt']);
    r.git(['checkout', '-q', 'main']);
    writeFileSync(join(r.dir, 'a.txt'), 'main change\n');
    r.git(['add', '-A']);
    r.git(['commit', '-q', '-m', 'main edits a.txt']);
    r.git(['checkout', '-q', 'init/x']);

    const res = rebasePreservedBranchOntoMain(r.dir);
    assert.equal(res.ok, false);
    assert.match(res.reason ?? '', /conflict|manual rebase/i);
    // The rebase was aborted — no rebase in progress, branch content intact.
    assert.doesNotThrow(() => r.git(['rev-parse', '--verify', 'HEAD']));
    const status = r.git(['status', '--porcelain']);
    assert.equal(status.trim(), '', 'working tree clean after abort (no half-applied rebase)');
  } finally {
    r.cleanup();
  }
});
