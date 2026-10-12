/**
 * What the adversarial review DERIVES for content review — forge-nk1y.39.
 *
 * Measured on gitweave I3a round 3: a 109-file branch diff whose orchestrated
 * demo bundle (`demo/<initiative>/demo.json`, 1,203,956 bytes of text diff)
 * overflowed `execFileSync`'s default 1 MiB buffer, and 66 git-binary demo
 * captures rode in the same `unattributed` chunk. Two rules follow:
 *
 * 1. Every git read the review makes carries an EXPLICIT, bounded buffer
 *    (`REVIEW_GIT_MAX_BUFFER_BYTES`). Overflowing it is still a named failure —
 *    a derivation error — never a truncated diff.
 * 2. Two kinds of changed path are never content-derived, and each is NAMED in
 *    the findings as not reviewed: a git-binary file (its diff is one
 *    "Binary files differ" line — there is nothing for a reader to judge) and
 *    the orchestrator's own demo bundle (D-15: the orchestrator captures the
 *    evidence; the verdict gate renders it beside the review — a work item
 *    never authors it, so it is not the change under review).
 *
 * A large TEXT file a work item (or nobody) changed is still reviewed: size
 * alone never excludes.
 */

import type { NotReviewedPath } from '@forge/flows';

/**
 * The bound on one git read's stdout. 64 MiB is ~50× the largest measured
 * chunk diff (I3a's 1.2 MiB) — large enough that a real initiative's text
 * diff fits, small enough that a runaway read fails by name instead of
 * exhausting the daemon's memory.
 */
export const REVIEW_GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * The binary paths in a `git diff --numstat -z` stream. Git prints `-\t-\t`
 * for a binary file; with `-z` a path is unquoted and NUL-terminated, and a
 * rename is `-\t-\t\0<old>\0<new>\0` — the NEW path is the one in the diff's
 * name list.
 */
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

/**
 * Split the changed files into the ones derived for review and the ones named
 * as not reviewed. A binary inside the demo bundle is named `binary` — the more
 * specific fact about the file. Order is preserved.
 */
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
