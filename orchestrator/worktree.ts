/**
 * Thin wrappers over `git worktree`. Per ADR 006, we use git worktrees natively
 * for filesystem isolation per parallel work unit; this module exists only to
 * track lockfiles, heartbeat path, and the `gh`-friendly conventions.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export type WorktreeHandle = {
  path: string;
  branch: string;
  projectRepoPath: string;
};

export function add(opts: {
  projectRepoPath: string;
  branch: string;
  worktreesRoot: string;
  initiativeId: string;
}): WorktreeHandle {
  const path = resolve(opts.worktreesRoot, opts.initiativeId);
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });

  // Create branch off main and a worktree pointing at it.
  // -b creates the branch; if it already exists, we just point at it.
  const branchExists = (() => {
    try {
      execSync(`git -C "${opts.projectRepoPath}" rev-parse --verify ${opts.branch}`, {
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  })();

  const cmd = branchExists
    ? `git -C "${opts.projectRepoPath}" worktree add "${path}" ${opts.branch}`
    : `git -C "${opts.projectRepoPath}" worktree add -b ${opts.branch} "${path}"`;
  execSync(cmd, { stdio: 'pipe' });

  return { path, branch: opts.branch, projectRepoPath: opts.projectRepoPath };
}

export function remove(handle: WorktreeHandle, opts: { force?: boolean } = {}): void {
  const force = opts.force ? '--force' : '';
  try {
    execSync(`git -C "${handle.projectRepoPath}" worktree remove ${force} "${handle.path}"`, {
      stdio: 'pipe',
    });
  } catch {
    // Best-effort: a worktree that's already gone is fine.
  }
}

export function exists(path: string): boolean {
  return existsSync(path);
}

export function list(projectRepoPath: string): Array<{ path: string; branch: string }> {
  try {
    const output = execSync(`git -C "${projectRepoPath}" worktree list --porcelain`, {
      encoding: 'utf8',
    });
    const entries: Array<{ path: string; branch: string }> = [];
    let current: { path?: string; branch?: string } = {};
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path && current.branch) entries.push(current as { path: string; branch: string });
        current = { path: line.slice('worktree '.length) };
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice('branch refs/heads/'.length);
      }
    }
    if (current.path && current.branch) entries.push(current as { path: string; branch: string });
    return entries;
  } catch {
    return [];
  }
}
