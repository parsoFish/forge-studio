/**
 * Git repository reader.
 *
 * Shells out to `git log` (via `execFileSync` — no shell, args are passed as an
 * array so there is no injection surface) and parses the `--numstat` output into
 * immutable `Commit` records. Validates that the path is actually a git repo
 * before reading and fails fast with a clear Error if not. No mutation of inputs.
 */

import { execFileSync } from 'node:child_process';

/** Per-file numstat entry within a commit. Immutable. */
export type CommitFile = {
  /** File path (renamed files use the new path, braces stripped). */
  readonly path: string;
  /** Inserted lines for this file (binary `-` counts as 0). */
  readonly insertions: number;
  /** Deleted lines for this file (binary `-` counts as 0). */
  readonly deletions: number;
};

/** One parsed commit. Immutable. */
export type Commit = {
  /** Full commit SHA. */
  readonly hash: string;
  /** Commit author name (`%an`). */
  readonly author: string;
  /** Author date in `YYYY-MM-DD` form (`%ad` with `--date=short`). */
  readonly date: string;
  /** Number of parent commits (0 for initial commit, 1 for regular, ≥2 for merge). */
  readonly parentCount: number;
  /** Author email address (`%ae`). */
  readonly authorEmail: string;
  /** Number of files changed in the commit. */
  readonly filesChanged: number;
  /** Total inserted lines across the commit (binary `-` counts as 0). */
  readonly insertions: number;
  /** Total deleted lines across the commit (binary `-` counts as 0). */
  readonly deletions: number;
  /** Per-file numstat breakdown for this commit. */
  readonly files: readonly CommitFile[];
};

// `git log` format: <hash>\t<author>\t<date>\t<parents>\t<email>, then numstat lines per file.
// %x09 is a literal tab — used as the field separator inside the header line.
// %P is the space-separated list of parent SHAs (empty for the initial commit).
// %ae is the author email address.
const LOG_FORMAT = '%H%x09%an%x09%ad%x09%P%x09%ae';
export const LOG_ARGS = ['log', '--numstat', '--date=short', `--format=${LOG_FORMAT}`];

/**
 * Run `git` with the given args inside `repoPath`. Returns stdout as a string.
 * Throws a clear Error if git is missing or exits non-zero.
 */
function runGit(repoPath: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`gitpulse: git ${args[0]} failed in "${repoPath}": ${message}`);
  }
}

/**
 * Assert that `repoPath` is inside a git work tree. Throws a clear Error if not,
 * rather than letting a downstream `git log` produce a confusing failure.
 */
export function assertGitRepo(repoPath: string): void {
  if (typeof repoPath !== 'string' || repoPath.length === 0) {
    throw new TypeError('gitpulse: repoPath must be a non-empty string');
  }
  let inside: string;
  try {
    inside = execFileSync('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(`gitpulse: "${repoPath}" is not a git repository`);
  }
  if (inside !== 'true') {
    throw new Error(`gitpulse: "${repoPath}" is not inside a git work tree`);
  }
}

/**
 * Parse one `--numstat` count field. The numstat columns are decimal counts,
 * except binary files which git marks with `-` — those count as 0.
 */
function parseCount(field: string): number {
  if (field === '-') return 0;
  const n = Number(field);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * Normalise a numstat file path, handling git rename syntax like
 * `src/{old.ts => new.ts}` or `{src/old.ts => src/new.ts}`.
 * Returns the new path with braces stripped.
 */
function normaliseFilePath(raw: string): string {
  // Rename syntax: `prefix{old_suffix => new_suffix}rest`
  // Find the innermost `{... => ...}` block.
  const braceOpen = raw.indexOf('{');
  const braceClose = raw.lastIndexOf('}');
  if (braceOpen !== -1 && braceClose !== -1 && braceOpen < braceClose) {
    const inner = raw.slice(braceOpen + 1, braceClose);
    const arrowIdx = inner.indexOf(' => ');
    if (arrowIdx !== -1) {
      const newSuffix = inner.slice(arrowIdx + 4);
      const prefix = raw.slice(0, braceOpen);
      const suffix = raw.slice(braceClose + 1);
      return prefix + newSuffix + suffix;
    }
  }
  return raw;
}

/**
 * Parse the raw `git log --numstat` output into immutable Commit records.
 * Exported (separately from the I/O) so the parser can be unit-tested without
 * spawning git.
 */
export function parseLog(raw: string): Commit[] {
  const commits: Commit[] = [];
  let current: {
    hash: string;
    author: string;
    date: string;
    parentCount: number;
    authorEmail: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
    files: CommitFile[];
  } | null = null;

  const flush = (): void => {
    if (current !== null) {
      commits.push({ ...current, files: [...current.files] });
      current = null;
    }
  };

  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;

    // A header line carries four tabs (hash, author, date, parents, email). A numstat line is
    // `<added>\t<deleted>\t<path>` where added/deleted are digits or `-`.
    const parts = line.split('\t');
    const looksLikeHeader = parts.length === 5 && /^[0-9a-f]{7,40}$/i.test(parts[0]);

    if (looksLikeHeader) {
      flush();
      // Parse parentCount from the %P field (space-separated SHAs; empty for initial commit).
      const parentCount = parts[3].trim().length === 0
        ? 0
        : parts[3].trim().split(' ').filter((s) => s.length > 0).length;
      current = {
        hash: parts[0],
        author: parts[1],
        date: parts[2],
        parentCount,
        authorEmail: parts[4].trim(),
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        files: [],
      };
      continue;
    }

    // Numstat line for the current commit.
    if (current !== null && parts.length >= 3) {
      const ins = parseCount(parts[0]);
      const del = parseCount(parts[1]);
      const filePath = normaliseFilePath(parts[2]);
      current.files.push({ path: filePath, insertions: ins, deletions: del });
      current = {
        ...current,
        filesChanged: current.filesChanged + 1,
        insertions: current.insertions + ins,
        deletions: current.deletions + del,
      };
    }
  }
  flush();

  return commits;
}

/**
 * Read every (non-merge) commit from the git repo at `repoPath` into immutable
 * Commit records. Validates the path is a git repo first.
 */
export function readCommits(repoPath: string): Commit[] {
  assertGitRepo(repoPath);
  const raw = runGit(repoPath, LOG_ARGS);
  return parseLog(raw);
}

/**
 * Validate that `ref` resolves to a known git object in `repoPath`.
 * Returns the resolved SHA string on success.
 * Throws an Error with message `gitpulse: unknown ref '<ref>'` on failure.
 */
export function validateRef(repoPath: string, ref: string): string {
  try {
    const sha = execFileSync('git', ['-C', repoPath, 'rev-parse', '--verify', ref], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return sha;
  } catch {
    throw new Error(`gitpulse: unknown ref '${ref}'`);
  }
}

/**
 * Read (non-merge) commits from the git repo at `repoPath` bounded at `ref`.
 * Returns commits that are ancestors of HEAD up to (but not including) `ref`.
 * Validates the path is a git repo first.
 */
export function readCommitsAtRef(repoPath: string, ref: string): Commit[] {
  assertGitRepo(repoPath);
  // Use `git log <ref>` to get all commits reachable from ref (the base snapshot).
  const refArgs = [...LOG_ARGS, ref];
  const raw = runGit(repoPath, refArgs);
  return parseLog(raw);
}

// ---------------------------------------------------------------------------
// Tag reading
// ---------------------------------------------------------------------------

/** One git tag entry. Immutable. */
export type TagEntry = {
  /** Tag name, e.g. "v0.3". */
  readonly name: string;
  /** Date in YYYY-MM-DD form. Annotated tags use tagger date; lightweight tags use commit date. */
  readonly date: string;
  /** The commit SHA the tag points to (dereferenced for annotated tags). */
  readonly sha: string;
};

// Tab-separated format columns:
//   %(refname:short) \t %(creatordate:short) \t %(*objectname) \t %(objectname)
// For annotated tags: *objectname is the dereferenced commit SHA.
// For lightweight tags: *objectname is empty; objectname is the commit SHA.
const TAG_FORMAT = '%(refname:short)\t%(creatordate:short)\t%(*objectname)\t%(objectname)';
const TAG_ARGS = ['tag', '-l', '--sort=-creatordate', `--format=${TAG_FORMAT}`];

/**
 * Parse raw `git tag -l --format=...` output into TagEntry records.
 * Exported for unit testing without spawning git.
 */
export function parseTagsOutput(raw: string): TagEntry[] {
  const tags: TagEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 4) continue;
    const name = parts[0];
    const date = parts[1];
    // For annotated tags, *objectname (parts[2]) holds the commit SHA.
    // For lightweight tags, *objectname is empty; use objectname (parts[3]).
    const derefSha = parts[2].trim();
    const objectSha = parts[3].trim();
    const sha = derefSha !== '' ? derefSha : objectSha;
    if (!name || !date || !sha) continue;
    tags.push({ name, date, sha });
  }
  return tags;
}

/**
 * Read all tags from the git repo at `repoPath`, sorted newest-first.
 * Returns an empty array if there are no tags. Validates the path is a git repo first.
 */
export function readTags(repoPath: string): TagEntry[] {
  assertGitRepo(repoPath);
  const raw = runGit(repoPath, TAG_ARGS);
  return parseTagsOutput(raw);
}

/**
 * Resolve a tag name to the underlying commit SHA in `repoPath`.
 *
 * Uses `git rev-parse --verify <tag>^{commit}` which dereferences both
 * annotated tags (tag-object SHA → commit SHA) and lightweight tags
 * (tag SHA = commit SHA) uniformly.
 *
 * On failure (tag does not exist), throws a structured Error with:
 *   - `code: 2` property
 *   - The verbatim unknown tag name in the message
 *   - A sorted (newest-first) list of all known tags appended to the message
 *
 * Signature mirrors `validateRef` but is tag-specific and carries richer
 * error context.
 */
export function resolveTagToSha(repoPath: string, tag: string): string {
  try {
    const sha = execFileSync(
      'git',
      ['-C', repoPath, 'rev-parse', '--verify', `${tag}^{commit}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return sha;
  } catch {
    // Collect known tags for a helpful error message.
    let knownTags: TagEntry[] = [];
    try {
      knownTags = readTags(repoPath);
    } catch {
      // If listing tags fails (e.g. not a repo), we'll still throw a clear error.
    }
    const tagList = knownTags.map((t) => t.name).join(', ');
    const err = new Error(
      `gitpulse: unknown tag '${tag}'; known tags: ${tagList || '(none)'}`,
    ) as Error & { code: number; unknownTag: string; knownTags: string[] };
    (err as unknown as Record<string, unknown>).code = 2;
    (err as unknown as Record<string, unknown>).unknownTag = tag;
    (err as unknown as Record<string, unknown>).knownTags = knownTags.map((t) => t.name);
    throw err;
  }
}

/**
 * Read commits reachable from `currSha` but not from `prevSha` in the repo at
 * `repoPath` (i.e. `git log prevSha..currSha --numstat`). Optionally excludes
 * commits whose changed files all match an `excludePaths` prefix.
 *
 * A commit is kept if it has at least one changed file that does NOT start with
 * any of the `excludePaths` prefixes. Commits with no files (e.g. empty commits)
 * are always kept.
 */
export function readCommitsBetweenTags(
  repoPath: string,
  prevSha: string,
  currSha: string,
  excludePaths?: readonly string[],
): Commit[] {
  assertGitRepo(repoPath);
  const rangeArgs = [...LOG_ARGS, `${prevSha}..${currSha}`];
  const raw = runGit(repoPath, rangeArgs);
  const commits = parseLog(raw);

  if (!excludePaths || excludePaths.length === 0) return commits;

  return commits.filter((commit) => {
    // A commit with no file records is kept (e.g. empty merge-base boundary).
    if (commit.files.length === 0) return true;
    // Keep if at least one file is NOT under any excluded prefix.
    return commit.files.some(
      (f) => !excludePaths.some((prefix) => f.path === prefix || f.path.startsWith(prefix + '/')),
    );
  });
}
