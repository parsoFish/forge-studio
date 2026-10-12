/**
 * What the adversarial review DERIVES for content review — forge-nk1y.39. Gitweave I3a
 * round 3's demo bundle (`demo.json`, 1.2 MB of text diff) overflowed execFileSync's
 * 1 MiB default buffer beside 66 binary captures. So every git read carries an explicit
 * bound, and two kinds of changed path are named as not reviewed instead of derived: a
 * git-binary file (its diff is "Binary files differ") and the orchestrator's own demo
 * bundle (D-15 — no work item authors it; the gate renders it beside the review).
 * A large TEXT file is still reviewed: size alone never excludes.
 */

import type { NotReviewedPath } from '@forge/flows';

/** One git read's stdout bound: ~50× I3a's 1.2 MiB; a runaway read fails by name, not by OOM. */
export const REVIEW_GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** Binary paths in `git diff --numstat -z` (`-\t-\t<path>`; a rename is `-\t-\t\0<old>\0<new>`, the new path counts). */
export function binaryPathsFromNumstatZ(out: string): Set<string> {
  const binaries = new Set<string>();
  const tokens = out.split('\0');
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (t === '') continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(t);
    if (m === null) continue;
    let path = m[3]!;
    if (path === '') {
      // rename / copy: the next two tokens are old and new.
      path = tokens[i + 2] ?? '';
      i += 2;
    }
    if (m[1] === '-' && m[2] === '-' && path !== '') binaries.add(path);
  }
  return binaries;
}

/** True when `path` is the demo bundle dir itself or nested under it. */
function underDir(path: string, dir: string): boolean {
  const d = dir.replace(/\/+$/, '');
  return d !== '' && (path === d || path.startsWith(`${d}/`));
}

/** Reviewable vs named-not-reviewed, order kept; a binary inside the bundle is named `binary`. */
export function splitReviewable(
  changedFiles: readonly string[],
  binaries: ReadonlySet<string>,
  demoRelDir: string,
): { reviewable: string[]; notReviewed: NotReviewedPath[] } {
  const reviewable: string[] = [];
  const notReviewed: NotReviewedPath[] = [];
  for (const path of changedFiles) {
    if (binaries.has(path)) notReviewed.push({ path, reason: 'binary' });
    else if (underDir(path, demoRelDir)) notReviewed.push({ path, reason: 'demo-bundle' });
    else reviewable.push(path);
  }
  return { reviewable, notReviewed };
}
