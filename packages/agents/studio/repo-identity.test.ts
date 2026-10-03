/**
 * `resolveRepoCommonDir`/`cachedRepoCommonDir` against REAL on-disk repos
 * (bead `forge-8vfn.8.5.44`, row 208 follow-up — T1 review of the first cut:
 * "outside forgeRoot" is lexical, but every worktree of a repo shares its
 * refs and can sit anywhere on disk). `packages/kernel/forge-repo-git-fence.test.ts`
 * pins the DECISION against a faked `repoOf`; this file pins the real
 * filesystem walk the agents-side glue injects there.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachedRepoCommonDir, resolveRepoCommonDir } from './repo-identity.ts';

/** A throwaway identity so each `git` call is attributable and never touches
 *  the real operator identity — mirrors other tests' temp-repo fixtures. */
const GIT_ENV = ['-c', 'user.email=test@example.com', '-c', 'user.name=Test'];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', [...GIT_ENV, ...args], { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
}

/** A real repo with one commit (so `git worktree add` has a HEAD to branch
 *  from) — `git worktree add` against a totally empty repo needs `-b` on an
 *  unborn HEAD, which is a narrower case than any production forge root
 *  (forge's own repo always has history) is ever in. */
function makeRealRepo(dir: string): void {
  git(dir, ['init', '-q']);
  writeFileSync(join(dir, 'README.md'), 'placeholder\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'initial']);
}

describe('resolveRepoCommonDir — real repos', () => {
  it('a plain, non-worktree repo: `.git` IS the common dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-repo-identity-plain-'));
    try {
      makeRealRepo(dir);
      const id = resolveRepoCommonDir(dir);
      assert.equal(id, realpathSync(join(dir, '.git')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the MAIN worktree and a LINKED worktree (`git worktree add`) share the SAME identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-repo-identity-worktrees-'));
    try {
      const main = join(root, 'main');
      mkdirSync(main, { recursive: true });
      makeRealRepo(main);
      const linked = join(root, 'linked');
      git(main, ['worktree', 'add', '-q', '-b', 'linked-branch', linked]);

      const mainId = resolveRepoCommonDir(main);
      const linkedId = resolveRepoCommonDir(linked);
      assert.ok(mainId, 'the main worktree must resolve an identity');
      assert.equal(linkedId, mainId, 'a linked worktree must resolve to the SAME identity as its main worktree');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a NESTED but INDEPENDENT repo (its own `git init`) has a DIFFERENT identity from its parent', () => {
    const outer = mkdtempSync(join(tmpdir(), 'forge-repo-identity-nested-'));
    try {
      makeRealRepo(outer);
      const inner = join(outer, 'nested-project');
      mkdirSync(inner, { recursive: true });
      makeRealRepo(inner);

      const outerId = resolveRepoCommonDir(outer);
      const innerId = resolveRepoCommonDir(inner);
      assert.ok(outerId && innerId);
      assert.notEqual(innerId, outerId, 'a project repo nested inside the forge tree must be its OWN identity');
    } finally {
      rmSync(outer, { recursive: true, force: true });
    }
  });

  it('a directory outside any git repo resolves to null — never guessed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-repo-identity-norepo-'));
    try {
      assert.equal(resolveRepoCommonDir(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a sub-DIRECTORY of a repo (not the repo root itself) resolves to the SAME identity as the root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-repo-identity-subdir-'));
    try {
      makeRealRepo(dir);
      const sub = join(dir, 'a', 'b', 'c');
      mkdirSync(sub, { recursive: true });
      assert.equal(resolveRepoCommonDir(sub), resolveRepoCommonDir(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cachedRepoCommonDir — process-lifetime memoisation', () => {
  it('a repeat call for the SAME directory returns the cached identity without re-walking the filesystem', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-repo-identity-cache-'));
    try {
      makeRealRepo(dir);
      const first = cachedRepoCommonDir(dir);
      assert.ok(first, 'expected a resolvable identity');
      // Rename `.git` away: a FRESH walk would now fail (ENOENT) and a fresh
      // `resolveRepoCommonDir` call would return null. If the cached call
      // below still returns the SAME identity, it proves the cache served
      // the stored value rather than re-walking.
      renameSync(join(dir, '.git'), join(dir, '.git-moved-away'));
      const second = cachedRepoCommonDir(dir);
      assert.equal(second, first, 'the cached lookup must not re-walk — `.git` no longer exists at this path');
      assert.equal(resolveRepoCommonDir(dir), null, 'sanity: the UNCACHED resolver genuinely fails now `.git` is gone');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
