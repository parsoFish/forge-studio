/**
 * PR + remote-sync boundary — the only place forge shells `git push` /
 * `gh pr ...` for the initiative branch.
 *
 * Extracted from cycle.ts (Phase 3 simplification) so the reviewer's
 * responsibility shrinks to assess + demo + open-PR, and the PR/merge
 * boundary is one named module.
 *
 * Phase 6 (review-phase redesign) added the local↔remote sync primitives:
 *   - `pushInitiativeBranch` — dev-loop pushes per WI (G8 precondition).
 *   - `assertLocalRemoteSynced` — the G8 invariant: origin == local HEAD,
 *      main == merge-base. Throws on divergence.
 *   - `confirmPrMerged` — `gh pr view --json state` == MERGED. The ONLY
 *      gate for reflection (G10) + the `_queue/done/` move (G1).
 *   - `alignLocalToRemote` — on confirmed merge, ff local `main` and
 *      prune the initiative branch (closure aligns local↔remote).
 *
 * `mergePullRequest` IS now called by the approve path (superseding G9):
 *   - `POST /api/verdict` 'approve' in `cli/ui-bridge.ts` — the UI approve
 *     merges the remote PR immediately and fires `finalizeMergedReadyForReview`.
 *     M7-5 (ADR-031) removed the old `forge review --approve` CLI merge; the
 *     bridge verdict route is the sole approve surface (its merge is a strict
 *     superset of the deleted CLI path).
 * The operator's approve IS the merge gate (ADR-023 + ADR-021 supersede G9).
 * It remains unreachable from `runReviewer` / `runCycle` / the scheduler.
 *
 * Production assumes a real GitHub remote. Projects without a GitHub
 * remote (e.g. claude-harness fixtures) will no longer run locally.
 */

import { execFileSync } from 'node:child_process';
import { gitIdentityConfigArgs, ORCHESTRATOR_GIT_IDENTITY } from './config.ts';

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import { DEMO_MD_BASENAME, worktreeDemoDir, worktreeDemoJsonPath, worktreeDemoRelDir } from './demo-paths.ts';

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
/** Initiative id from a `forge/<initiativeId>` branch name. */
function basenameInitiativeId(branch: string): string {
  return branch.startsWith('forge/') ? branch.slice('forge/'.length) : branch;
}

/** Parse `owner/repo` from a git origin URL (https or ssh form). */
function parseOwnerRepo(originUrl: string): string | null {
  const s = originUrl.trim().replace(/\.git$/, '');
  const m =
    s.match(/github\.com[:/]([^/]+\/[^/]+)$/) ?? s.match(/[:/]([^/]+\/[^/]+)$/);
  return m ? m[1] : null;
}

const DEMO_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

/**
 * Strip any `## Demo` section (plus trailing content until the next `##`
 * heading or end-of-string) from a PR body. The unifier is told not to
 * include a `## Demo` section, but if it does anyway this prevents a
 * duplicate heading from appearing after `embedDemoInPr` appends the
 * canonical block. Pure string operation; never throws.
 */
export function stripDemoSection(body: string): string {
  // Match "## Demo" (case-insensitive) optionally preceded by a horizontal
  // rule, then consume everything up to (but not including) the next "## "
  // heading or end of string.
  return body.replace(/(?:^|\n)---\s*\n## [Dd]emo\b[\s\S]*?(?=\n## |\n---\s*\n## |$)/g, '').trimEnd();
}

/**
 * S4 amendment (CONTRACTS.md C2 + plan 04 §"PR-as-self-contained-review-window"):
 * `embedDemoInPr` is a **pure PR-body composer**. It does NOT mutate the
 * filesystem (no `cpSync`, no `git add`, no `git commit`). The dev-loop
 * unifier writes the tracked `demo/<initiative-id>/` bundle directly during
 * its own loop and commits it as part of the unifier's closing commit; by
 * the time `openPullRequest` runs the demo already exists on the branch and
 * this function only reads it to produce the `## Demo` markdown body block.
 *
 * Signature change from the prior (combined writer+composer) version:
 *   embedDemoInPr(worktree, initiativeId, branch, trackedDemoDir, isPrivate)
 *     → bodyBlock | null
 *
 * Returns `null` on any failure (no demo, not a GitHub remote, etc.) so PR
 * creation never breaks because of demo composition — but the caller
 * (`openPullRequest`) now asserts `assertTrackedDemoExists` BEFORE composing,
 * so a missing demo is a hard, classified failure earlier in the flow
 * rather than silently dropping the demo block.
 */
export function embedDemoInPr(
  worktreePath: string,
  initiativeId: string,
  branch: string,
  trackedDemoDir: string,
  isPrivate: boolean,
): string | null {
  try {
    if (!existsSync(trackedDemoDir)) return null;
    const entries = readdirSync(trackedDemoDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => !n.startsWith('.'));
    if (entries.length === 0) return null;

    const originUrl = execFileSync('git', ['-C', worktreePath, 'remote', 'get-url', 'origin'], {
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    const ownerRepo = parseOwnerRepo(originUrl);
    if (!ownerRepo) return null; // only GitHub raw URLs render inline

    // The tracked demo dir is worktree-relative; resolve it through the SSOT so
    // a project with an artifactRoot (e.g. betterado's forge/) links correctly.
    const relDir = worktreeDemoRelDir(worktreePath, initiativeId);

    const images = entries
      .filter((n) => DEMO_IMAGE_EXTS.has(extname(n).toLowerCase()))
      .sort();
    const others = entries
      .filter((n) => !DEMO_IMAGE_EXTS.has(extname(n).toLowerCase()))
      .sort();

    const demoMdPath = join(trackedDemoDir, DEMO_MD_BASENAME);

    const rawBase = `https://github.com/${ownerRepo}/raw/${branch}/${relDir}`;
    const blobBase = `https://github.com/${ownerRepo}/blob/${branch}/${relDir}`;
    const lines: string[] = ['', '---', '', '## Demo', ''];

    // Always: the reliable, visibility-agnostic surface.
    if (existsSync(demoMdPath)) {
      lines.push(
        `▶ **[Open the rendered demo: \`${relDir}/DEMO.md\`](${blobBase}/DEMO.md)**` +
          ' — renders inline on GitHub (works for private repos too).',
        '',
      );
    }
    lines.push(
      `The screenshots are also visible in this PR's **Files changed** tab` +
        ` (committed under \`${relDir}/\`).`,
      '',
    );

    if (!isPrivate && images.length > 0) {
      // Public repo: GitHub's proxy can fetch raw → inline them too.
      for (const img of images) {
        const label = img.replace(/\.[^.]+$/, '');
        lines.push(`**${label}**`, '', `![${label}](${rawBase}/${encodeURIComponent(img)})`, '');
      }
    }
    if (others.length > 0) {
      lines.push('Demo artefacts:');
      for (const f of others) lines.push(`- [\`${f}\`](${blobBase}/${encodeURIComponent(f)})`);
      lines.push('');
    }
    return lines.join('\n');
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    process.stderr.write(`[embedDemoInPr] non-fatal: ${stderr || e.message || 'failed'}\n`);
    return null;
  }
}

/**
 * S4: precondition for `openPullRequest`. Throws when the tracked demo
 * bundle is missing — the unifier was supposed to author it and commit it
 * on the branch before review opens the PR. A silent re-commit at PR-open
 * time would mask a unifier failure; a hard throw surfaces it as a
 * classified `dev-loop-unifier-demo-failed` event.
 *
 * Returns the tracked-demo directory path on success (so callers don't
 * recompute it). ADR 021: the structured `demo.json` is the contract the
 * unifier must author (DEMO.md is derived from it via `forge demo render`);
 * this asserts the structured source exists.
 */
export function assertTrackedDemoExists(worktreePath: string, initiativeId: string): string {
  // Resolved through the demo-path SSOT (demo-paths.ts) so the PR-open
  // prerequisite checks demo.json/DEMO.md exactly where the unifier authored
  // them — legacy demo/<id> or <artifactRoot>/history/<id>/demo.
  const dir = worktreeDemoDir(worktreePath, initiativeId);
  const demoJson = worktreeDemoJsonPath(worktreePath, initiativeId);
  if (!existsSync(demoJson)) {
    throw new Error(
      `assertTrackedDemoExists: ${demoJson} is missing — the dev-loop unifier did not author the structured demo (demo.json). ` +
        `Classify as dev-loop-unifier-demo-failed.`,
    );
  }
  return dir;
}

/**
 * Resolve repo visibility via `gh repo view`. Returns true (private) on
 * any error — the safe default per the original embedDemoInPr (a broken
 * inline image is worse than a relative link). Pure helper exposed for
 * the unifier's gate code so the test seam is observable.
 */
export function resolveRepoIsPrivate(worktreePath: string): boolean {
  try {
    const originUrl = execFileSync('git', ['-C', worktreePath, 'remote', 'get-url', 'origin'], {
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    const ownerRepo = parseOwnerRepo(originUrl);
    if (!ownerRepo) return true;
    const vis = execFileSync(
      'gh',
      ['repo', 'view', ownerRepo, '--json', 'isPrivate', '-q', '.isPrivate'],
      { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' },
    ).trim();
    return vis !== 'false';
  } catch {
    return true;
  }
}

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

    const initiativeId = basenameInitiativeId(branch);

    // S4: precondition — the dev-loop unifier MUST have authored the
    // tracked demo bundle before review opens the PR. A missing demo at
    // this point is a hard error (classified as dev-loop-unifier-demo-failed
    // upstream), NOT something to silently re-commit. The prior cpSync +
    // git commit path masked unifier failures by re-creating the bundle
    // from .forge/demos/; that flow is gone — embedDemoInPr is a pure
    // composer now.
    const trackedDemoDir = assertTrackedDemoExists(worktreePath, initiativeId);
    const isPrivate = resolveRepoIsPrivate(worktreePath);

    // Compose the demo block from the (already-tracked) bundle.
    let bodyFile = prDescriptionPath;
    try {
      const demoMd = embedDemoInPr(worktreePath, initiativeId, branch, trackedDemoDir, isPrivate);
      if (demoMd) {
        let base = existsSync(prDescriptionPath)
          ? readFileSync(prDescriptionPath, 'utf8')
          : '';
        // Dedup: if the agent-authored PR body already contains a ## Demo heading,
        // strip it (and any trailing content until the next ##) so the canonical
        // demo block appended below is the only one. Handles the case where the
        // unifier ignored the "don't add ## Demo" instruction.
        base = stripDemoSection(base);
        const combined = join(worktreePath, '.forge', 'pr-body-with-demo.md');
        mkdirSync(join(worktreePath, '.forge'), { recursive: true });
        writeFileSync(combined, base + '\n' + demoMd + '\n');
        bodyFile = combined;
      }
    } catch {
      /* keep the plain description — composition errors must not block PR open */
    }

    // Strip any gitignored .forge/ scratch the agent may have force-added
    // BEFORE the push so it can never reach origin (prevents the fixed-path
    // .forge/pr-description.md add/add conflict across parallel initiatives).
    stripForgeScratchFromBranch(worktreePath);

    // Push to origin (set-upstream so gh pr create knows the head ref).
    // Failures here propagate to the catch — a non-pushable branch is a
    // genuine merge blocker, not a soft warning.
    execFileSync('git', ['push', '--set-upstream', 'origin', branch], {
      cwd: worktreePath,
      stdio: 'pipe',
    });

    // A PR may already exist for this branch — a resume/send-back (resume_from
    // developer|unifier) preserves the branch AND its open PR. `gh pr create`
    // errors in that case ("a pull request already exists"); the push above has
    // already updated the PR with the new commits, so detect the existing PR,
    // refresh its body with the re-composed demo, and reuse it. This makes
    // PR-open idempotent — without it a resumed cycle that produced a perfectly
    // good branch fails at PR-open (mis-reported as a missing prerequisite).
    const existing = prRef(worktreePath);
    if (existing) {
      try {
        execFileSync('gh', ['pr', 'edit', String(existing.number), '--body-file', bodyFile], {
          cwd: worktreePath,
          stdio: 'pipe',
        });
      } catch {
        /* body refresh is best-effort — the new commits are already on the PR */
      }
      return existing.url;
    }

    const out = execFileSync(
      'gh',
      ['pr', 'create', '--body-file', bodyFile, '--title', title],
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

export type PrRef = { owner: string; repo: string; number: number; url: string };

/**
 * Resolve the OPEN PullRequest for the worktree's current branch, plus the
 * owner/repo needed to drive `gh api .../comments`. Returns null when there
 * is no open PR, no remote, or `gh` is unavailable.
 */
export function prRef(worktreePath: string): PrRef | null {
  const branch = currentBranch(worktreePath);
  if (!branch) return null;
  try {
    const originUrl = execFileSync('git', ['-C', worktreePath, 'remote', 'get-url', 'origin'], {
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    const ownerRepo = parseOwnerRepo(originUrl);
    if (!ownerRepo) return null;
    const [owner, repo] = ownerRepo.split('/');
    const out = execFileSync(
      'gh',
      ['pr', 'view', branch, '--json', 'number,url,state', '-q', '{n:.number,u:.url,s:.state}'],
      { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' },
    ).trim();
    const parsed = JSON.parse(out) as { n: number; u: string; s: string };
    if (!parsed || parsed.s !== 'OPEN' || typeof parsed.n !== 'number') return null;
    return { owner, repo, number: parsed.n, url: parsed.u };
  } catch {
    return null;
  }
}

/**
 * Idempotent PR ensure (P3 — the PR is the durable review window, created
 * at the END of review iteration 1, NOT gated behind an approve verdict).
 *
 *  - No open PR yet  → `openPullRequest` (push + embed demo + `gh pr create`).
 *  - Open PR exists  → push the latest commits so send-back-round fixes land
 *                      on the SAME PR, and return its URL.
 *
 * Returns null only when there is no remote / `gh` is unavailable.
 */
export function ensurePullRequest(
  worktreePath: string,
  prDescriptionPath: string,
  title: string,
): string | null {
  const existing = prRef(worktreePath);
  if (existing) {
    // Subsequent (send-back) round: publish new commits to the same PR.
    pushInitiativeBranch(worktreePath);
    return existing.url;
  }
  return openPullRequest(worktreePath, prDescriptionPath, title);
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

/**
 * Resolve the current branch name of a worktree. Returns null for a
 * detached HEAD or a non-git path (callers treat that as "cannot push").
 */
function currentBranch(worktreePath: string): string | null {
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
 * cascade-v4 #4: on a resume-from-unifier, another cycle may have merged to
 * `main` between the stall and the resume — so the preserved initiative branch
 * no longer has `main` as its merge-base, and the dev-loop-close invariant
 * (`main == merge-base`) fails at the END of the resumed cycle, wasting the
 * whole unifier run. Rebase the preserved branch onto current main at the START
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

// ---------------------------------------------------------------------------
// N6 (plan 2.8) — post-merge CI watch. After a confirmed merge, forge no
// longer walks away: closure polls the merged commit's GitHub Actions runs
// (bounded) and surfaces the result as `cycle.post-merge-ci` events. All gh
// shelling for it lives here (this module is the gh boundary).
// ---------------------------------------------------------------------------

/** One GitHub Actions run as reported by `gh run list`. */
export type CiRun = {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  databaseId?: number;
  workflowName?: string;
};

export type PostMergeCiOutcome =
  | { status: 'green'; sha: string; runs: Array<{ name: string; url: string }> }
  | { status: 'red'; sha: string; failing: Array<{ name: string; url: string; failing_jobs: string[] }> }
  | { status: 'no-ci'; sha: string; detail: string }
  | { status: 'timeout'; sha: string; pending: string[] }
  | { status: 'unavailable'; detail: string };

/** Conclusions that count as green. Everything else on a completed run is red. */
const CI_GOOD_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

/**
 * Pure verdict over a run list (unit-testable without gh):
 *   - any COMPLETED run with a non-green conclusion → red (fail fast — a red
 *     is a red regardless of siblings still running)
 *   - anything not yet completed → pending
 *   - empty list → pending (no signal yet; the caller decides no-ci at the
 *     deadline)
 *   - else → green
 */
export function evaluateCiRuns(
  runs: CiRun[],
):
  | { verdict: 'green' }
  | { verdict: 'red'; failing: CiRun[] }
  | { verdict: 'pending'; pending: CiRun[] } {
  const failing = runs.filter(
    (r) => r.status === 'completed' && !CI_GOOD_CONCLUSIONS.has(r.conclusion ?? ''),
  );
  if (failing.length > 0) return { verdict: 'red', failing };
  const pending = runs.filter((r) => r.status !== 'completed');
  if (runs.length === 0 || pending.length > 0) return { verdict: 'pending', pending };
  return { verdict: 'green' };
}

/** The merged PR's merge-commit sha via `gh pr view`. Null when unresolvable. */
function mergedCommitSha(worktreePath: string): string | null {
  try {
    const out = execFileSync('gh', ['pr', 'view', '--json', 'mergeCommit'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out) as { mergeCommit?: { oid?: unknown } };
    const oid = parsed.mergeCommit?.oid;
    return typeof oid === 'string' && oid.length > 0 ? oid : null;
  } catch {
    return null;
  }
}

/** Workflow count for the repo. Null when `gh workflow list` fails. */
function repoWorkflowCount(worktreePath: string): number | null {
  try {
    const out = execFileSync('gh', ['workflow', 'list', '--json', 'id'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out) as unknown;
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

/** Actions runs for the given commit. Null when `gh run list` fails. */
function listCommitCiRuns(worktreePath: string, sha: string): CiRun[] | null {
  try {
    const out = execFileSync(
      'gh',
      ['run', 'list', '--commit', sha, '--json', 'name,status,conclusion,url,databaseId,workflowName'],
      { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' },
    );
    const parsed = JSON.parse(out) as unknown;
    if (!Array.isArray(parsed)) return null;
    return (parsed as Array<Record<string, unknown>>).map((r) => ({
      name: typeof r.workflowName === 'string' && r.workflowName ? r.workflowName : String(r.name ?? '(unnamed run)'),
      status: String(r.status ?? ''),
      conclusion: typeof r.conclusion === 'string' && r.conclusion ? r.conclusion : null,
      url: String(r.url ?? ''),
      databaseId: typeof r.databaseId === 'number' ? r.databaseId : undefined,
    }));
  } catch {
    return null;
  }
}

/** Failing job names within a run. Best-effort — errors yield []. */
function failingJobNames(worktreePath: string, runId: number | undefined): string[] {
  if (typeof runId !== 'number') return [];
  try {
    const out = execFileSync('gh', ['run', 'view', String(runId), '--json', 'jobs'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out) as { jobs?: Array<{ name?: unknown; conclusion?: unknown }> };
    return (parsed.jobs ?? [])
      .filter((j) => typeof j.conclusion === 'string' && !CI_GOOD_CONCLUSIONS.has(j.conclusion))
      .map((j) => String(j.name ?? '(unnamed job)'));
  } catch {
    return [];
  }
}

/**
 * Bounded post-merge CI watch (N6). Resolves the merged commit's sha, then
 * polls its Actions runs until green / red / the deadline. NEVER throws —
 * every degraded state maps to a structured outcome ('no-ci' when the
 * project has no workflows or none triggered for the commit; 'unavailable'
 * when gh itself cannot answer; 'timeout' when runs are still in flight at
 * the deadline). Red does NOT auto-fix anything — the caller emits the
 * event + needs-operator marker and moves on.
 */
export async function watchPostMergeCi(
  worktreePath: string,
  opts: { timeoutMs: number; pollIntervalMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<PostMergeCiOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const sha = mergedCommitSha(worktreePath);
  if (!sha) {
    return { status: 'unavailable', detail: 'could not resolve the merged commit sha via `gh pr view --json mergeCommit`' };
  }

  // No workflows configured → nothing will ever run for this commit. Skip
  // without polling (the caller emits a debug-level event).
  const workflowCount = repoWorkflowCount(worktreePath);
  if (workflowCount === 0) {
    return { status: 'no-ci', sha, detail: 'no GitHub Actions workflows configured for this repo' };
  }

  const deadline = Date.now() + opts.timeoutMs;
  let sawRuns = false;
  let lastPending: CiRun[] = [];
  let ghEverAnswered = workflowCount !== null;

  for (;;) {
    const runs = listCommitCiRuns(worktreePath, sha);
    if (runs !== null) {
      ghEverAnswered = true;
      if (runs.length > 0) sawRuns = true;
      const verdict = evaluateCiRuns(runs);
      if (verdict.verdict === 'green') {
        return { status: 'green', sha, runs: runs.map((r) => ({ name: r.name, url: r.url })) };
      }
      if (verdict.verdict === 'red') {
        return {
          status: 'red',
          sha,
          failing: verdict.failing.map((r) => ({
            name: r.name,
            url: r.url,
            failing_jobs: failingJobNames(worktreePath, r.databaseId),
          })),
        };
      }
      lastPending = verdict.pending;
    }
    if (Date.now() + opts.pollIntervalMs > deadline) break;
    await sleep(opts.pollIntervalMs);
  }

  if (!ghEverAnswered) {
    return { status: 'unavailable', detail: 'gh could not list workflow runs for the merged commit (every poll errored)' };
  }
  if (!sawRuns) {
    return { status: 'no-ci', sha, detail: 'workflows exist but no run appeared for the merged commit within the watch window' };
  }
  return { status: 'timeout', sha, pending: lastPending.map((r) => r.name) };
}

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
