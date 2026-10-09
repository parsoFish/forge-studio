/**
 * "Save" the accumulated forge-studio changes (R1-2; forge-mfv5.1.22).
 *
 * No origin: merge forge-studio into the default branch locally and delete it.
 * With an origin, the path is decided BEFORE any checkout: a non-GitHub origin
 * takes the merge + push (a refused push restores the base, keeps forge-studio,
 * and says so); on GitHub an unprotected default branch takes the merge + push (a refused push undoes the local merge
 * and falls through); a protected or UNKNOWN one (§6.15) pushes forge-studio as
 * a branch and opens a PR with merge-on-green. A later Save finishes a merged
 * PR. A default branch left AHEAD of origin with no forge-studio (the gitweave
 * strand) is never reset on a plain Save: the Save proposes the recovery and
 * the operator confirms it with the two shas it named.
 */
import { gitIdentityConfigArgs, guardedFile, ORCHESTRATOR_GIT_IDENTITY } from '@forge/kernel';

import { defaultGh, githubSlug, mergedStudioPr, openStudioPr, openStudioPrWithAutoMerge, probeProtection, type GhRunner } from './project-repo-github.ts';
import { branchExists, commitStudioChange, currentBranch, defaultBranch, git, isGitRepo, STUDIO_BRANCH, uncommittedContractPaths } from './project-repo-tx.ts';

export type { GhRunner };

/** A stranded default branch's recovery, proposed by a Save and confirmed by the next. */
export type SaveRecovery = { commits: number; subjects: string[]; localHead: string; resetTo: string; base: string };
export type RecoverConfirmation = { localHead: string; resetTo: string };

/** `refused` names the uncommitted contract files when the Save declined to run;
 *  `adopted` names the ones an adopting Save committed to forge-studio first;
 *  `prUrl` is the PR a protected default branch took instead of a push;
 *  `recovery` is a proposal the operator must confirm before anything moves. */
export type SaveResult = {
  merged: boolean; pushed: boolean; detail: string;
  refused?: string[]; adopted?: string[]; prUrl?: string; recovery?: SaveRecovery;
};

export type SaveOptions = { adopt?: readonly string[]; recover?: RecoverConfirmation; gh?: GhRunner };

const SHA_RE = /^[0-9a-f]{40}$/;

/** A request body's `recover` field: two full shas, or nothing (a malformed one confirms nothing). */
export function parseRecoverConfirmation(raw: unknown): RecoverConfirmation | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const { localHead, resetTo } = raw as { localHead?: unknown; resetTo?: unknown };
  return typeof localHead === 'string' && typeof resetTo === 'string' && SHA_RE.test(localHead) && SHA_RE.test(resetTo) ? { localHead, resetTo } : undefined;
}

const MERGE_MESSAGE = 'forge-studio: apply project configuration';
const NOTHING_PENDING = 'no pending forge-studio changes';
const tracking = (base: string): string => `refs/remotes/origin/${base}`;

function tryGit(dir: string, args: string[]): { ok: true; out: string } | { ok: false; err: string } {
  try {
    return { ok: true, out: git(dir, args) };
  } catch (err) {
    const e = err as { stderr?: unknown; message?: string };
    const text = typeof e.stderr === 'string' && e.stderr.trim() ? e.stderr : (e.message ?? 'git failed');
    return { ok: false, err: text.split('\n').map((l) => l.replace(/^remote:\s*/, '').trim()).filter(Boolean).slice(0, 3).join(' / ').slice(0, 240) };
  }
}

const count = (dir: string, range: string): number => Number(git(dir, ['rev-list', '--count', range]));
const sha = (dir: string, ref: string): string => git(dir, ['rev-parse', '--verify', ref]);
const refExists = (dir: string, ref: string): boolean => tryGit(dir, ['rev-parse', '--verify', '--quiet', ref]).ok;
const hasOrigin = (dir: string): boolean => git(dir, ['remote'], { allowFail: true }).split('\n').includes('origin');
const originSlug = (dir: string): string | null => githubSlug(git(dir, ['config', '--get', 'remote.origin.url'], { allowFail: true }));
const notSaved = (detail: string): SaveResult => ({ merged: false, pushed: false, detail });

export function saveProjectRepo(projectDir: string, opts: SaveOptions = {}): SaveResult {
  if (!isGitRepo(projectDir)) return notSaved('not a git repo');
  // forge-mfv5.1.12 — fail closed before any checkout.
  let uncommitted = uncommittedContractPaths(projectDir);
  // Row 6 (ruling T1 1977a): the operator may adopt the files they were SHOWN —
  // committed to forge-studio, re-read (anything else, or a deletion, still refuses), then saved.
  const shown = opts.adopt ?? [];
  const adoptable = uncommitted.filter((p) => shown.includes(p) && guardedFile(projectDir, p.split('/'), 'read') !== null);
  const adopted = adoptable.length > 0 ? adoptable : undefined;
  if (adopted) {
    commitStudioChange(projectDir, 'chore(forge): adopt uncommitted contract files', adopted);
    uncommitted = uncommittedContractPaths(projectDir);
  }
  if (uncommitted.length > 0) {
    return {
      ...notSaved(`refused — uncommitted contract file(s) would be missing from ${defaultBranch(projectDir)}: ${uncommitted.join(', ')}. Commit them to ${STUDIO_BRANCH} (or discard them), then Save again.`),
      refused: uncommitted,
    };
  }
  const base = defaultBranch(projectDir);
  const result = hasOrigin(projectDir)
    ? saveToOrigin(projectDir, base, opts.gh ?? defaultGh, opts.recover)
    : saveLocal(projectDir, base);
  return adopted ? { ...result, adopted } : result;
}

/** No origin remote: today's local merge, unchanged. */
function saveLocal(dir: string, base: string): SaveResult {
  if (!branchExists(dir, STUDIO_BRANCH)) return notSaved(NOTHING_PENDING);
  const ahead = git(dir, ['rev-list', '--count', `${base}..${STUDIO_BRANCH}`], { allowFail: true });
  git(dir, ['checkout', base]);
  if (ahead === '0' || ahead === '') {
    git(dir, ['branch', '-D', STUDIO_BRANCH], { allowFail: true });
    return notSaved(NOTHING_PENDING);
  }
  git(dir, [...gitIdentityConfigArgs(ORCHESTRATOR_GIT_IDENTITY), 'merge', '--no-ff', '--no-verify', '-m', MERGE_MESSAGE, STUDIO_BRANCH]);
  git(dir, ['branch', '-D', STUDIO_BRANCH], { allowFail: true });
  return { merged: true, pushed: false, detail: `merged ${STUDIO_BRANCH} → ${base} (no origin remote — local only)` };
}

function saveToOrigin(dir: string, base: string, gh: GhRunner, recover: RecoverConfirmation | undefined): SaveResult {
  const fetched = tryGit(dir, ['fetch', '--quiet', 'origin', `+refs/heads/${base}:${tracking(base)}`]);
  if (!fetched.ok) return notSaved(`refused — could not fetch origin/${base} (${fetched.err}); nothing moved`);
  if (branchExists(dir, STUDIO_BRANCH)) {
    if (count(dir, `${base}..${STUDIO_BRANCH}`) > 0) {
      // A confirmation that arrives with new forge-studio work is moot: the PR carries the base's commits too.
      if (count(dir, `${tracking(base)}..${STUDIO_BRANCH}`) === 0) return finishMergedPr(dir, base, gh);
      return publish(dir, base, gh);
    }
    // An empty forge-studio holds nothing; drop it so the base is judged alone.
    if (currentBranch(dir) === STUDIO_BRANCH) git(dir, ['checkout', base]);
    git(dir, ['branch', '-D', STUDIO_BRANCH]);
  }
  const ahead = count(dir, `${tracking(base)}..${base}`);
  const behind = count(dir, `${base}..${tracking(base)}`);
  if (ahead > 0 && behind > 0) return diverged(base, ahead, behind);
  if (ahead === 0) return notSaved(NOTHING_PENDING);
  const slug = originSlug(dir);
  if (!slug) return notGitHub(dir);
  const proposal: SaveRecovery = {
    commits: ahead,
    subjects: git(dir, ['log', '--format=%s', `${tracking(base)}..${base}`]).split('\n').filter(Boolean),
    localHead: sha(dir, base),
    resetTo: sha(dir, tracking(base)),
    base,
  };
  const proposed = `${ahead} commit${ahead === 1 ? '' : 's'} move to ${STUDIO_BRANCH}; local ${base} resets to origin/${base} ${proposal.resetTo.slice(0, 7)} — confirm to recover, then a PR opens`;
  if (!recover) return { ...notSaved(proposed), recovery: proposal };
  if (recover.localHead !== proposal.localHead || recover.resetTo !== proposal.resetTo) {
    return { ...notSaved(`refused — stale recovery confirmation: local ${base} or origin/${base} moved since the proposal; nothing moved. Now: ${proposed}`), recovery: proposal };
  }
  return recoverStranded(dir, proposal, gh);
}

function diverged(base: string, ahead: number, behind: number): SaveResult {
  return notSaved(`refused — local ${base} has diverged from origin/${base} (${ahead} ahead, ${behind} behind): reconcile it by hand, then Save again; nothing moved`);
}

/** A stranded base on a non-GitHub origin: the recovery ends in a PR, which only GitHub offers. */
function notGitHub(dir: string): SaveResult {
  const url = git(dir, ['config', '--get', 'remote.origin.url'], { allowFail: true });
  return notSaved(`refused — local base is ahead of origin, and origin (${url}) is not a GitHub repository, so forge cannot open a pull request for it; push or reset it by hand; nothing pushed or moved`);
}

/** Move the stranded commits onto forge-studio (verified), THEN reset the base, then the PR path. */
function recoverStranded(dir: string, p: SaveRecovery, gh: GhRunner): SaveResult {
  git(dir, ['branch', STUDIO_BRANCH, p.localHead]);
  if (sha(dir, STUDIO_BRANCH) !== p.localHead) return notSaved(`refused — ${STUDIO_BRANCH} did not land on ${p.localHead}; ${p.base} not reset`);
  if (currentBranch(dir) === p.base) git(dir, ['checkout', STUDIO_BRANCH]); // same commit: the tree does not change
  git(dir, ['branch', '-f', p.base, p.resetTo]);
  if (sha(dir, p.base) !== p.resetTo) return notSaved(`refused — ${p.base} did not reset to ${p.resetTo}; the commits are safe on ${STUDIO_BRANCH}`);
  return publishViaPr(dir, p.base, gh, originSlug(dir)!, `recovered ${p.commits} stranded commit${p.commits === 1 ? '' : 's'}`);
}

/** The path decided before any checkout: probe, then merge + push, or the PR. */
function publish(dir: string, base: string, gh: GhRunner): SaveResult {
  const slug = originSlug(dir);
  if (!slug) return publishDirect(dir, base);
  const p = probeProtection(gh, dir, slug, base);
  if (p.kind === 'unprotected') {
    const direct = mergeAndPush(dir, base);
    if (direct.ok) return { merged: true, pushed: true, detail: `merged ${STUDIO_BRANCH} → ${base} + pushed to origin` };
    if (direct.conflict) return notSaved(`refused — merging ${STUDIO_BRANCH} into ${base} failed (${direct.err}); nothing moved`);
    return publishViaPr(dir, base, gh, slug, `push of ${base} refused: ${direct.err}`);
  }
  const why = p.kind === 'protected' ? 'default branch protected' : `default branch protection unknown: ${p.reason} — treated as protected`;
  return publishViaPr(dir, base, gh, slug, why);
}

/** A non-GitHub origin (local path, self-hosted): merge + push as before, never gh.
 *  A refused push restores the base and keeps forge-studio — named, never a save. */
function publishDirect(dir: string, base: string): SaveResult {
  const direct = mergeAndPush(dir, base);
  if (direct.ok) return { merged: true, pushed: true, detail: `merged ${STUDIO_BRANCH} → ${base} + pushed to origin` };
  if (direct.conflict) return notSaved(`refused — merging ${STUDIO_BRANCH} into ${base} failed (${direct.err}); nothing moved`);
  return notSaved(`push to origin refused and no GitHub PR path for a non-GitHub origin — ${STUDIO_BRANCH} kept, local ${base} restored; push ${STUDIO_BRANCH} and merge it by hand, then Save again (${direct.err})`);
}

/** Merge + push the base. A refused push restores the base to its pre-merge sha
 *  and keeps forge-studio — a refused push is never a save. */
function mergeAndPush(dir: string, base: string): { ok: true } | { ok: false; conflict: boolean; err: string } {
  const pre = sha(dir, base);
  const from = currentBranch(dir);
  git(dir, ['checkout', base]);
  const merged = tryGit(dir, [...gitIdentityConfigArgs(ORCHESTRATOR_GIT_IDENTITY), 'merge', '--no-ff', '--no-verify', '-m', MERGE_MESSAGE, STUDIO_BRANCH]);
  if (!merged.ok) {
    git(dir, ['merge', '--abort'], { allowFail: true });
    git(dir, ['checkout', from]);
    return { ok: false, conflict: true, err: merged.err };
  }
  const pushed = tryGit(dir, ['push', 'origin', base]);
  if (pushed.ok) {
    git(dir, ['branch', '-D', STUDIO_BRANCH]);
    git(dir, ['branch', '-dr', `origin/${STUDIO_BRANCH}`], { allowFail: true });
    return { ok: true };
  }
  git(dir, ['checkout', STUDIO_BRANCH]);
  git(dir, ['branch', '-f', base, pre]);
  if (sha(dir, base) !== pre) throw new Error(`saveProjectRepo: could not restore ${base} to ${pre} after a refused push`);
  return { ok: false, conflict: false, err: pushed.err };
}

/** Push forge-studio as a branch (never forced) and open/reuse its PR. Base untouched. */
function publishViaPr(dir: string, base: string, gh: GhRunner, slug: string, why: string): SaveResult {
  const pushed = tryGit(dir, ['push', 'origin', `refs/heads/${STUDIO_BRANCH}:refs/heads/${STUDIO_BRANCH}`]);
  if (!pushed.ok) {
    const nonFf = /non-fast-forward|fetch first|rejected/.test(pushed.err) ? ' — origin has commits this one lacks (not a fast-forward; forge never force-pushes)' : '';
    return notSaved(`refused — git push origin ${STUDIO_BRANCH} failed (${pushed.err})${nonFf}; ${STUDIO_BRANCH} and ${base} untouched`);
  }
  const pr = openStudioPrWithAutoMerge(gh, dir, slug, base);
  if (!pr.ok) return notSaved(`not saved — ${pr.reason}; ${STUDIO_BRANCH} is on origin but no PR is open; ${STUDIO_BRANCH} and ${base} untouched`);
  const verb = pr.created ? `opened PR ${pr.url}` : `updated open PR ${pr.url}`;
  return { merged: false, pushed: true, prUrl: pr.url, detail: `${verb} (${why}) — ${STUDIO_BRANCH} → ${base}; ${pr.autoMerge}. Save again once it merges.` };
}

/** forge-studio is wholly on origin/<base>: fast-forward the base, drop forge-studio. */
function finishMergedPr(dir: string, base: string, gh: GhRunner): SaveResult {
  const ahead = count(dir, `${tracking(base)}..${base}`);
  if (ahead > 0) return diverged(base, ahead, count(dir, `${base}..${tracking(base)}`));
  if (currentBranch(dir) !== base) git(dir, ['checkout', base]);
  git(dir, ['merge', '--ff-only', tracking(base)]);
  git(dir, ['branch', '-D', STUDIO_BRANCH]);
  git(dir, ['branch', '-dr', `origin/${STUDIO_BRANCH}`], { allowFail: true });
  const slug = originSlug(dir);
  const url = slug ? mergedStudioPr(gh, dir, slug) : undefined;
  return { merged: true, pushed: true, detail: `PR ${url ?? STUDIO_BRANCH} merged — ${base} fast-forwarded to origin/${base} ${sha(dir, base).slice(0, 7)}` };
}

/** Pending a Save: forge-studio has commits beyond the base, or the base sits
 *  ahead of its last-fetched origin (the stranded state). Local refs only — no fetch, no gh. */
export function hasPendingStudioChanges(projectDir: string): boolean {
  if (!isGitRepo(projectDir)) return false;
  const base = defaultBranch(projectDir);
  if (branchExists(projectDir, STUDIO_BRANCH) && Number(git(projectDir, ['rev-list', '--count', `${base}..${STUDIO_BRANCH}`], { allowFail: true }) || 0) > 0) return true;
  if (!refExists(projectDir, tracking(base)) || !branchExists(projectDir, base)) return false;
  return Number(git(projectDir, ['rev-list', '--count', `${tracking(base)}..${base}`], { allowFail: true }) || 0) > 0;
}

/** The open forge-studio PR for repo-status. Asks gh only once forge-studio was pushed. */
export function studioPullRequestUrl(projectDir: string, gh: GhRunner = defaultGh): string | undefined {
  if (!isGitRepo(projectDir) || !refExists(projectDir, `refs/remotes/origin/${STUDIO_BRANCH}`)) return undefined;
  const slug = originSlug(projectDir);
  return slug ? openStudioPr(gh, projectDir, slug) : undefined;
}
