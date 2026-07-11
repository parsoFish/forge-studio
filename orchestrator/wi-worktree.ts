/**
 * Phase 4 step 4 — per-WI worktree bootstrap.
 *
 * Parallel work-item dev-loops each need their own git worktree so they
 * don't collide on the shared cycle worktree's working tree while running
 * concurrently. This module is a PURE helper: it creates/removes a sibling
 * worktree scoped to one work item. It does NOT decide *when* to create one
 * (the dispatcher) or invoke ralph — those are later steps.
 *
 * Layout: `<worktreesRoot>/<initiativeId>/wi/<workItemId>` — a SIBLING
 * subtree next to the cycle worktree (`<worktreesRoot>/<initiativeId>`),
 * never nested inside its working tree (git worktrees may not nest inside
 * another worktree's tracked working directory).
 *
 * Branch: `forge/<initiativeId>/wi/<workItemId>`, created at the EXPLICIT
 * `startPointRef` supplied by the caller (the cycle branch tip captured at
 * dispatch time) — never at whatever `HEAD` happens to be when this runs,
 * since parallel WI dispatch must not race on a moving ref.
 *
 * Mirrors orchestrator/worktree.ts's conventions: `execFileSync` with arg
 * arrays (no shell interpolation), self-heal-before-create, best-effort
 * remove. worktree.ts itself is untouched (its `add()`/`remove()` contracts
 * stay byte-identical) — this module creates the branch itself, then reuses
 * `add()` for the actual `git worktree add` + its own self-heal pass.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { add, remove, selfHealWorktreeState, type WorktreeHandle } from './worktree.ts';
import { linkProjectDeps } from './scheduler.ts';

export type WiWorktreeHandle = {
  path: string;
  branch: string;
};

/**
 * Compute the per-WI worktree path without touching the filesystem or git —
 * shared by createWiWorktree and callers that need to know the path ahead
 * of time (e.g. to check whether one is already present).
 */
export function wiWorktreePath(opts: {
  worktreesRoot: string;
  initiativeId: string;
  workItemId: string;
}): string {
  return resolve(opts.worktreesRoot, opts.initiativeId, 'wi', opts.workItemId);
}

export function wiBranchName(opts: { initiativeId: string; workItemId: string }): string {
  return `forge/${opts.initiativeId}/wi/${opts.workItemId}`;
}

/**
 * Removes any leftover worktree dir/registry entry AND branch at the
 * target path/name before a fresh create. A crashed prior run of the SAME
 * work item is the only legitimate source of a collision here (per-WI
 * branches are 1:1 scratch, never reused across runs) — so unlike
 * worktree.ts's silent selfHealWorktreeState, this logs loudly: a collision
 * means a prior run died mid-flight and evidence is being discarded.
 */
function selfHealWiCollision(opts: {
  projectRepoPath: string;
  path: string;
  branch: string;
}): void {
  if (existsSync(opts.path)) {
    console.warn(
      `[wi-worktree] stale worktree at ${opts.path} (crashed prior run?) — self-healing: remove + recreate`,
    );
  }
  selfHealWorktreeState(opts.projectRepoPath, opts.path);

  let branchPresent = false;
  try {
    execFileSync('git', ['-C', opts.projectRepoPath, 'rev-parse', '--verify', opts.branch], {
      stdio: 'pipe',
    });
    branchPresent = true;
  } catch {
    /* branch doesn't exist — nothing to heal */
  }
  if (branchPresent) {
    console.warn(
      `[wi-worktree] stale branch ${opts.branch} (crashed prior run?) — deleting so it can be recreated at the current start point`,
    );
    try {
      execFileSync('git', ['-C', opts.projectRepoPath, 'branch', '-D', opts.branch], {
        stdio: 'pipe',
      });
    } catch {
      /* best-effort — the branch-create step below will surface any real problem */
    }
  }
}

export function createWiWorktree(opts: {
  projectRepoPath: string;
  worktreesRoot: string;
  initiativeId: string;
  workItemId: string;
  /** The cycle branch tip at dispatch time — the WI branch is created here, not at HEAD. */
  startPointRef: string;
  /** The cycle worktree's working tree, to copy untracked `.forge/work-items/` from. */
  cycleWorktreePath: string;
}): WiWorktreeHandle {
  const path = wiWorktreePath(opts);
  const branch = wiBranchName(opts);

  selfHealWiCollision({ projectRepoPath: opts.projectRepoPath, path, branch });

  // Create the branch at the explicit start point FIRST. `worktree.ts`'s
  // `add()` only checks out a branch by name (new or existing) — it has no
  // notion of an explicit start point — so we create the ref ourselves and
  // let `add()` see an already-existing branch and check it out as-is. This
  // keeps worktree.ts's contract completely untouched.
  execFileSync('git', ['-C', opts.projectRepoPath, 'branch', branch, opts.startPointRef], {
    stdio: 'pipe',
  });

  // Reuse add(): its path formula is `resolve(worktreesRoot, initiativeId)`,
  // so passing the compound `<initiativeId>/wi/<workItemId>` as its
  // `initiativeId` lands on exactly the sibling path computed above, and we
  // get its own self-heal + branch-exists handling for free.
  const handle: WorktreeHandle = add({
    projectRepoPath: opts.projectRepoPath,
    branch,
    worktreesRoot: opts.worktreesRoot,
    initiativeId: join(opts.initiativeId, 'wi', opts.workItemId),
  });

  linkProjectDeps(opts.projectRepoPath, handle.path);

  // `git worktree add` only checks out TRACKED files. `.forge/work-items/`
  // is gitignored (the PM's per-cycle scratch, written to the cycle
  // worktree) — without this copy the per-WI worktree's dev-loop has no
  // spec to read. Copy the whole dir; best-effort like the rest of the
  // ephemeral-artefact copies in cycle.ts (a missing source is not an error
  // here — it just means this WI's worktree carries no spec yet).
  const wiSrc = resolve(opts.cycleWorktreePath, '.forge', 'work-items');
  if (existsSync(wiSrc)) {
    const wiDst = resolve(handle.path, '.forge', 'work-items');
    mkdirSync(dirname(wiDst), { recursive: true });
    cpSync(wiSrc, wiDst, { recursive: true, force: true });
  }

  return { path: handle.path, branch: handle.branch };
}

/**
 * Per-WI worktrees are pure scratch: their outcome lives on in the cycle
 * branch after merge-back (or in the event log, on failure) — never in the
 * per-WI worktree itself. Removal is therefore always force + best-effort;
 * an already-gone worktree/branch is success, not an error.
 */
export function removeWiWorktree(opts: {
  projectRepoPath: string;
  path: string;
  branch: string;
  deleteBranch?: boolean;
}): void {
  const handle: WorktreeHandle = {
    path: opts.path,
    branch: opts.branch,
    projectRepoPath: opts.projectRepoPath,
  };
  remove(handle, { force: true });
  try {
    execFileSync('git', ['-C', opts.projectRepoPath, 'worktree', 'prune'], { stdio: 'pipe' });
  } catch {
    /* non-fatal */
  }
  if (opts.deleteBranch) {
    try {
      execFileSync('git', ['-C', opts.projectRepoPath, 'branch', '-D', opts.branch], {
        stdio: 'pipe',
      });
    } catch {
      /* branch already deleted, or never existed */
    }
  }
}
