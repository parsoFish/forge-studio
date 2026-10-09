/**
 * Real-git fixtures for a project-repo Save against an origin (forge-mfv5.1.22):
 * a work repo whose origin is a BARE repo — optionally behind a pre-receive hook
 * that refuses refs/heads/main as GitHub's protected-branch rule does — reached
 * through a github.com URL rewritten by `url.<path>.insteadOf`, and a stub gh
 * runner answering with gh's real output shapes. No network.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commitStudioChange } from '../../project-repo-tx.ts';
import type { GhRunner } from '../../project-repo-save.ts';

export const GH_URL = 'https://github.com/acme/weave.git';
export const PR_URL = 'https://github.com/acme/weave/pull/7';

export const g = (dir: string, args: string[]): string => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const sha = (dir: string, ref: string): string => g(dir, ['rev-parse', ref]);
export const hasRef = (dir: string, ref: string): boolean => { try { g(dir, ['rev-parse', '--verify', '--quiet', ref]); return true; } catch { return false; } };

const PROTECTED_HOOK = `#!/bin/sh
[ -f ALLOW_MAIN ] && exit 0
while read old new ref; do
  if [ "$ref" = "refs/heads/main" ]; then
    echo "error: GH006: Protected branch update failed for refs/heads/main." >&2
    echo "error: Changes must be made through a pull request." >&2
    exit 1
  fi
done
exit 0
`;

export type Fixture = { root: string; work: string; origin: string };

/** A work repo on main (one commit, pushed) whose origin is a bare repo reached via a github.com URL. */
export function fixture(opts: { hook: boolean; githubUrl?: boolean } = { hook: true }): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'save-protected-'));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, ['config', 'user.email', 't@forge.dev']);
  g(work, ['config', 'user.name', 'Forge Test']);
  writeFileSync(join(work, 'README.md'), '# weave\n');
  g(work, ['add', 'README.md']);
  g(work, ['commit', '-q', '-m', 'init']);
  if (opts.githubUrl === false) {
    g(work, ['remote', 'add', 'origin', origin]);
  } else {
    g(work, ['remote', 'add', 'origin', GH_URL]);
    g(work, ['config', `url.${origin}.insteadOf`, GH_URL]);
  }
  g(work, ['push', '-q', 'origin', 'main']);
  g(work, ['fetch', '-q', 'origin']);
  if (opts.hook) {
    writeFileSync(join(origin, 'hooks', 'pre-receive'), PROTECTED_HOOK);
    chmodSync(join(origin, 'hooks', 'pre-receive'), 0o755);
  }
  return { root, work, origin };
}

/** Land a commit on origin/main as GitHub would when it merges the forge-studio PR. */
export function githubMergesPr(f: Fixture): string {
  const clone = join(f.root, 'gh-merge');
  execFileSync('git', ['clone', '-q', f.origin, clone]);
  g(clone, ['config', 'user.email', 'gh@github.com']);
  g(clone, ['config', 'user.name', 'GitHub']);
  g(clone, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from acme/forge-studio', 'origin/forge-studio']);
  writeFileSync(join(f.origin, 'ALLOW_MAIN'), '');
  g(clone, ['push', '-q', 'origin', 'main']);
  rmSync(join(f.origin, 'ALLOW_MAIN'));
  return sha(clone, 'HEAD');
}

/** One `gh pr list --json url,isCrossRepository,baseRefName,headRefName,headRefOid,headRepositoryOwner` row. */
export type PrRow = { url: string; isCrossRepository: boolean; baseRefName: string; headRefName: string; headRefOid: string; headRepositoryOwner: { login: string } };
export const prRow = (url: string, over: Partial<PrRow> = {}): PrRow => ({ url, isCrossRepository: false, baseRefName: 'main', headRefName: 'forge-studio', headRefOid: '0'.repeat(40), headRepositoryOwner: { login: 'acme' }, ...over });

export type GhState = { protection: boolean | 'fail'; open: PrRow[]; merged: PrRow[]; autoMerge: boolean; createFails?: boolean; calls: string[][] };

/** A stub gh: prints what gh prints (JSON for `--json`/`api`, the URL for `pr create`, gh's stderr on failure).
 *  `pr list` returns every row of the asked state — the filter under test is forge's, not gh's. */
export function stubGh(state: GhState): GhRunner {
  return (args) => {
    state.calls.push([...args]);
    const a = args.join(' ');
    if (a.startsWith('api repos/acme/weave/branches/main')) {
      if (state.protection === 'fail') return { ok: false, stderr: 'gh: Not Found (HTTP 404)\n' };
      return { ok: true, stdout: JSON.stringify({ name: 'main', commit: { sha: 'x' }, protected: state.protection, protection_url: 'https://api.github.com/repos/acme/weave/branches/main/protection' }) };
    }
    if (a.startsWith('pr list') && a.includes('--state open')) return { ok: true, stdout: JSON.stringify(state.open) };
    if (a.startsWith('pr list') && a.includes('--state merged')) return { ok: true, stdout: JSON.stringify(state.merged) };
    if (a.startsWith('pr create')) {
      if (state.createFails) return { ok: false, stderr: 'pull request create failed: GraphQL: Resource not accessible by integration (createPullRequest)\n' };
      state.open.push(prRow(PR_URL));
      return { ok: true, stdout: `${PR_URL}\n` };
    }
    if (a.startsWith('pr merge')) {
      if (!state.autoMerge) return { ok: false, stderr: 'GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)\n' };
      return { ok: true, stdout: '' };
    }
    return { ok: false, stderr: `unknown command "${args[0]}" for "gh"\n` };
  };
}
export const ghState = (over: Partial<GhState> = {}): GhState => ({ protection: true, open: [], merged: [], autoMerge: true, calls: [], ...over });

export function studioCommit(work: string, file = 'AGENTS.md'): void {
  writeFileSync(join(work, file), `# ${file}\n`);
  assert.equal(commitStudioChange(work, `docs: author ${file}`, [file]), true);
}

/** The gitweave state: two commits merged onto local main whose push was refused, no forge-studio. */
export function stranded(f: Fixture): { head: string; originMain: string } {
  for (const n of ['one', 'two']) {
    writeFileSync(join(f.work, `${n}.txt`), `${n}\n`);
    g(f.work, ['add', `${n}.txt`]);
    g(f.work, ['commit', '-q', '-m', `forge-studio: ${n}`]);
  }
  return { head: sha(f.work, 'main'), originMain: sha(f.work, 'origin/main') };
}

