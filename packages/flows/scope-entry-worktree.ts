/**
 * forge-mfv5.1.52: each `files_in_scope` entry submitted at the Kickoff gate or
 * in a typed send-back is judged against the worktree, so a scope that can never
 * meet the required-paths gate is refused at the door. A file → exact; a
 * directory → only with its trailing `/`; an absent file → Kickoff: listed under
 * `creates`; send-back (no creates field): its parent directory exists (T1
 * rulings 2026-10-17 — I3b's round-3 send-back named test files its fix then
 * created). Probes go through the kernel path guard: nothing outside is stat'd.
 */
import { guardedFile } from '@forge/kernel';
import { scopeEntryErrors } from '@forge/contracts';

/** Which door submitted the scope: the Kickoff form carries `creates`, a typed send-back does not. */
export type ScopeDoor = { door: 'kickoff'; creates: readonly string[] } | { door: 'send-back' };

export function scopeEntryWorktreeErrors(worktreeRoot: string, entries: readonly string[], opts: ScopeDoor): string[] {
  return entries.flatMap((entry) => {
    if (scopeEntryErrors('files_in_scope', [entry]).length > 0) return [];
    const why = entryFault(worktreeRoot, entry, opts);
    return why === null ? [] : [`files_in_scope entry ${JSON.stringify(entry)} refused: ${why}`];
  });
}

function entryFault(root: string, entry: string, opts: ScopeDoor): string | null {
  const bare = entry.replace(/\/+$/, '');
  const segs = bare.split('/').filter((s) => s !== '' && s !== '.');
  if (segs.length === 0) return 'names the worktree root — name a directory inside it as "d/"';
  // The gate compares entries to `git diff --name-only` paths as strings: `./x` or `a//b` never match.
  const normal = `${segs.join('/')}${entry.endsWith('/') ? '/' : ''}`;
  if (normal !== entry) return `is not a normalised path — did you mean "${normal}"?`;
  if (entry.includes('*')) return 'is a wildcard — name a directory as "d/" or each file';
  const isDir = guardedFile(root, segs, 'readdir') !== null;
  const exists = isDir || guardedFile(root, segs, 'read') !== null;
  if (entry.endsWith('/')) {
    if (isDir) return null;
    if (exists) return `is a file, not a directory — did you mean "${bare}"?`;
  } else {
    if (isDir) return `is a directory — did you mean "${bare}/"?`;
    if (exists) return null;
    if (opts.door === 'kickoff' ? opts.creates.includes(entry) : isDirOrRoot(root, segs.slice(0, -1))) return null;
  }
  const near = deepestExistingDir(root, segs);
  const dirHint = near === null ? 'name an existing directory with a trailing slash' : `name its existing directory as "${near}"`;
  if (entry.endsWith('/')) return `not in the worktree — ${dirHint}`;
  return opts.door === 'kickoff'
    ? `not in the worktree — list a file this work item creates under creates too, or ${dirHint}`
    : `not in the worktree and neither is its directory — ${dirHint}`;
}

/** Kickoff `creates` (read by the gate before `files_in_scope`): normalised file paths, never a directory. */
export function createsEntryWorktreeErrors(worktreeRoot: string, entries: readonly string[]): string[] {
  return entries.flatMap((entry) => {
    if (scopeEntryErrors('creates', [entry]).length > 0) return [];
    const segs = entry.split('/').filter((s) => s !== '' && s !== '.');
    const why = segs.length === 0 || entry.endsWith('/') || guardedFile(worktreeRoot, segs, 'readdir') !== null
      ? 'is a directory — creates names the files the work item writes'
      : segs.join('/') !== entry ? `is not a normalised path — did you mean "${segs.join('/')}"?`
        : entry.includes('*') ? 'is a wildcard — creates names each file' : null;
    return why === null ? [] : [`creates entry ${JSON.stringify(entry)} refused: ${why}`];
  });
}

const isDirOrRoot = (root: string, segs: readonly string[]): boolean =>
  segs.length === 0 || guardedFile(root, segs, 'readdir') !== null;

/** The deepest existing proper ancestor directory of `segs`, as `a/b/`; null when none below the root exists. */
function deepestExistingDir(root: string, segs: readonly string[]): string | null {
  for (let n = segs.length - 1; n > 0; n--) {
    const parent = segs.slice(0, n);
    if (guardedFile(root, parent, 'readdir') !== null) return `${parent.join('/')}/`;
  }
  return null;
}
