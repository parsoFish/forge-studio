/**
 * What the adversarial review DERIVES for content review — forge-nk1y.39. Gitweave I3a
 * round 3's demo bundle (`demo.json`, 1.2 MB of text diff) overflowed execFileSync's
 * 1 MiB default buffer beside 66 binary captures. So every git read carries an explicit
 * bound, and two kinds of changed path are named as not reviewed instead of derived: a
 * git-binary file (its diff is "Binary files differ") and the orchestrator's own demo
 * bundle (D-15; the gate renders it beside the review) — but only a file no commit
 * other than the orchestrator's touched: an agent's file there is reviewed like any other.
 * A large TEXT file is still reviewed: size alone never excludes.
 */

import type { NotReviewedPath } from '@forge/flows';
import { ORCHESTRATOR_GIT_IDENTITY } from '@forge/kernel';

import type { ReviewChunk } from './review-chunks.ts';

/** One git read's stdout bound: ~50× I3a's 1.2 MiB; a runaway read fails by name, not by OOM. */
export const REVIEW_GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** One `git diff --numstat -z` read: changed lines (the review ceiling) and the binary paths (`-\t-\t`; a rename's new path counts). */
export function parseNumstatZ(out: string): { changedLines: number; binaries: Set<string> } {
  const binaries = new Set<string>();
  let changedLines = 0;
  const tokens = out.split('\0');
  for (let i = 0; i < tokens.length; i += 1) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(tokens[i]!);
    if (m === null) continue;
    let path = m[3]!;
    if (path === '') { path = tokens[i + 2] ?? ''; i += 2; } // rename / copy: old, new
    if (m[1] === '-' && m[2] === '-') binaries.add(path);
    else changedLines += Number(m[1]) + Number(m[2]);
  }
  return { changedLines, binaries };
}

/** Paths any NON-orchestrator, non-merge commit touched, from `git log --no-merges --format=%x01%ae --name-only -z <range>`. */
export function agentTouchedPaths(logZ: string): Set<string> {
  const touched = new Set<string>();
  for (const commit of logZ.split('\x01').slice(1)) {
    const [email, ...paths] = commit.split('\0');
    if (email === ORCHESTRATOR_GIT_IDENTITY.email) continue;
    for (const p of paths) if (p.trim() !== '') touched.add(p.replace(/^\n/, ''));
  }
  return touched;
}

/** True when `path` is the demo bundle dir itself or nested under it. */
function underDir(path: string, dir: string): boolean {
  const d = dir.replace(/\/+$/, '');
  return d !== '' && (path === d || path.startsWith(`${d}/`));
}

/**
 * Strip the named-not-reviewed paths out of each chunk. A work item left with
 * nothing to derive is returned in `emptied` (its criteria are not "missed" —
 * nothing was judged); an emptied unattributed chunk is dropped.
 */
export function scopeChunks(
  chunks: readonly ReviewChunk[],
  facts: { binaries: ReadonlySet<string>; demoRelDir: string; agentTouched: ReadonlySet<string> },
): { chunks: ReviewChunk[]; notReviewed: NotReviewedPath[]; emptied: Array<{ workItemId: string; files: string[] }> } {
  const notReviewed: NotReviewedPath[] = [];
  const kept: ReviewChunk[] = [];
  const emptied: Array<{ workItemId: string; files: string[] }> = [];
  for (const chunk of chunks) {
    const files: string[] = [];
    for (const path of chunk.files) {
      if (facts.binaries.has(path)) notReviewed.push({ path, reason: 'binary' });
      else if (underDir(path, facts.demoRelDir) && !facts.agentTouched.has(path)) notReviewed.push({ path, reason: 'demo-bundle' });
      else files.push(path);
    }
    if (files.length > 0) kept.push({ ...chunk, files });
    else if (chunk.workItemId !== null) emptied.push({ workItemId: chunk.workItemId, files: [...chunk.files] });
  }
  return { chunks: kept, notReviewed, emptied };
}
