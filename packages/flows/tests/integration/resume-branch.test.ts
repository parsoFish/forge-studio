/**
 * forge-mfv5.1.47 (P0, D-06) — a resume settles its initiative branch from git
 * alone: the local branch as is, a MISSING one recreated from origin (never
 * from main), and a refusal by name — listing the shas — when local and origin
 * disagree. Real repos: a bare origin, a clone, main moved past the branch so
 * "recreated from HEAD/main" and "recreated from origin" are different shas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decideResumeBranch, ensureResumeBranch } from '../../resume-branch.ts';
import { add as worktreeAdd } from '../../worktree.ts';

const B = 'forge/INIT-2026-10-16-resume-branch';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
}
const commit = (cwd: string, msg: string): string => (git(cwd, ['commit', '-q', '--allow-empty', '-m', msg]), git(cwd, ['rev-parse', 'HEAD']));

/** origin (bare) + clone: main has 2 commits past the branch point; the branch has 1 pushed commit. */
function world(): { dir: string; repo: string; pushed: string; main: string } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-resume-branch-'));
  const bare = join(dir, 'origin.git');
  const repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, repo], { stdio: 'pipe' });
  git(repo, ['checkout', '-q', '-b', 'main']);
  commit(repo, 'base');
  git(repo, ['branch', B]);
  git(repo, ['checkout', '-q', B]);
  const pushed = commit(repo, 'wi(WI-1): merge');
  git(repo, ['push', '-q', 'origin', 'main', B]);
  git(repo, ['checkout', '-q', 'main']);
  commit(repo, 'other initiative merged');
  const main = commit(repo, 'another');
  return { dir, repo, pushed, main };
}

test('resume: a MISSING local branch is recreated from origin/<branch> — the pushed work, never main', () => {
  const w = world();
  try {
    git(w.repo, ['branch', '-D', B]);
    const r = ensureResumeBranch({ projectRepoPath: w.repo, branch: B });
    assert.deepEqual(r, { ok: true, action: 'recreate-from-origin', sha: w.pushed });
    assert.equal(git(w.repo, ['rev-parse', `refs/heads/${B}`]), w.pushed, 'the local branch is the pushed tip');
    assert.notEqual(git(w.repo, ['rev-parse', `refs/heads/${B}`]), w.main, 'not main / HEAD');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('resume: a local branch AHEAD of origin is refused by name listing the unpushed shas, and is left untouched', () => {
  const w = world();
  try {
    git(w.repo, ['checkout', '-q', B]);
    const a = commit(w.repo, 'unpushed 1');
    const b = commit(w.repo, 'unpushed 2');
    git(w.repo, ['checkout', '-q', 'main']);
    const r = ensureResumeBranch({ projectRepoPath: w.repo, branch: B });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.reason, /ahead of origin\/forge\/INIT-2026-10-16-resume-branch by 2 unpushed commit\(s\)/);
    assert.ok(r.reason.includes(a.slice(0, 12)) && r.reason.includes(b.slice(0, 12)), 'both unpushed shas named');
    assert.equal(git(w.repo, ['rev-parse', `refs/heads/${B}`]), b, 'never reset');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('resume: origin AHEAD of the local branch is refused naming origin\'s shas (never overwritten by a later push)', () => {
  const w = world();
  try {
    git(w.repo, ['checkout', '-q', B]);
    const extra = commit(w.repo, 'pushed from elsewhere');
    git(w.repo, ['push', '-q', 'origin', B]);
    git(w.repo, ['checkout', '-q', 'main']);
    git(w.repo, ['branch', '-f', B, w.pushed]);
    const r = ensureResumeBranch({ projectRepoPath: w.repo, branch: B });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.reason.includes(extra.slice(0, 12)), 'origin-only sha named');
    assert.equal(git(w.repo, ['rev-parse', `refs/heads/${B}`]), w.pushed);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('resume: local == origin → the local branch is used as is', () => {
  const w = world();
  try {
    assert.deepEqual(ensureResumeBranch({ projectRepoPath: w.repo, branch: B }), { ok: true, action: 'use-local', sha: w.pushed });
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('resume: no local branch and none on origin → refused by name, nothing created', () => {
  const w = world();
  try {
    const other = 'forge/INIT-2026-10-16-never-existed';
    const r = ensureResumeBranch({ projectRepoPath: w.repo, branch: other });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /nothing to resume from; a resume never recreates the branch from main/);
    assert.equal(git(w.repo, ['branch', '--list', other]), '', 'no branch created');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('resume: a never-pushed branch in a repo with no origin remote is used as is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-resume-branch-noorigin-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    commit(dir, 'base');
    git(dir, ['branch', B]);
    git(dir, ['checkout', '-q', B]);
    const tipSha = commit(dir, 'local only');
    git(dir, ['checkout', '-q', 'main']);
    assert.deepEqual(ensureResumeBranch({ projectRepoPath: dir, branch: B }), { ok: true, action: 'use-local', sha: tipSha });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resume: an origin remote that cannot be read is UNKNOWN — refused, never treated as absent', () => {
  const w = world();
  try {
    git(w.repo, ['remote', 'set-url', 'origin', join(w.dir, 'gone.git')]);
    git(w.repo, ['branch', '-D', B]);
    const r = ensureResumeBranch({ projectRepoPath: w.repo, branch: B });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /could not read origin\/.*refusing rather than assuming absent/);
    assert.equal(git(w.repo, ['branch', '--list', B]), '', 'nothing recreated on UNKNOWN');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('resume: an unreadable origin with the local branch present uses it as is, naming the unknown origin (the entry rebase fetch refuses next)', () => {
  const w = world();
  try {
    git(w.repo, ['remote', 'set-url', 'origin', join(w.dir, 'gone.git')]);
    const r = ensureResumeBranch({ projectRepoPath: w.repo, branch: B });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.sha, w.pushed);
      assert.match(r.originUnknown ?? '', /could not read origin\//);
    }
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('decideResumeBranch: the decision table', () => {
  const s = (x: string): string => x.repeat(40);
  assert.deepEqual(decideResumeBranch(B, { local: null, origin: s('a'), localOnly: [], originOnly: [] }), { action: 'recreate-from-origin', sha: s('a') });
  assert.equal(decideResumeBranch(B, { local: null, origin: null, localOnly: [], originOnly: [] }).action, 'refuse');
  assert.deepEqual(decideResumeBranch(B, { local: s('b'), origin: null, localOnly: [], originOnly: [] }), { action: 'use-local', sha: s('b') });
  assert.deepEqual(decideResumeBranch(B, { local: s('b'), origin: s('b'), localOnly: [], originOnly: [] }), { action: 'use-local', sha: s('b') });
  assert.equal(decideResumeBranch(B, { local: s('b'), origin: s('a'), localOnly: [s('b')], originOnly: [] }).action, 'refuse');
  assert.equal(decideResumeBranch(B, { local: s('b'), origin: s('a'), localOnly: [], originOnly: [s('a')] }).action, 'refuse');
  assert.equal(decideResumeBranch(B, { local: s('b'), origin: s('a'), localOnly: [s('b')], originOnly: [s('a')] }).action, 'refuse');
});

test('worktree.add on a resume: a missing branch throws by name — never `-b` from HEAD', () => {
  const w = world();
  try {
    git(w.repo, ['branch', '-D', B]);
    assert.throws(
      () => worktreeAdd({ projectRepoPath: w.repo, branch: B, worktreesRoot: join(w.dir, 'wts'), initiativeId: 'INIT-2026-10-16-resume-branch', resume: true }),
      /a resume never creates it from HEAD/,
    );
    assert.equal(git(w.repo, ['branch', '--list', B]), '', 'no branch created');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('worktree.add on a resume: an existing unregistered directory (it may hold .forge scratch) is refused, never removed', () => {
  const w = world();
  try {
    const at = join(w.dir, 'wts', 'INIT-2026-10-16-resume-branch');
    mkdirSync(join(at, '.forge', 'work-items'), { recursive: true });
    writeFileSync(join(at, '.forge', 'work-items', 'WI-1.md'), 'scratch');
    assert.throws(
      () => worktreeAdd({ projectRepoPath: w.repo, branch: B, worktreesRoot: join(w.dir, 'wts'), initiativeId: 'INIT-2026-10-16-resume-branch', resume: true }),
      /is never removed/,
    );
    assert.ok(existsSync(join(at, '.forge', 'work-items', 'WI-1.md')), 'the scratch survives');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});
