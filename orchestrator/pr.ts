/**
 * PR create + merge — the only place forge shells `gh pr ...`.
 *
 * Extracted from cycle.ts (Phase 3 simplification) so the reviewer's
 * responsibility shrinks to assess + demo + open-PR, and the PR/merge
 * boundary is one named module. The create/merge split lets bench-mode
 * use a `gh` shim that records the operations locally without touching
 * real GitHub.
 */

import { execFileSync } from 'node:child_process';

/**
 * Best-effort PR creation via `gh pr create`. Returns the PR URL on success,
 * or null on failure. The reviewer's PR-description draft lives at
 * `<worktree>/.forge/pr-description.md` and is passed via `--body-file`.
 *
 * Pushes the local branch to the remote first; `gh pr create` requires the
 * branch to exist on origin. W4 trial caught this — pre-fix, openPullRequest
 * called `gh pr create` without a push, which fails with "no pull requests
 * found" since the branch wasn't published.
 */
export function openPullRequest(
  worktreePath: string,
  prDescriptionPath: string,
  title: string,
): string | null {
  try {
    // Determine the current branch in the worktree.
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    if (!branch || branch === 'HEAD') return null;

    // Push to origin (set-upstream so gh pr create knows the head ref).
    // Failures here propagate to the catch — a non-pushable branch is a
    // genuine merge blocker, not a soft warning.
    execFileSync('git', ['push', '--set-upstream', 'origin', branch], {
      cwd: worktreePath,
      stdio: 'pipe',
    });

    const out = execFileSync(
      'gh',
      ['pr', 'create', '--body-file', prDescriptionPath, '--title', title],
      { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' },
    );
    const match = out.match(/https:\S+/);
    return match ? match[0] : out.trim() || null;
  } catch (err) {
    // Surface the failure on stderr so the operator sees what went wrong;
    // openPullRequest's nullable return is otherwise opaque.
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    if (stderr) process.stderr.write(`[openPullRequest] ${stderr}\n`);
    else if (e.message) process.stderr.write(`[openPullRequest] ${e.message}\n`);
    return null;
  }
}

/**
 * Best-effort `gh pr merge` for the approved PR. Returns true on success.
 *
 * Notably does NOT pass `--delete-branch`: that flag makes `gh` switch the
 * project repo's HEAD to main and `git branch -D` the merged branch, which
 * fails when the project repo already has main checked out at
 * `projects/<name>/` (a forge worktree was added off the same repo). Branch
 * cleanup is owned by `worktree.cleanup()` in the scheduler's finally
 * block (F-09) — local branch deleted there, remote branch lingers
 * unless the GitHub repo has "auto-delete head branches" enabled.
 */
export function mergePullRequest(worktreePath: string): boolean {
  try {
    execFileSync('gh', ['pr', 'merge', '--merge'], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    return true;
  } catch (err) {
    // Surface the stderr for diagnostic visibility — the orchestrator's
    // event-log captures this via the merge-failed event_type.
    const e = err as { stderr?: Buffer | string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    if (stderr) process.stderr.write(`[mergePullRequest] ${stderr}\n`);
    return false;
  }
}
