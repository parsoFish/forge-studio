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
 *   - `POST /api/verdict` 'approve' in `apps/forge/ui-bridge.ts` — the UI approve
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

import { ghForWorktree, githubOwnerRepoForWorktree } from './gh-pinned.ts';
// Imported, not merely re-exported: a `export … from` does not bring a name
// into local scope, and the PR-lifecycle functions below call both.
// (`pushInitiativeBranch` left with the dead `ensurePullRequest` that was its
// only local caller — it is still exported from `pr-branch-sync.ts` for the
// callers that use it directly.)
import { currentBranch, stripForgeScratchFromBranch } from './pr-branch-sync.ts';

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import { guardedReadDir } from '@forge/kernel';
import { DEMO_MD_BASENAME, SAFE_CAPTURE_NAME_RE, worktreeDemoDir, worktreeDemoJsonPath, worktreeDemoRelDir } from './demo-paths.ts';

/**
 * Best-effort PR creation via `gh pr create`. Returns `{ url }` on success,
 * `{ error }` on failure — bead `forge-8vfn.8.1.24` / T1 ruling 1609: this
 * NEVER returns a bare null. A caller that only logged to stderr and returned
 * null had no way to tell a DNS outage from a genuinely missing demo bundle,
 * so the cause never reached the event log or the failure classifier. The
 * reviewer's PR-description draft lives at `<worktree>/.forge/pr-description.md`
 * and is passed via `--body-file`.
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

const DEMO_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

/**
 * URL-encode a repo-relative path SEGMENT BY SEGMENT, never the whole string
 * — an initiative id, artifactRoot, or checkpoint label can carry a
 * character (space, `#`, `?`, `&`) that must not corrupt the surrounding
 * markdown link or the query string, but the `/` separators between
 * `relDir`, `.capture`, `<side>` and the filename must stay literal
 * separators, not become `%2F`.
 */
function encodeRelPath(relPath: string): string {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

/** One checkpoint label's captured media on one side (`.capture/<side>/`) —
 *  `filmstrip` mirrors `collectCapturedMedia`'s own precedence (stations
 *  demo-model.ts): a `.filmstrip.png` always wins over a plain `.png` of the
 *  same label. */
type CaptureSideMedia = { filmstrip?: string; filmstripIsReal?: boolean; webm?: string };

/**
 * Enumerate `<trackedDemoDir>/.capture/<side>/`, grouped by checkpoint label.
 * Containment goes through `@forge/kernel`'s `resolveGuardedPath`
 * (`guardedReadDir`) rather than a raw `readdirSync` — the same reasoning as
 * `collectCommittableCaptureMedia` in orchestrated-capture.ts: a demo
 * `command` checkpoint runs arbitrary project code with cwd = the worktree,
 * so `.capture/<side>/` is not fully trusted input. In practice this is a
 * secondary defence here — `trackedCaptureFiles` below is the one that
 * actually decides what gets linked, and a symlink was already refused at
 * commit time (deliverable 1) so it can never appear there — but enumerating
 * through the same guard keeps the two call sites consistent rather than one
 * raw and one guarded.
 */
function scanCaptureSide(trackedDemoDir: string, side: 'before' | 'after'): Map<string, CaptureSideMedia> {
  const byLabel = new Map<string, CaptureSideMedia>();
  const names = guardedReadDir(trackedDemoDir, ['.capture', side]);
  if (!names) return byLabel;
  for (const name of names.sort()) {
    if (!SAFE_CAPTURE_NAME_RE.test(name)) continue; // never linked: see SAFE_CAPTURE_NAME_RE
    const lower = name.toLowerCase();
    if (lower.endsWith('.filmstrip.png')) {
      const label = name.slice(0, name.length - '.filmstrip.png'.length);
      byLabel.set(label, { ...byLabel.get(label), filmstrip: name, filmstripIsReal: true });
    } else if (lower.endsWith('.png')) {
      const label = name.slice(0, name.length - '.png'.length);
      const entry = byLabel.get(label) ?? {};
      if (!entry.filmstripIsReal) byLabel.set(label, { ...entry, filmstrip: name });
    } else if (lower.endsWith('.webm')) {
      const label = name.slice(0, name.length - '.webm'.length);
      byLabel.set(label, { ...byLabel.get(label), webm: name });
    }
  }
  return byLabel;
}

/**
 * The `.capture/**` paths ACTUALLY committed at `ref` — the single source of
 * truth for what `embedDemoInPr` may safely link/inline. Deliberately
 * re-derived from git rather than re-running deliverable 1's size bounds: a
 * file present on disk but missing from this set was refused or skipped at
 * commit time for ANY reason (oversize, symlink), and git is the one place
 * that fact is already recorded without duplicating that logic here. Best
 * effort: a `git ls-tree` failure (e.g. `ref` unresolvable) reads as "nothing
 * committed", which degrades to text-only links, never a thrown error.
 */
function trackedCaptureFiles(worktreePath: string, ref: string, relDir: string): Set<string> {
  try {
    const out = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', `${relDir}/.capture`], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Compose the "Captured checkpoints" media block (forge-mfv5.2.5):
 * inline every committed `.filmstrip.png` (falling back to a plain `.png` of
 * the same label) under `.capture/after/` and, when present,
 * `.capture/before/`, plus a link to each committed `.webm`. Images use
 * `blob/<ref>/…?raw=true` — GitHub's renderer does not rewrite/sign this URL
 * (measured 2026-09-27 on a private repo — a signed-in viewer's own session
 * covers it, an anonymous viewer sees the caveat line below instead of a
 * broken image), so a plain `raw/<ref>/…` link is not substituted here.
 * A file present on disk but NOT in `trackedCaptureFiles` (deliverable 1
 * refused or skipped it — oversize, symlink) is named in one "Skipped" line
 * rather than linked to a 404.
 */
function buildCaptureMediaBlock(
  worktreePath: string,
  ref: string,
  relDir: string,
  trackedDemoDir: string,
  ownerRepo: string,
  isPrivate: boolean,
): string[] {
  const bySide: Record<'before' | 'after', Map<string, CaptureSideMedia>> = {
    before: scanCaptureSide(trackedDemoDir, 'before'),
    after: scanCaptureSide(trackedDemoDir, 'after'),
  };
  const labels = [...new Set([...bySide.before.keys(), ...bySide.after.keys()])].sort();
  if (labels.length === 0) return [];

  const tracked = trackedCaptureFiles(worktreePath, ref, relDir);
  const blobBase = `https://github.com/${ownerRepo}/blob/${ref}`;
  const captureUrl = (side: 'before' | 'after', file: string): string =>
    `${blobBase}/${encodeRelPath(`${relDir}/.capture/${side}/${file}`)}`;

  const lines: string[] = ['', '### Captured checkpoints', ''];
  const skipped: string[] = [];
  let anyInlined = false;
  for (const label of labels) {
    lines.push(`**${label}**`, '');
    for (const side of ['before', 'after'] as const) {
      const filmstrip = bySide[side].get(label)?.filmstrip;
      if (!filmstrip) continue;
      const relPath = `${relDir}/.capture/${side}/${filmstrip}`;
      if (!tracked.has(relPath)) {
        skipped.push(relPath);
        continue;
      }
      lines.push(`![${label} — ${side}](${captureUrl(side, filmstrip)}?raw=true)`, '');
      anyInlined = true;
    }
    for (const side of ['before', 'after'] as const) {
      const webm = bySide[side].get(label)?.webm;
      if (!webm) continue;
      const relPath = `${relDir}/.capture/${side}/${webm}`;
      if (!tracked.has(relPath)) {
        skipped.push(relPath);
        continue;
      }
      lines.push(`[▶ ${label} — ${side} (webm)](${captureUrl(side, webm)})`, '');
    }
  }
  if (isPrivate && anyInlined) {
    lines.push(
      "_The inline image above needs the viewer's github.com session; the committed files are in **Files changed** and DEMO.md._",
      '',
    );
  }
  if (skipped.length > 0) {
    lines.push(`Skipped (not committed — over the media size bound): ${skipped.map((s) => `\`${s}\``).join(', ')}`, '');
  }
  return lines;
}

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
 *   embedDemoInPr(worktree, initiativeId, ref, trackedDemoDir, isPrivate)
 *     → bodyBlock | null
 *
 * `ref` (forge-mfv5.2.5; was `branch`) is COMMIT-PINNED, not
 * branch-moving — every link/image below resolves against this exact commit.
 * The caller (`openPullRequest`) resolves it via `git rev-parse HEAD` in the
 * worktree right after the capture commit lands, falling back to the branch
 * name on any resolution failure; this function does not care which shape it
 * received, only that it names a real ref at call time.
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
  ref: string,
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

    const gh = githubOwnerRepoForWorktree(worktreePath);
    if (!gh) return null; // only GitHub raw URLs render inline
    const ownerRepo = `${gh.owner}/${gh.repo}`;

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

    const rawBase = `https://github.com/${ownerRepo}/raw/${ref}/${encodeRelPath(relDir)}`;
    const blobBase = `https://github.com/${ownerRepo}/blob/${ref}/${encodeRelPath(relDir)}`;
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
    lines.push(...buildCaptureMediaBlock(worktreePath, ref, relDir, trackedDemoDir, ownerRepo, isPrivate));
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
    const gh = githubOwnerRepoForWorktree(worktreePath);
    if (!gh) return true;
    const ownerRepo = `${gh.owner}/${gh.repo}`;
    const vis = ghForWorktree(worktreePath)(['repo', 'view', ownerRepo, '--json', 'isPrivate', '-q', '.isPrivate'], worktreePath).trim();
    return vis !== 'false';
  } catch {
    return true;
  }
}

/** Bead `forge-8vfn.8.1.24` / T1 ruling 1609: `openPullRequest`'s discriminated
 *  result — `{ url }` on success, `{ error }` naming the cause on failure. */
export type OpenPullRequestResult = { url: string } | { error: string };

export function openPullRequest(
  worktreePath: string,
  prDescriptionPath: string,
  title: string,
): OpenPullRequestResult {
  try {
    // Determine the current branch in the worktree.
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    if (!branch || branch === 'HEAD') {
      return { error: 'no branch: HEAD is unborn or detached in this worktree' };
    }

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

    // Commit-pinned ref for the demo block (forge-mfv5.2.5): the
    // capture commit (if any) has already landed on this branch by the time
    // PR-open runs, so resolving HEAD here pins every link/image to real,
    // already-committed content rather than a branch name that can move
    // under a reader later. Fails soft to the branch name — a git error here
    // is not a reason to block PR-open, only to lose the pinning.
    let demoRef = branch;
    try {
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' }).trim();
      if (sha) demoRef = sha;
    } catch (err) {
      const e = err as { stderr?: Buffer | string; message?: string };
      const reason = (typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString()) || e.message || 'unknown error';
      process.stderr.write(
        `[openPullRequest] could not resolve HEAD sha for commit-pinned demo links, falling back to branch "${branch}": ${reason}\n`,
      );
    }

    // Compose the demo block from the (already-tracked) bundle.
    let bodyFile = prDescriptionPath;
    try {
      const demoMd = embedDemoInPr(worktreePath, initiativeId, demoRef, trackedDemoDir, isPrivate);
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
        ghForWorktree(worktreePath)(['pr', 'edit', String(existing.number), '--body-file', bodyFile], worktreePath);
      } catch {
        /* body refresh is best-effort — the new commits are already on the PR */
      }
      return { url: existing.url };
    }

    const out = ghForWorktree(worktreePath)(['pr', 'create', '--body-file', bodyFile, '--title', title], worktreePath);
    const match = out.match(/https:\S+/);
    const url = match ? match[0] : out.trim();
    if (!url) return { error: 'gh pr create produced no PR URL in its output' };
    return { url };
  } catch (err) {
    // Surface the failure on stderr so the operator sees what went wrong,
    // AND return it — bead forge-8vfn.8.1.24: a caller that only got null
    // could never tell an environment outage from a genuine defect.
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    const text = stderr || e.message || 'openPullRequest failed with no diagnostic message';
    process.stderr.write(`[openPullRequest] ${text}\n`);
    return { error: text };
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
    const gh = githubOwnerRepoForWorktree(worktreePath);
    if (!gh) return null;
    const { owner, repo } = gh;
    const out = ghForWorktree(worktreePath)(['pr', 'view', branch, '--json', 'number,url,state', '-q', '{n:.number,u:.url,s:.state}'], worktreePath).trim();
    const parsed = JSON.parse(out) as { n: number; u: string; s: string };
    if (!parsed || parsed.s !== 'OPEN' || typeof parsed.n !== 'number') return null;
    return { owner, repo, number: parsed.n, url: parsed.u };
  } catch {
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
    // 597(a): pinned to the OWNER OF THE REMOTE THIS WORKTREE PUSHES TO, never
    // to whatever account happens to be active on the host. A pin that cannot be
    // made throws, and the catch below reports the merge as failed — which is
    // the right answer: not merging is better than merging as someone nobody named.
    ghForWorktree(worktreePath)(['pr', 'merge', '--merge'], worktreePath);
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

// N6 (plan 2.8) — the post-merge CI watch (`CiRun`, `PostMergeCiOutcome`,
// `evaluateCiRuns`, `watchPostMergeCi`) moved to `./pr-ci-watch.ts` under the
// 800-line cap, taking its own charter with it. It referenced nothing else in
// this file, which is why it went first.
export { evaluateCiRuns, watchPostMergeCi } from './pr-ci-watch.ts';
export type { CiRun, PostMergeCiOutcome } from './pr-ci-watch.ts';

// Local git ↔ remote invariants — pushing the branch, proving it merged, and
// realigning a drifted worktree — moved to `./pr-branch-sync.ts` under the
// 800-line cap. This file is the GitHub PR API; that one is git and the remote.
export {
  stripForgeScratchFromBranch,
  pushInitiativeBranch,
  rebasePreservedBranchOntoMain,
  checkLocalRemoteSynced,
  assertLocalRemoteSynced,
  confirmPrMerged,
  alignLocalToRemote,
} from './pr-branch-sync.ts';
export type { PushResult, ResumeRebaseResult, LocalRemoteInvariant, AlignResult } from './pr-branch-sync.ts';
