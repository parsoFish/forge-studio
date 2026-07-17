/**
 * Project-repo write transaction (operator feedback R1, 2026-06-27).
 *
 * Every forge-UI change that touches a PROJECT repo (project.json, AGENTS.md,
 * .gitignore, roadmap.md, demo machinery, preflight-fix edits) is committed to a
 * single persistent `forge-studio` branch rather than left uncommitted in the
 * working tree (which is why "apply decision" silently lost its edits). Changes
 * accumulate on that one branch across many forge-UI actions; a single "Save"
 * (`saveProjectRepo`) merges it into the default branch — no CI, since these are
 * forge-controlled, non-structural files — and pushes, so cycles branching from
 * origin/main (and GitHub) see the configuration.
 *
 * Pure git wrappers (execFileSync) — no orchestrator deps — so they unit-test
 * against a throwaway repo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';

import { gitIdentityConfigArgs, ORCHESTRATOR_GIT_IDENTITY } from './config.ts';

export const STUDIO_BRANCH = 'forge-studio';

/** Forge session/scratch dirs that must NEVER be committed into the project. */
const SCRATCH_EXCLUDES = ['_instructions', '_demo', '_preflight-fix', '_architect', '_project-brain', '.forge/work-items'];

function git(projectDir: string, args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('git', ['-C', projectDir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}

function branchExists(projectDir: string, branch: string): boolean {
  try {
    git(projectDir, ['rev-parse', '--verify', '--quiet', branch]);
    return true;
  } catch {
    return false;
  }
}

/**
 * True iff `projectDir` is itself a standalone git repo ROOT — not merely
 * nested somewhere inside an ancestor repo's working tree. `git rev-parse
 * --git-dir` alone is NOT sufficient: it succeeds for ANY directory nested
 * inside a repo (git walks upward to find `.git`), so a managed project with
 * no `.git` of its own (committed straight into the forge repo/worktree,
 * e.g. `projects/mdtoc`) would wrongly report `true` — and a caller that then
 * runs `git checkout <branch>` against it moves the ANCESTOR repo's HEAD
 * instead (the R5-01 dry-bridge Defect B class). Comparing the realpath of
 * `--show-toplevel` against the realpath of `projectDir` itself only passes
 * for a directory that IS its own repo root.
 */
export function isGitRepo(projectDir: string): boolean {
  if (!existsSync(projectDir)) return false;
  try {
    const toplevel = git(projectDir, ['rev-parse', '--show-toplevel']);
    return realpathSync(toplevel) === realpathSync(projectDir);
  } catch {
    return false;
  }
}

/** The repo's default branch (main|master), falling back to 'main'. */
export function defaultBranch(projectDir: string): string {
  for (const b of ['main', 'master']) {
    if (branchExists(projectDir, b)) return b;
  }
  return 'main';
}

function currentBranch(projectDir: string): string {
  return git(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true });
}

/**
 * Ensure the project repo is on the persistent `forge-studio` branch (created
 * from the default branch if it doesn't exist yet). No-op for a non-git dir.
 */
export function ensureStudioBranch(projectDir: string): void {
  if (!isGitRepo(projectDir)) return;
  if (currentBranch(projectDir) === STUDIO_BRANCH) return;
  if (branchExists(projectDir, STUDIO_BRANCH)) git(projectDir, ['checkout', STUDIO_BRANCH]);
  else git(projectDir, ['checkout', '-b', STUDIO_BRANCH, defaultBranch(projectDir)]);
}

/**
 * Stage + commit the forge-UI change onto `forge-studio`. With `paths`, stages
 * exactly those; otherwise stages everything EXCEPT forge scratch/session dirs.
 * Returns true iff a commit was made (false when nothing changed).
 */
export function commitStudioChange(projectDir: string, message: string, paths?: string[]): boolean {
  if (!isGitRepo(projectDir)) return false;
  ensureStudioBranch(projectDir);
  if (paths && paths.length > 0) {
    git(projectDir, ['add', '--', ...paths], { allowFail: true });
  } else {
    git(projectDir, ['add', '-A', '--', '.', ...SCRATCH_EXCLUDES.map((s) => `:(exclude)${s}`)], { allowFail: true });
  }
  const staged = git(projectDir, ['diff', '--cached', '--name-only'], { allowFail: true });
  if (!staged) return false;
  git(projectDir, [...gitIdentityConfigArgs(ORCHESTRATOR_GIT_IDENTITY), 'commit', '--no-verify', '-m', message]);
  return true;
}

/**
 * Run a synchronous write against the project repo, committed to `forge-studio`.
 * Ensures the branch first so the write lands there, runs `applyFn`, then commits.
 */
export function withStudioWrite<T>(projectDir: string, message: string, applyFn: () => T, paths?: string[]): T {
  ensureStudioBranch(projectDir);
  const result = applyFn();
  commitStudioChange(projectDir, message, paths);
  return result;
}

export type SaveResult = { merged: boolean; pushed: boolean; detail: string };

/**
 * "Save" the accumulated forge-UI changes: merge `forge-studio` into the default
 * branch (no CI), push to origin if present, then delete `forge-studio` and rest
 * on the default branch so the next batch starts fresh. Idempotent when there is
 * nothing pending.
 */
export function saveProjectRepo(projectDir: string): SaveResult {
  if (!isGitRepo(projectDir)) return { merged: false, pushed: false, detail: 'not a git repo' };
  if (!branchExists(projectDir, STUDIO_BRANCH)) {
    return { merged: false, pushed: false, detail: 'no pending forge-studio changes' };
  }
  const base = defaultBranch(projectDir);
  // Nothing to merge if forge-studio has no commits beyond base.
  const ahead = git(projectDir, ['rev-list', '--count', `${base}..${STUDIO_BRANCH}`], { allowFail: true });
  git(projectDir, ['checkout', base]);
  if (ahead === '0' || ahead === '') {
    git(projectDir, ['branch', '-D', STUDIO_BRANCH], { allowFail: true });
    return { merged: false, pushed: false, detail: 'no pending forge-studio changes' };
  }
  git(projectDir, [
    ...gitIdentityConfigArgs(ORCHESTRATOR_GIT_IDENTITY),
    'merge',
    '--no-ff',
    '--no-verify',
    '-m',
    'forge-studio: apply project configuration',
    STUDIO_BRANCH,
  ]);

  let pushed = false;
  let detail = `merged ${STUDIO_BRANCH} → ${base}`;
  const remotes = git(projectDir, ['remote'], { allowFail: true }).split('\n').filter(Boolean);
  if (remotes.includes('origin')) {
    try {
      git(projectDir, ['push', 'origin', base]);
      pushed = true;
      detail += ' + pushed to origin';
    } catch (err) {
      detail += ` (push failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'})`;
    }
  } else {
    detail += ' (no origin remote — local only)';
  }
  // Delete the studio branch; recreated from the merged base on the next write.
  git(projectDir, ['branch', '-D', STUDIO_BRANCH], { allowFail: true });
  return { merged: true, pushed, detail };
}

/** Whether the project repo has uncommitted forge-studio changes pending a save. */
export function hasPendingStudioChanges(projectDir: string): boolean {
  if (!isGitRepo(projectDir) || !branchExists(projectDir, STUDIO_BRANCH)) return false;
  const ahead = git(projectDir, ['rev-list', '--count', `${defaultBranch(projectDir)}..${STUDIO_BRANCH}`], { allowFail: true });
  return ahead !== '' && ahead !== '0';
}
