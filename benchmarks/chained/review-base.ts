/**
 * Resolve the directory the chained bench hands to the review-loop rubric.
 *
 * Extracted from `score.ts` (a top-level-await runner that can't be imported
 * without executing the whole bench) so this path-resolution logic is
 * trivially unit-testable against preserved real-run artifacts WITHOUT any
 * SDK call or paid run.
 *
 * `reviewCaseScore` (benchmarks/review-loop/scoring.ts) resolves
 * `<dir>/.forge/pr-description.md` and `<dir>/.forge/demos/<id>/`, so the dir
 * it is handed MUST be one where `<dir>/.forge/` resolves.
 */

import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ChainArtifacts } from './sdk.ts';

/**
 * Handle for the dir handed to the review-loop rubric. `synthesized` is true
 * only when we had to build a symlink-to-snapshot stand-in (the worktree
 * `.forge/` was wiped by the gh-shim's post-merge `git clean -fdX`); in that
 * case `dir` is a fresh tempdir we own and must clean up. When the worktree
 * `.forge/` survived, `dir` IS `artifacts.worktreePath` and MUST NOT be
 * deleted (it's the live merged worktree, cleaned by `cleanupTempdir`).
 */
export type ReviewBaseHandle = { dir: string; synthesized: boolean };

/**
 * Resolve the dir to hand the review-loop rubric.
 *
 * BUG (false-red) this fixes: the previous code passed
 * `resolve(forgeSnapshotDir, '..')` when the snapshot existed. But
 * `forgeSnapshotDir` (`<tempdir>/_forge-snapshot`) is a copy of the `.forge/`
 * *contents* (it holds `pr-description.md` + `demos/` directly), so its parent
 * is the tempdir root and `<tempdir>/.forge/pr-description.md` does NOT exist
 * → every `pr_description_*` / `demo_*` / `pr_links_demo` /
 * `merge_strategy_respected` criterion scored 0 even though the reviewer
 * genuinely produced all of them.
 *
 * Correct resolution (minimal): prefer the real worktree
 * (`artifacts.worktreePath`) when its `.forge/pr-description.md` exists — the
 * most faithful source, no synthesis. Only if the worktree's `.forge/` was
 * wiped (gh-shim post-merge `git clean -fdX` strips gitignored `.forge/`)
 * fall back to a synthesized tempdir whose `.forge/` symlinks to
 * `forgeSnapshotDir` (the snapshot's whole purpose — survive the clean). The
 * symlink keeps the snapshot semantics intact without copying.
 */
export function resolveReviewBaseDir(
  a: Pick<ChainArtifacts, 'worktreePath' | 'forgeSnapshotDir'>,
): ReviewBaseHandle {
  const worktreePr = resolve(a.worktreePath, '.forge', 'pr-description.md');
  if (existsSync(worktreePr)) {
    return { dir: a.worktreePath, synthesized: false };
  }
  // Worktree `.forge/` was cleaned post-merge. Synthesize a base dir whose
  // `.forge/` IS the durable pre-merge snapshot.
  if (existsSync(a.forgeSnapshotDir)) {
    const base = mkdtempSync(join(tmpdir(), 'forge-chained-reviewbase-'));
    try {
      symlinkSync(a.forgeSnapshotDir, resolve(base, '.forge'));
    } catch {
      /* best-effort — caseScore degrades to 0 if the link can't be made */
    }
    return { dir: base, synthesized: true };
  }
  // No snapshot either — hand back the worktree (rubric will score 0; this is
  // an honest "no review artifacts produced", not a path bug).
  return { dir: a.worktreePath, synthesized: false };
}

/**
 * Remove the synthesized review base dir. No-op for a non-synthesized handle
 * (that `dir` is the live worktree — deleting it would corrupt the run).
 */
export function cleanupReviewBaseDir(handle: ReviewBaseHandle | null): void {
  if (!handle || !handle.synthesized) return;
  try {
    rmSync(handle.dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
