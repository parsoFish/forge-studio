/**
 * File ownership + bus-factor module.
 *
 * Derives, for every file in the commit history, which author has the most
 * *surviving* lines (owner) and how many distinct authors have ≥1 surviving
 * line (busFactor). Uses `git blame --porcelain` per file via `execFileSync` —
 * no new runtime deps, same pattern as `src/git.ts`.
 *
 * Public API:
 *   - `FileOwnership`      — immutable result type
 *   - `parseBlameOutput`   — pure parser (testable, no I/O)
 *   - `computeOwnership`   — main entry point
 */

import { execFileSync } from 'node:child_process';
import type { Commit } from './git.ts';

/** Per-file ownership record. Immutable. */
export type FileOwnership = {
  /** Repository-relative file path. */
  readonly file: string;
  /** Author with the most surviving lines in this file. */
  readonly owner: string;
  /** Number of surviving lines owned by `owner`. */
  readonly ownerLines: number;
  /** Count of distinct authors with ≥1 surviving line. */
  readonly busFactor: number;
};

/**
 * Parse a `git blame --porcelain` output string into a map of
 * author → surviving line count.
 *
 * Porcelain format recap:
 *   <40-hex> <orig-line> <final-line> <line-count>   ← hunk header
 *   author <name>                                     ← always follows header
 *   …other key-value lines…
 *   \t<source line>                                   ← actual code line
 *
 * We accumulate `line-count` per author.  When a hunk is for a commit that
 * has already appeared (porcelain re-uses the short header), git omits the
 * `author` line — in that case we reuse the last-seen author for that hash.
 *
 * Pure function — no I/O. Exported for unit testing.
 */
export function parseBlameOutput(raw: string): Map<string, number> {
  const authorByHash = new Map<string, string>();
  const linesByAuthor = new Map<string, number>();

  const lines = raw.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Hunk header: 40-hex SP orig-line SP final-line SP line-count
    const hunkMatch = line.match(/^([0-9a-f]{40}) \d+ \d+ (\d+)$/);
    if (hunkMatch) {
      const hash = hunkMatch[1];
      const count = parseInt(hunkMatch[2], 10);
      i++;

      // Scan following key-value lines until we hit the code line (starts with \t)
      let author: string | undefined = authorByHash.get(hash);

      while (i < lines.length && !lines[i].startsWith('\t')) {
        const kv = lines[i];
        if (kv.startsWith('author ')) {
          author = kv.slice('author '.length).trim();
          authorByHash.set(hash, author);
        }
        i++;
      }

      // Skip the code line itself
      if (i < lines.length && lines[i].startsWith('\t')) {
        i++;
      }

      if (author !== undefined && author !== 'Not Committed Yet') {
        linesByAuthor.set(author, (linesByAuthor.get(author) ?? 0) + count);
      }
    } else {
      i++;
    }
  }

  return linesByAuthor;
}

/**
 * Compute file ownership for every distinct file referenced in `commits`.
 *
 * Calls `git blame --porcelain <file>` for each file under `repoPath`. Files
 * where blame fails (deleted, binary, outside work tree) are omitted silently.
 *
 * Result is sorted: **descending busFactor**, ties broken by **file path
 * ascending**.
 */
export function computeOwnership(
  commits: readonly Commit[],
  repoPath: string,
): FileOwnership[] {
  if (commits.length === 0) return [];

  // Collect distinct file paths across all commits.
  const files = new Set<string>();
  for (const commit of commits) {
    for (const f of commit.files) {
      files.add(f.path);
    }
  }

  const results: FileOwnership[] = [];

  for (const file of files) {
    let raw: string;
    try {
      raw = execFileSync('git', ['-C', repoPath, 'blame', '--porcelain', file], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      // File deleted, binary, or otherwise unblame-able — omit gracefully.
      continue;
    }

    const linesByAuthor = parseBlameOutput(raw);
    if (linesByAuthor.size === 0) continue;

    // Find the owner (author with the most surviving lines).
    let owner = '';
    let ownerLines = -1;
    for (const [author, count] of linesByAuthor) {
      if (count > ownerLines) {
        ownerLines = count;
        owner = author;
      }
    }

    const busFactor = linesByAuthor.size;
    results.push({ file, owner, ownerLines, busFactor });
  }

  // Sort: descending busFactor, then ascending file path.
  results.sort((a, b) => {
    if (b.busFactor !== a.busFactor) return b.busFactor - a.busFactor;
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });

  return results;
}
