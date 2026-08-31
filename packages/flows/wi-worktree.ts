/**
 * Phase 4 step 4 — per-WI worktree bootstrap.
 *
 * Parallel work-item dev-loops each need their own git worktree so they
 * don't collide on the shared cycle worktree's working tree while running
 * concurrently. This module is a PURE helper: it creates/removes a sibling
 * worktree scoped to one work item. It does NOT decide *when* to create one
 * (the dispatcher) or invoke ralph — those are later steps.
 *
 * Layout: `<worktreesRoot>/wi/<initiativeId>/<workItemId>` — a SIBLING
 * subtree next to the cycle worktree (`<worktreesRoot>/<initiativeId>`,
 * see `scheduler.ts`), never nested inside its working tree (git worktrees
 * may not live inside another worktree's own working directory — and
 * concretely, a scratch dir nested under the cycle worktree gets swept into
 * ANY `git add -A`/`git add .` run against the cycle worktree as a stray
 * gitlink, corrupting its history). The `wi/` segment sits directly under
 * `worktreesRoot`, a TRUE sibling of `<initiativeId>` rather than a child of
 * it — `<worktreesRoot>/<initiativeId>/wi/<workItemId>` (the earlier shape)
 * would have been nested inside the cycle worktree's own directory, since
 * the cycle worktree's path IS `<worktreesRoot>/<initiativeId>`.
 *
 * Branch: `forge/wi/<initiativeId>/<workItemId>`, created at the EXPLICIT
 * `startPointRef` supplied by the caller (the cycle branch tip captured at
 * dispatch time) — never at whatever `HEAD` happens to be when this runs,
 * since parallel WI dispatch must not race on a moving ref.
 *
 * NOTE on the `wi/` segment placement: the cycle/initiative branch itself is
 * literally named `forge/<initiativeId>` (see `scheduler.ts`). Git stores
 * refs as paths, and a single ref cannot be both a leaf AND a directory
 * prefix — so `forge/<initiativeId>/wi/<workItemId>` would collide with the
 * existing `forge/<initiativeId>` leaf ref ("cannot lock ref ... exists").
 * Nesting `wi/` directly under `forge/` instead (`forge/wi/<initiativeId>/…`)
 * keeps every WI branch a sibling of the initiative's OWN leaf ref rather
 * than a child of it — collision-free because `initiativeId` is validated to
 * always start with `INIT-` (see `work-item.ts`/`manifest.ts`), so it can
 * never literally equal `wi`.
 *
 * Mirrors orchestrator/worktree.ts's conventions: `execFileSync` with arg
 * arrays (no shell interpolation), self-heal-before-create, best-effort
 * remove. worktree.ts itself is untouched (its `add()`/`remove()` contracts
 * stay byte-identical) — this module creates the branch itself, then reuses
 * `add()` for the actual `git worktree add` + its own self-heal pass.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { add, list, remove, selfHealWorktreeState, type WorktreeHandle } from './worktree.ts';
import { linkProjectDeps } from './scheduler.ts';
import { createLogger } from './logging.ts';

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
  return resolve(opts.worktreesRoot, 'wi', opts.initiativeId, opts.workItemId);
}

export function wiBranchName(opts: { initiativeId: string; workItemId: string }): string {
  return `forge/wi/${opts.initiativeId}/${opts.workItemId}`;
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
  // so passing the compound `wi/<initiativeId>/<workItemId>` as its
  // `initiativeId` lands on exactly the sibling path computed above, and we
  // get its own self-heal + branch-exists handling for free.
  const handle: WorktreeHandle = add({
    projectRepoPath: opts.projectRepoPath,
    branch,
    worktreesRoot: opts.worktreesRoot,
    initiativeId: join('wi', opts.initiativeId, opts.workItemId),
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

export type PruneStaleWiWorktreesResult = {
  prunedPaths: string[];
  prunedBranches: string[];
};

/**
 * Phase 4 step 9 (plan risk R7) — self-heal for leftover per-WI worktrees.
 *
 * A mid-fan-out crash (or an operator `forge requeue`) can leave per-WI
 * worktrees/branches behind for an initiative: the cycle-level preserve
 * logic (`scheduler.ts`, ADR-019) protects only the CYCLE worktree.
 * Per-WI worktrees are pure scratch — merged WI work already lives on the
 * cycle branch after merge-back, and any UNMERGED work from a crashed
 * attempt is simply re-run by the next attempt's own dev-loop dispatch —
 * so a leftover here can only cause harm (confusing worktree-state
 * inference, or colliding with the next attempt's `createWiWorktree`
 * call), never lose anything of value.
 *
 * Called once per cycle start/requeue, BEFORE the new attempt dispatches
 * any of its own per-WI worktrees (see `scheduler.ts`, alongside
 * `linkProjectDeps`/`decideWorktreeStrategy`) — `createWiWorktree`'s own
 * per-call `selfHealWiCollision` stays as a second line of defense for
 * whatever this sweep misses.
 *
 * Strictly scoped to `initiativeId`: worktrees/branches belonging to a
 * DIFFERENT initiative are never touched, even when they are themselves
 * leftover — each initiative's sweep only prunes its own scratch.
 *
 * A no-op (nothing to prune) never throws and never logs — the event log
 * would otherwise fill with a "pruned nothing" entry on every ordinary
 * cycle start.
 */
export function pruneStaleWiWorktrees(opts: {
  projectRepoPath: string;
  worktreesRoot: string;
  initiativeId: string;
  /** JSONL event-log root; same convention/default as `logging.ts`'s `createLogger`. */
  logsRoot?: string;
}): PruneStaleWiWorktreesResult {
  const prunedPaths: string[] = [];
  const prunedBranches: string[] = [];

  const wiRoot = resolve(opts.worktreesRoot, 'wi', opts.initiativeId);
  const registered = list(opts.projectRepoPath).filter((w) => {
    const p = resolve(w.path);
    return p === wiRoot || p.startsWith(wiRoot + sep);
  });
  for (const entry of registered) {
    removeWiWorktree({
      projectRepoPath: opts.projectRepoPath,
      path: entry.path,
      branch: entry.branch,
      deleteBranch: true,
    });
    prunedPaths.push(entry.path);
    prunedBranches.push(entry.branch);
  }

  // Orphan branches: a per-WI branch can survive with no registered
  // worktree left to key off — e.g. the worktree dir was already gone and
  // an earlier `worktree prune` (anyone's) reclaimed the registry entry
  // while the branch, a wholly separate git object, was untouched. Sweep
  // by naming convention so the next `createWiWorktree` for this
  // initiative never hits "branch already exists" for a WI it isn't even
  // retrying yet.
  const branchPrefix = `forge/wi/${opts.initiativeId}/`;
  let branchListing = '';
  try {
    branchListing = execFileSync(
      'git',
      ['-C', opts.projectRepoPath, 'branch', '--list', `${branchPrefix}*`],
      { encoding: 'utf8' },
    );
  } catch {
    /* no matching branches, or repo not initialised — nothing to sweep */
  }
  for (const rawLine of branchListing.split('\n')) {
    // `git branch --list` prefixes each line with `* ` (current branch),
    // `+ ` (checked out in another worktree), or two plain spaces —
    // strip whichever marker is present before comparing the name.
    const name = rawLine.replace(/^[*+]?\s+/, '').trim();
    if (!name || !name.startsWith(branchPrefix) || prunedBranches.includes(name)) continue;
    try {
      execFileSync('git', ['-C', opts.projectRepoPath, 'branch', '-D', name], { stdio: 'pipe' });
      prunedBranches.push(name);
    } catch {
      /* best-effort — a branch delete failure here must not block the sweep */
    }
  }

  // Sweep stale `git worktree` ADMIN entries for the whole project repo —
  // a worktree dir removed out-of-band (manual `rm -rf`, or a crash before
  // `removeWiWorktree` got to run its own prune) leaves a dangling
  // registry entry that only `worktree prune` clears.
  try {
    execFileSync('git', ['-C', opts.projectRepoPath, 'worktree', 'prune'], { stdio: 'pipe' });
  } catch {
    /* non-fatal */
  }

  if (prunedPaths.length > 0 || prunedBranches.length > 0) {
    try {
      createLogger(opts.initiativeId, opts.logsRoot ?? '_logs').emit({
        initiative_id: opts.initiativeId,
        phase: 'orchestrator',
        skill: 'scheduler',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'wi-worktrees.pruned',
        metadata: {
          reason: 'stale per-WI worktree/branch left behind by a prior attempt',
          paths: prunedPaths,
          branches: prunedBranches,
        },
      });
    } catch {
      /* best-effort — a logging failure must never block the self-heal sweep */
    }
  }

  return { prunedPaths, prunedBranches };
}
