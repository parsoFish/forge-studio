/**
 * Local git ↔ remote invariants for the initiative branch: push it, keep it
 * synced, prove it merged, and realign a worktree that drifted.
 *
 * Carved out of `pr.ts` under the 800-line cap (M4-flows exit row 4). `pr.ts`
 * is about the GitHub PR API — `gh pr create`, `gh pr merge`, a PR's identity.
 * Everything here is about `git` and the remote, and the distinction is not
 * cosmetic: these functions are the ones that must be right when the PR API is
 * unavailable or lying, which is why `assertLocalRemoteSynced` THROWS rather
 * than returning a status.
 *
 * Measured before the move: this block references nothing in the rest of
 * `pr.ts`; `alignLocalToRemote` travels with it because it needs
 * `currentBranch`, `revParse` and `confirmPrMerged`, all of which live here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { gitIdentityConfigArgs, ORCHESTRATOR_GIT_IDENTITY } from '@forge/kernel';

/**
 * Resolve the current branch name of a worktree. Returns null for a
 * detached HEAD or a non-git path (callers treat that as "cannot push").
 */
export function currentBranch(worktreePath: string): string | null {
  try {
    const b = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    return !b || b === 'HEAD' ? null : b;
  } catch {
    return null;
  }
}

function revParse(worktreePath: string, ref: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', ref], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

export type PushResult =
  | { pushed: true; branch: string }
  | { pushed: false; reason: string };

/**
 * G8: push the initiative branch to `origin` so local == remote after
 * every work item. The dev-loop calls this per WI; keeping the branch
 * published every WI is the precondition the review redesign depends on
 * (no divergence → no stacked-PR merge conflicts at the boundary).
 *
 * `--set-upstream` so the first push establishes tracking; subsequent
 * pushes are fast-forwards. Best-effort by return value, not by throw:
 * a non-pushable worktree (no remote in a bench fixture without an
 * origin, detached HEAD) yields `{ pushed: false }` and the caller logs
 * it — the hard invariant is enforced separately by
 * `assertLocalRemoteSynced` at dev-loop close, which DOES throw.
 */
/**
 * Defense-in-depth: `.forge/` is gitignored scratch (PR draft, demo source,
 * work-item specs, AGENT/PROMPT/fix_plan). It must NEVER reach an initiative
 * branch — `.forge/pr-description.md` is a FIXED path, so two parallel
 * initiatives that each commit it produce an unresolvable add/add conflict
 * on the second PR once the first merges (the v1 branch-divergence failure).
 * Reviewer/dev agents sometimes `git add -f` it despite the ignore; this
 * strips any tracked `.forge/` from the index and commits the removal so
 * scratch can never be pushed. Best-effort — never blocks a push.
 */
/**
 * betterado #4: a project may force-track its forge config INSIDE the ignored
 * `.forge/` dir (`.forge/project.json` + `.forge/quality_gate_cmd` — load-bearing,
 * read every cycle). A blanket `git rm -r --cached .forge` deleted those from the
 * branch (the betterado PR lost its project config). Strip the scratch but EXEMPT
 * the tracked config.
 */
const PROTECTED_FORGE_CONFIG: readonly string[] = ['.forge/project.json', '.forge/quality_gate_cmd'];

/**
 * C2 leak: the Ralph runner stamps its loop scratch — PROMPT.md / AGENT.md /
 * fix_plan.md — at the WORKTREE ROOT (the agent references them by relative
 * path), NOT under the gitignored `.forge/` dir. So `autoCommitWorktreeIfDirty`'s
 * `git add -A` (and the agent's own commits) sweep them onto the initiative
 * branch, where they leak into the PR and, after merge, re-introduce the C2
 * contract violation on `main` — forcing a manual `git rm --cached` before every
 * merge across the whole release chain (2026-06-06). Strip them at the same
 * pre-PR boundary `.forge/` is stripped.
 */
const ROOT_RALPH_SCRATCH: readonly string[] = ['PROMPT.md', 'AGENT.md', 'fix_plan.md'];

/** First existing base ref, preferring the pushed remote. null in a degraded git state. */
function resolveStripBaseRef(worktreePath: string): string | null {
  for (const ref of ['origin/main', 'main', 'origin/master', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
        cwd: worktreePath,
        stdio: 'pipe',
      });
      return ref;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** True if `file` is tracked in `ref`'s tree (i.e. a pre-existing project file, not cycle scratch). */
function isTrackedAtRef(worktreePath: string, ref: string, file: string): boolean {
  try {
    const out = execFileSync('git', ['ls-tree', '--name-only', ref, '--', file], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

/**
 * Strips gitignored forge scratch (`.forge/*` minus `PROTECTED_FORGE_CONFIG`,
 * plus cycle-introduced `ROOT_RALPH_SCRATCH`) that leaked onto the CURRENTLY
 * CHECKED-OUT branch at `worktreePath`, as a new commit on that branch.
 * Returns the list of paths actually stripped (empty when the tree was
 * already clean — a no-op, no empty commit). Also the shared core the WI
 * merge-back path (`wi-merge-back.ts`) reuses to strip a WI branch's tip
 * BEFORE it fans into the cycle branch, not just at PR-push time.
 */
export function stripForgeScratchFromBranch(worktreePath: string): string[] {
  try {
    const toStrip: string[] = [];

    // (1) gitignored `.forge/` scratch the agent may have force-added (the fixed
    //     `.forge/pr-description.md` path is the v1 add/add-conflict source).
    const trackedForge = execFileSync('git', ['ls-files', '.forge'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    if (trackedForge) {
      toStrip.push(
        ...trackedForge
          .split('\n')
          .map((s) => s.trim())
          .filter((f) => f && !PROTECTED_FORGE_CONFIG.includes(f)),
      );
    }

    // (2) root-level Ralph scratch (PROMPT.md / AGENT.md / fix_plan.md). Strip
    //     ONLY the copies THIS cycle introduced — tracked on the branch but
    //     absent from the base — so a project that legitimately tracks one of
    //     these names (e.g. an `AGENT.md` it ships) is never deleted from its PR.
    const baseRef = resolveStripBaseRef(worktreePath);
    for (const f of ROOT_RALPH_SCRATCH) {
      const trackedNow = execFileSync('git', ['ls-files', '--', f], {
        cwd: worktreePath,
        stdio: 'pipe',
        encoding: 'utf8',
      }).trim();
      if (!trackedNow) continue; // not on the branch → nothing to strip
      if (baseRef && isTrackedAtRef(worktreePath, baseRef, f)) continue; // project-owned → keep
      toStrip.push(f);
    }

    if (toStrip.length === 0) return []; // only protected config / clean tree — nothing to strip
    execFileSync('git', ['rm', '--cached', '--quiet', '--ignore-unmatch', ...toStrip], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    execFileSync(
      'git',
      [
        ...gitIdentityConfigArgs(ORCHESTRATOR_GIT_IDENTITY),
        'commit',
        '-m',
        'chore: drop forge scratch from branch (.forge/ + root Ralph PROMPT/AGENT/fix_plan; keeps tracked .forge/project.json + quality_gate_cmd)',
      ],
      { cwd: worktreePath, stdio: 'pipe' },
    );
    return toStrip;
  } catch {
    /* best-effort — scratch cleanup must never block a push */
    return [];
  }
}

export function pushInitiativeBranch(worktreePath: string): PushResult {
  const branch = currentBranch(worktreePath);
  if (!branch) return { pushed: false, reason: 'detached HEAD or not a git repo' };
  try {
    stripForgeScratchFromBranch(worktreePath);
    execFileSync('git', ['push', '--set-upstream', 'origin', branch], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    return { pushed: true, branch };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    return { pushed: false, reason: stderr || e.message || 'git push failed' };
  }
}

export type ResumeRebaseResult = {
  ok: boolean;
  /** True if a rebase actually replayed commits (main had moved). */
  rebased: boolean;
  /** The base branch rebased onto (origin/main, main, …). */
  base: string;
  reason?: string;
};

/**
 * cascade-v4 #4: on a resume run, another cycle may have merged to
 * `main` between the stall and the resume — so the preserved initiative branch
 * no longer has `main` as its merge-base, and the dev-loop-close invariant
 * (`main == merge-base`) fails at the END of the resumed cycle, wasting the
 * whole resumed run. Rebase the preserved branch onto current main at the START
 * of the resume instead:
 *   - no divergence (base is an ancestor of HEAD) → no-op, ok.
 *   - clean rebase → replay the branch's commits onto main + force-with-lease
 *     push (the initiative branch only — never main); fully unattended.
 *   - conflict → abort and return ok:false with a clear "rebase needed" reason
 *     the caller surfaces as the `resume-needs-rebase` action (operator rebases
 *     by hand, then re-resumes). Never force-pushes a conflicted state.
 */
export function rebasePreservedBranchOntoMain(worktreePath: string): ResumeRebaseResult {
  const branch = currentBranch(worktreePath);
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' }).toString();
  let base = 'main';
  try {
    git(['rev-parse', '--verify', 'main']);
  } catch {
    try { git(['rev-parse', '--verify', 'master']); base = 'master'; }
    catch { return { ok: false, rebased: false, base: 'main', reason: 'no main/master branch to rebase onto' }; }
  }
  if (!branch) return { ok: false, rebased: false, base, reason: 'detached HEAD or not a git repo' };

  // Pick up other cycles' merges: fetch + rebase onto origin/<base>.
  let target = base;
  try { git(['fetch', 'origin', base]); target = `origin/${base}`; }
  catch { target = base; }

  // No divergence: target is already an ancestor of HEAD — nothing to do.
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', target, 'HEAD'], { cwd: worktreePath, stdio: 'pipe' });
    return { ok: true, rebased: false, base: target };
  } catch { /* diverged → attempt a clean rebase */ }

  try {
    git(['rebase', target]);
  } catch (err) {
    try { git(['rebase', '--abort']); } catch { /* leave it; surfaced below */ }
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    return {
      ok: false, rebased: false, base: target,
      reason: `rebase onto ${target} conflicted — manual rebase required before re-resuming: ${(stderr || e.message || '').slice(0, 300)}`,
    };
  }

  // Rebase rewrote history → the branch must be force-pushed (with lease, never
  // plain --force) so origin/<branch> matches. Only the initiative branch.
  // Skip the push if there is no origin remote (no-remote project or test fixture).
  const hasOrigin = (() => {
    try { git(['remote', 'get-url', 'origin']); return true; } catch { return false; }
  })();
  if (hasOrigin) {
    try {
      git(['push', '--force-with-lease', '--set-upstream', 'origin', branch]);
    } catch (err) {
      const e = err as { stderr?: Buffer | string; message?: string };
      const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
      return {
        ok: false, rebased: true, base: target,
        reason: `rebased onto ${target} locally but force-with-lease push failed (someone else moved the branch?): ${(stderr || e.message || '').slice(0, 300)}`,
      };
    }
  }
  return { ok: true, rebased: true, base: target };
}

export type LocalRemoteInvariant = {
  ok: boolean;
  branch: string | null;
  localHead: string | null;
  originHead: string | null;
  mergeBase: string | null;
  mainHead: string | null;
  /** Human-readable reason when `ok` is false. */
  detail: string;
};

/**
 * G8 invariant check (pure inspection — never mutates). At dev-loop close
 * the following must hold:
 *   - `origin/<branch>` == local HEAD  (the branch is fully published)
 *   - `main` == merge-base(main, <branch>)  (main has not diverged; it is
 *      still the pre-initiative state and an ancestor of the branch)
 *
 * Returns a structured result so the caller can both assert AND emit the
 * exact ref hashes into the event log for post-mortem. `assertLocalRemoteSynced`
 * wraps this and throws on `ok === false`.
 */
export function checkLocalRemoteSynced(worktreePath: string): LocalRemoteInvariant {
  const branch = currentBranch(worktreePath);
  const localHead = revParse(worktreePath, 'HEAD');
  const originHead = branch ? revParse(worktreePath, `refs/remotes/origin/${branch}`) : null;
  const mainHead =
    revParse(worktreePath, 'refs/heads/main') ?? revParse(worktreePath, 'refs/remotes/origin/main');
  let mergeBase: string | null = null;
  if (branch && mainHead) {
    try {
      mergeBase = execFileSync('git', ['merge-base', 'main', branch], {
        cwd: worktreePath,
        stdio: 'pipe',
        encoding: 'utf8',
      }).trim();
    } catch {
      mergeBase = null;
    }
  }
  if (!branch) {
    return { ok: false, branch, localHead, originHead, mergeBase, mainHead, detail: 'detached HEAD or not a git repo' };
  }
  if (!originHead) {
    return {
      ok: false,
      branch,
      localHead,
      originHead,
      mergeBase,
      mainHead,
      detail: `origin/${branch} does not exist — branch was never pushed`,
    };
  }
  if (originHead !== localHead) {
    return {
      ok: false,
      branch,
      localHead,
      originHead,
      mergeBase,
      mainHead,
      detail: `origin/${branch} (${originHead.slice(0, 8)}) != local HEAD (${localHead?.slice(0, 8)}) — local diverged from remote`,
    };
  }
  // NOTE (2026-07-03): the historical third check — `main == merge-base(main, branch)`
  // — was deleted. Worktrees share refs, so ANY local-main advance mid-flight (a
  // sibling initiative merging, an operator hotfix) failed EVERY in-flight cycle at
  // close, making parallel fan-out + interleaved merges impossible. A stale base is
  // GitHub's job to arbitrate (conflict detection at merge time), not a reason to
  // fail a fully-published branch. The invariant that matters here is only that the
  // local work is published: origin/<branch> == local HEAD.
  return { ok: true, branch, localHead, originHead, mergeBase, mainHead, detail: 'origin == local HEAD' };
}

/**
 * Throwing wrapper around `checkLocalRemoteSynced`. The dev-loop calls
 * this at close so a divergence is a hard, classifiable failure (the
 * review redesign cannot proceed on a branch that isn't published).
 */
export function assertLocalRemoteSynced(worktreePath: string): LocalRemoteInvariant {
  const r = checkLocalRemoteSynced(worktreePath);
  if (!r.ok) {
    throw new Error(`local↔remote invariant violated: ${r.detail}`);
  }
  return r;
}

/**
 * G10 / G1: confirm the PR is MERGED on the remote. The ONLY signal that
 * gates `runReflector` and the `_queue/done/` move. Never trusts an
 * orchestrator-internal flag — asks GitHub via `gh pr view --json state`.
 *
 * Returns false (not throw) for every non-MERGED case (open PR, no PR,
 * `gh` unavailable, GraphQL error): a partial / unconfirmed state must
 * NOT be treated as merged. The caller routes a false to `ready-for-review/`.
 */
export function confirmPrMerged(worktreePath: string): boolean {
  try {
    const out = execFileSync('gh', ['pr', 'view', '--json', 'state'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out) as { state?: unknown };
    return typeof parsed.state === 'string' && parsed.state.toUpperCase() === 'MERGED';
  } catch (err) {
    const e = err as { stderr?: Buffer | string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    if (stderr) process.stderr.write(`[confirmPrMerged] ${stderr}\n`);
    return false;
  }
}

// this file, which is why it went first.

export type AlignResult = {
  aligned: boolean;
  detail: string;
};

/**
 * Closure step: once the operator has merged the PR in GitHub, align the
 * local repo to the remote — fast-forward local `main` to `origin/main`
 * (which now contains the merged initiative) and delete the initiative
 * branch. Best-effort by return value: the merge already happened on the
 * remote, so a local-alignment hiccup must not fail the cycle (it is
 * cosmetic local hygiene, surfaced via the returned detail + event log).
 *
 * Caller contract: only invoke after `confirmPrMerged` returned true.
 *
 * 2026-05-18 fix: the prior implementation moved `refs/heads/main` with
 * `git update-ref` and deliberately SKIPPED the checkout, on the assumption
 * that "main may be checked out elsewhere". In the normal operator-merge
 * path the project repo at `projectRepoPath` IS the working checkout of
 * `main` (the forge worktree is a *separate* dir that gets removed), so a
 * bare ref move left the operator's working tree frozen at the pre-merge
 * code with a huge phantom reverse-diff in `git status` — they opened the
 * repo, saw OLD code, and could not review. When `projectRepoPath` is the
 * `main` checkout we now bring its WORKING TREE forward with
 * `merge --ff-only`, preserving any uncommitted operator/architect state
 * (e.g. `roadmap.md`, which the architect phase writes directly into the
 * project repo and which is NOT part of the merged initiative) via a
 * stash that is always restored or surfaced — never silently discarded.
 * The bare-ref path is kept as a fallback for the not-on-main case.
 */
export function alignLocalToRemote(
  worktreePath: string,
  initiativeBranch: string,
  projectRepoPath?: string,
): AlignResult {
  const steps: string[] = [];
  // Prefer the project repo for git ops (it shares the object store with the
  // forge worktree, so a fetch there populates origin/main for both).
  const gitCwd =
    projectRepoPath && existsSync(projectRepoPath) ? projectRepoPath : worktreePath;
  try {
    execFileSync('git', ['fetch', 'origin', '--prune'], { cwd: gitCwd, stdio: 'pipe' });
    steps.push('fetched origin');
  } catch {
    steps.push('fetch origin failed (non-fatal)');
  }
  const originMain = revParse(gitCwd, 'refs/remotes/origin/main');
  const localMain = revParse(gitCwd, 'refs/heads/main');

  let alignedViaProjectTree = false;
  if (
    projectRepoPath &&
    existsSync(projectRepoPath) &&
    originMain &&
    originMain !== localMain &&
    currentBranch(projectRepoPath) === 'main'
  ) {
    // The project repo is the working checkout of `main` — bring its WORKING
    // TREE (not just the ref) to origin/main. Preserve any uncommitted
    // operator/architect state via stash; never discard it silently.
    let dirty = false;
    try {
      const out = execFileSync('git', ['status', '--porcelain'], {
        cwd: projectRepoPath,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      dirty = out.trim().length > 0;
    } catch {
      /* if status is unreadable, treat as clean and let ff-only be the guard */
    }
    let stashed = false;
    if (dirty) {
      try {
        execFileSync(
          'git',
          ['stash', 'push', '--include-untracked', '-m', `forge-closure-preserve ${initiativeBranch}`],
          { cwd: projectRepoPath, stdio: 'pipe' },
        );
        stashed = true;
        steps.push('stashed uncommitted project changes');
      } catch {
        steps.push('could not stash uncommitted changes — skipped working-tree ff (no data loss)');
      }
    }
    if (!dirty || stashed) {
      try {
        execFileSync('git', ['merge', '--ff-only', 'origin/main'], {
          cwd: projectRepoPath,
          stdio: 'pipe',
        });
        steps.push(`project working tree fast-forwarded main → ${originMain.slice(0, 8)}`);
        alignedViaProjectTree = true;
      } catch {
        steps.push('project working-tree ff-only failed (non-fatal)');
      }
    }
    if (stashed) {
      try {
        execFileSync('git', ['stash', 'pop'], { cwd: projectRepoPath, stdio: 'pipe' });
        steps.push('restored uncommitted project changes');
      } catch {
        steps.push(
          'uncommitted changes kept in `git stash` (pop conflicted — operator resolves; no data loss)',
        );
      }
    }
  }

  if (!alignedViaProjectTree) {
    // Fallback: move the ref without a checkout (original behaviour) when the
    // project repo is not the `main` checkout / not provided.
    if (originMain && originMain !== localMain) {
      try {
        execFileSync('git', ['update-ref', 'refs/heads/main', originMain], {
          cwd: gitCwd,
          stdio: 'pipe',
        });
        steps.push(
          `fast-forwarded main ref → ${originMain.slice(0, 8)} (ref-only — project repo not the main checkout)`,
        );
      } catch {
        steps.push('main fast-forward failed (non-fatal)');
      }
    } else {
      steps.push('main already up to date');
    }
  }

  // Prune the initiative branch locally + on origin. The scheduler's
  // worktree.cleanup() also deletes the local branch in its finally; this
  // makes the closure self-contained for the operator-driven path.
  try {
    execFileSync('git', ['branch', '-D', initiativeBranch], { cwd: gitCwd, stdio: 'pipe' });
    steps.push(`deleted local ${initiativeBranch}`);
  } catch {
    steps.push(`local ${initiativeBranch} already gone`);
  }
  try {
    execFileSync('git', ['push', 'origin', '--delete', initiativeBranch], {
      cwd: gitCwd,
      stdio: 'pipe',
    });
    steps.push(`deleted origin ${initiativeBranch}`);
  } catch {
    steps.push(`origin ${initiativeBranch} already gone or undeletable`);
  }
  return { aligned: true, detail: steps.join('; ') };
}
