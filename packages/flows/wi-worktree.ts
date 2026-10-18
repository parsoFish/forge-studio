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
 * Mirrors packages/flows/worktree.ts's conventions: `execFileSync` with arg
 * arrays (no shell interpolation), self-heal-before-create, best-effort
 * remove. worktree.ts itself is untouched (its `add()`/`remove()` contracts
 * stay byte-identical) — this module creates the branch itself, then reuses
 * `add()` for the actual `git worktree add` + its own self-heal pass.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { FORGE_ROOT, gitIdentityConfigArgs, ORCHESTRATOR_GIT_IDENTITY } from '@forge/kernel';

import { add, list, remove, selfHealWorktreeState, type WorktreeHandle } from './worktree.ts';
import { linkProjectDeps } from './scheduler-run-one.ts'; // bead forge-8vfn.15: moved from scheduler.ts
import { createLogger } from '@forge/kernel';
import { readWorkItemsFromDir, serializeWorkItem } from './work-item.ts';

export type WiWorktreeHandle = {
  path: string;
  branch: string;
  /** forge-mfv5.1.56: the kept tip this WI resumed from (its branch carried unmerged commits), else null. */
  resumedFrom: string | null;
  /** forge-mfv5.1.56: where an unmerged branch with no kept_branch on its spec was parked (never deleted), else null. */
  parkedAs: string | null;
  /** What linking this worktree's deps could not do (linkProjectDeps); the caller emits it — never swallowed. */
  depsProblems: string[];
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
 * forge-mfv5.1.56 (D-06): the commits `branch` carries outside every one of
 * `againstRefs` — the work a `branch -D` would discard. 'UNKNOWN' when the
 * branch is missing, none of the refs exists, or git cannot answer (§6.15:
 * a caller never deletes on UNKNOWN).
 */
export function unmergedCommitCount(projectRepoPath: string, branch: string, againstRefs: readonly string[]): number | 'UNKNOWN' {
  const git = (args: string[]): string => execFileSync('git', ['-C', projectRepoPath, ...args], { stdio: 'pipe', encoding: 'utf8' }).trim();
  const resolves = (ref: string): boolean => { try { git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); return true; } catch { return false; } };
  const present = againstRefs.filter(resolves);
  if (!resolves(branch) || present.length === 0) return 'UNKNOWN';
  try {
    const n = Number(git(['rev-list', '--count', branch, '--not', ...present, '--']));
    return Number.isInteger(n) ? n : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * Removes any leftover worktree dir/registry entry before a create. A
 * leftover BRANCH with no commit outside the start point is deleted. One with
 * committed work (D-06) is the kept tip the caller resumes when its spec says
 * so (`resumeKept`); otherwise — a fresh plan reusing the id, or a crash
 * before the keep was recorded — it is PARKED under `forge/parked/…`, never
 * resurrected and never deleted. An unanswerable check refuses by name.
 */
function selfHealWiCollision(opts: {
  projectRepoPath: string;
  path: string;
  branch: string;
  startPointRef: string;
  initiativeId: string;
  workItemId: string;
  resumeKept: boolean;
}): { resumeTip: string | null; parkedAs: string | null } {
  if (existsSync(opts.path)) {
    console.warn(
      `[wi-worktree] stale worktree at ${opts.path} (crashed prior run?) — self-healing: remove + recreate`,
    );
  }
  selfHealWorktreeState(opts.projectRepoPath, opts.path);

  const git = (args: string[]): string => execFileSync('git', ['-C', opts.projectRepoPath, ...args], { stdio: 'pipe', encoding: 'utf8' }).trim();
  let tip: string | null = null;
  try { tip = git(['rev-parse', '--verify', '--quiet', `refs/heads/${opts.branch}`]); } catch { /* no branch — nothing to heal */ }
  if (tip === null) return { resumeTip: null, parkedAs: null };
  const unmerged = unmergedCommitCount(opts.projectRepoPath, opts.branch, [opts.startPointRef]);
  if (unmerged === 'UNKNOWN') {
    throw new Error(`wi-worktree: cannot tell whether ${opts.branch} carries committed work outside ${opts.startPointRef} — refusing to delete or re-cut it (D-06)`);
  }
  if (unmerged === 0) { git(['branch', '-D', opts.branch]); return { resumeTip: null, parkedAs: null }; }
  if (opts.resumeKept) return { resumeTip: tip, parkedAs: null };
  const parkedAs = `forge/parked/${opts.initiativeId}/${opts.workItemId}-${tip.slice(0, 12)}`;
  git(['branch', '-m', opts.branch, parkedAs]);
  return { resumeTip: null, parkedAs };
}

/**
 * forge-mfv5.1.60 (D-06): a stranded run's dev loop died (operator stop + kill)
 * before it recorded any WI outcome, so an owed WI's committed branch carries
 * no `kept_branch` and `createWiWorktree` would park it. Stamp each owed WI
 * (pending / in-progress) whose branch carries commits outside the cycle
 * branch as kept, so it resumes at its tip; status stays owed. One with no
 * such commits is left to be re-cut. Every count is read before any write; an
 * unanswerable one refuses by name.
 */
export function keepStrandedWorkItems(o: { worktreePath: string; projectRepoPath: string; initiativeId: string }): Array<{ work_item_id: string; branch: string; tip: string; commits: number }> {
  const dir = join(o.worktreePath, '.forge', 'work-items');
  const { items, parseErrors } = readWorkItemsFromDir(dir);
  const bad = Object.keys(parseErrors);
  if (bad.length > 0) throw new Error(`requeue: cannot read work item(s) ${bad.join(', ')} in ${dir} — refusing to resume or re-cut them (D-06)`);
  const cycleBranch = `forge/${o.initiativeId}`;
  const git = (args: string[]): string => execFileSync('git', ['-C', o.projectRepoPath, ...args], { stdio: 'pipe', encoding: 'utf8' }).trim();
  const kept = items.filter((w) => (w.status === 'pending' || w.status === 'in-progress') && w.kept_branch === undefined).flatMap((w) => {
    const branch = wiBranchName({ initiativeId: o.initiativeId, workItemId: w.work_item_id });
    if (git(['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`]) === '') return [];
    const commits = unmergedCommitCount(o.projectRepoPath, branch, [`refs/heads/${cycleBranch}`]);
    if (commits === 'UNKNOWN') throw new Error(`requeue: cannot tell whether ${branch} carries commits outside ${cycleBranch} — refusing to resume or re-cut it (D-06)`);
    return commits === 0 ? [] : [{ wi: w, branch, tip: git(['rev-parse', `refs/heads/${branch}`]), commits }];
  });
  for (const k of kept) writeFileSync(join(dir, `${k.wi.work_item_id}.md`), serializeWorkItem({ ...k.wi, kept_branch: k.branch }));
  return kept.map((k) => ({ work_item_id: k.wi.work_item_id, branch: k.branch, tip: k.tip, commits: k.commits }));
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
  /** forge-mfv5.1.56: the WI's spec names a kept branch (`kept_branch`) — resume it rather than park it. */
  resumeKept?: boolean;
}): WiWorktreeHandle {
  const path = wiWorktreePath(opts);
  const branch = wiBranchName(opts);

  const { resumeTip, parkedAs } = selfHealWiCollision({ projectRepoPath: opts.projectRepoPath, path, branch, startPointRef: opts.startPointRef, initiativeId: opts.initiativeId, workItemId: opts.workItemId, resumeKept: opts.resumeKept === true });

  // Create the branch at the explicit start point FIRST (unless a kept tip is
  // resumed). `worktree.ts`'s `add()` only checks out a branch by name — it
  // has no notion of an explicit start point — so we create the ref ourselves
  // and let `add()` check the existing branch out as-is.
  if (resumeTip === null) {
    execFileSync('git', ['-C', opts.projectRepoPath, 'branch', branch, opts.startPointRef], { stdio: 'pipe' });
  }

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

  // A resumed kept tip is brought onto the current cycle tip first, so the WI
  // never runs (or merges back) on a stale base; a conflict refuses by name,
  // the kept branch untouched.
  if (resumeTip !== null) {
    try {
      execFileSync('git', ['-C', handle.path, ...gitIdentityConfigArgs(ORCHESTRATOR_GIT_IDENTITY), 'merge', '--no-edit', '-m', `wi(${opts.workItemId}): resume onto the cycle tip`, opts.startPointRef], { stdio: 'pipe' });
    } catch (err) {
      try { execFileSync('git', ['-C', handle.path, 'merge', '--abort'], { stdio: 'pipe' }); } catch { /* nothing to abort */ }
      removeWiWorktree({ projectRepoPath: opts.projectRepoPath, path: handle.path, branch });
      const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
      throw new Error(`wi-worktree: kept branch ${branch} (tip ${resumeTip.slice(0, 12)}) does not merge onto the cycle tip ${opts.startPointRef.slice(0, 12)} — resolve it by hand, then Requeue (${detail})`);
    }
  }

  const depsLink = linkProjectDeps(opts.projectRepoPath, handle.path);

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

  return { path: handle.path, branch: handle.branch, resumedFrom: resumeTip, parkedAs, depsProblems: depsLink.problems };
}

/**
 * Per-WI worktree directories are pure scratch: removal is always force +
 * best-effort; an already-gone worktree/branch is success, not an error. The
 * BRANCH is deleted only when the caller asks (`deleteBranch`) — a caller
 * asks only for a branch with no unmerged commits (forge-mfv5.1.56, D-06).
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
  /** forge-mfv5.1.56: WI branches left in place — they carry commits outside the initiative branch and main, or that could not be told (UNKNOWN). */
  keptBranches: string[];
};

/**
 * Phase 4 step 9 (plan risk R7) — self-heal for leftover per-WI worktrees.
 *
 * A mid-fan-out crash (or an operator `forge requeue`) can leave per-WI
 * worktrees/branches behind for an initiative: the cycle-level preserve
 * logic (`scheduler.ts`, D-06) protects only the CYCLE worktree.
 * Per-WI worktree DIRECTORIES are pure scratch and always go. A per-WI
 * BRANCH goes only when it carries no commit outside the initiative branch
 * and main (forge-mfv5.1.56, D-06): an unmerged one is a budget-failed or
 * crashed WI's committed work, which the next dispatch resumes from
 * (`createWiWorktree`), so it is kept and named in the event.
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
  const keptBranches: string[] = [];
  const settleBranch = (name: string): void => {
    if (prunedBranches.includes(name) || keptBranches.includes(name)) return;
    const unmerged = unmergedCommitCount(opts.projectRepoPath, name, [`refs/heads/forge/${opts.initiativeId}`, 'refs/heads/main', 'refs/heads/master']);
    if (unmerged !== 0) { keptBranches.push(name); return; }
    try {
      execFileSync('git', ['-C', opts.projectRepoPath, 'branch', '-D', name], { stdio: 'pipe' });
      prunedBranches.push(name);
    } catch {
      keptBranches.push(name); // a failed delete leaves it in place — named, never counted as pruned
    }
  };

  const wiRoot = resolve(opts.worktreesRoot, 'wi', opts.initiativeId);
  const registered = list(opts.projectRepoPath).filter((w) => {
    const p = resolve(w.path);
    return p === wiRoot || p.startsWith(wiRoot + sep);
  });
  for (const entry of registered) {
    removeWiWorktree({ projectRepoPath: opts.projectRepoPath, path: entry.path, branch: entry.branch });
    prunedPaths.push(entry.path);
    settleBranch(entry.branch);
  }

  // Orphan branches: a per-WI branch can survive with no registered
  // worktree left to key off — e.g. the worktree dir was already gone and
  // an earlier `worktree prune` (anyone's) reclaimed the registry entry
  // while the branch, a wholly separate git object, was untouched. Swept by
  // naming convention under the same merged-only rule.
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
    if (name.startsWith(branchPrefix)) settleBranch(name);
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

  if (prunedPaths.length > 0 || prunedBranches.length > 0 || keptBranches.length > 0) {
    try {
      createLogger(opts.initiativeId, opts.logsRoot ?? join(FORGE_ROOT, '_logs')).emit({
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
          kept_branches: keptBranches,
        },
      });
    } catch {
      /* best-effort — a logging failure must never block the self-heal sweep */
    }
  }

  return { prunedPaths, prunedBranches, keptBranches };
}
