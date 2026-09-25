/**
 * matchGlob — tiny path-glob matcher.
 *
 * Semantics:
 *   `**` segment  → matches zero or more path segments (any depth).
 *   `*`  in segment → matches any sequence of non-`/` characters within a
 *                     single segment.  Hyphens in the path are normalised to
 *                     dots before comparison so that `*.lock` matches both
 *                     `yarn.lock` and `package-lock.json` (the `-lock` token
 *                     is treated as the `.lock` extension).  The pattern is
 *                     matched as a prefix (the `*` may absorb trailing text
 *                     such as an additional `.json` suffix).
 *   No wildcards   → exact string match on the full path.
 *
 * Pure: no I/O, no process, no imports from other project source files.
 */

export function matchGlob(pattern: string, path: string): boolean {
  const patParts = pattern.split('/');
  const pathParts = path.split('/');
  return matchParts(patParts, 0, pathParts, 0);
}

function matchParts(
  pat: string[],
  pi: number,
  path: string[],
  si: number,
): boolean {
  // Consumed all pattern segments.
  if (pi === pat.length) return si === path.length;

  const seg = pat[pi];

  if (seg === '**') {
    // `**` can consume zero or more path segments.
    for (let skip = 0; skip <= path.length - si; skip++) {
      if (matchParts(pat, pi + 1, path, si + skip)) return true;
    }
    return false;
  }

  // No more path segments to match against.
  if (si === path.length) return false;

  // Match single segment (may contain `*`).
  if (matchSegment(seg, path[si])) {
    return matchParts(pat, pi + 1, path, si + 1);
  }
  return false;
}

function matchSegment(pattern: string, segment: string): boolean {
  if (!pattern.includes('*')) {
    // No wildcard → exact match.
    return pattern === segment;
  }

  // Normalise hyphens in the path segment to dots so that compound names
  // like `package-lock.json` are treated as `package.lock.json` and match
  // the pattern `*.lock` (lock as a dot-delimited token).
  const normSeg = segment.replace(/-/g, '.');

  // Build a regex from the pattern: `*` → `[^/]*`.
  // We use a prefix-match (no trailing `$`) so that a trailing extension
  // such as `.json` in `package.lock.json` is allowed after the match.
  const parts = pattern.split('*').map(escapeRegex);
  const re = new RegExp('^' + parts.join('[^/]*'));
  return re.test(normSeg);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}
