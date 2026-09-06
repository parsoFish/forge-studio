/**
 * The fence's second dimension — what a run did INSIDE a ground it does not own.
 *
 * Bead `forge-8vfn.6.11.26`, §15.219. `snapshotSiblingWorktrees` (sweep.mjs)
 * lists the immediate CHILDREN of each ignored root, so a whole new ground
 * appearing in a sibling tree is visible. An edit inside a ground that ALREADY
 * EXISTS is not — `ignoredRootEntries`' own comment stated that limit, and S1
 * run 8 priced it on the first funded run after it landed: the run onboarded
 * the MAIN CHECKOUT's `projects/gitweave` (`adebdb6399d7453d` →
 * `7fb19c79739ddd7c`: `.gitignore` +5, `CLAUDE.md` +3, a whole `.forge/`,
 * `roadmap.md`) and the fence said nothing, because `projects/gitweave` was
 * already there. What caught it was the launcher's own before/after hash, run
 * by hand. This module makes that hand check the fence's own.
 *
 * WHY METHOD C AND NOT A HASH OF OUR CHOOSING. The campaign's recorded ground
 * references — `adebdb6399d7453d` (gitweave), `3f4d76708ff073b3` (gitpulse),
 * `2343d907ddb5703f` (betterado) — are all method-C numbers, produced by the
 * launcher's pipeline and quoted in the ledger and in every run's evidence
 * README. A fence that printed a different number for the same tree could not
 * be compared against any of them. So the pipeline is run VERBATIM, and its
 * parity with the launcher is asserted by the test rather than claimed here.
 *
 * The directory travels as `cwd`, never interpolated into the command string:
 * the command is a module constant with no substitution in it at all, so there
 * is no shell-injection surface even though a shell is used.
 *
 * COST, the objection `ignoredRootEntries` raised when it chose depth one:
 * this walks ONE named directory per sibling worktree, twice a run, with
 * `node_modules` and `.git` pruned by the pipeline itself — not a recursive
 * walk of every ground in every tree. The measured gitweave ground is 139
 * files.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Method C, verbatim: the pipeline the launcher runs and the ledger quotes.
 * `sort -z` and the two `-not -path` prunes are part of the definition — change
 * either and every recorded reference number stops meaning anything.
 */
export const METHOD_C_CMD =
  'find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -print0 | sort -z | xargs -0 sha256sum';

/** Bound the read: a ground is a source repo, not a data lake. */
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * One ground's manifest, or `null` when the directory is absent.
 *
 * `null` rather than an empty manifest on purpose: "this tree never had the
 * ground" and "the run emptied it" are different findings, and collapsing them
 * would let the second read as the first.
 *
 * @param {string} dir
 * @returns {{digest: string, files: Map<string,string>}|null}
 */
export function groundManifest(dir) {
  let out;
  try {
    out = execFileSync('sh', ['-c', METHOD_C_CMD], { cwd: dir, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  } catch {
    return null; // absent, unreadable, or not a directory — nothing to compare
  }
  const files = new Map();
  for (const line of out.split('\n')) {
    if (line === '') continue;
    // `sha256sum`'s own format: <64 hex><two spaces><name>. Split at the first
    // two-space run only, so a filename containing spaces survives intact.
    const at = line.indexOf('  ');
    if (at === -1) continue;
    files.set(line.slice(at + 2), line.slice(0, at));
  }
  // `| sha256sum | cut -c1-16` — the digest is over the TEXT STREAM, exactly as
  // the pipeline computes it, so re-deriving it from the parsed map would be a
  // second notion of the same number.
  return { digest: createHash('sha256').update(out).digest('hex').slice(0, 16), files };
}

/**
 * What moved between two manifests, by name. A digest alone tells the operator
 * that something changed in their checkout; it has to tell them WHAT, or the
 * report is one they cannot act on.
 *
 * @param {{files: Map<string,string>}|null} before
 * @param {{files: Map<string,string>}|null} after
 */
export function groundChanges(before, after) {
  const was = before?.files ?? new Map();
  const now = after?.files ?? new Map();
  const added = [...now.keys()].filter((p) => !was.has(p)).sort();
  const removed = [...was.keys()].filter((p) => !now.has(p)).sort();
  const modified = [...now.keys()].filter((p) => was.has(p) && was.get(p) !== now.get(p)).sort();
  return { added, removed, modified };
}

/** Every worktree of this repo EXCEPT the run's own — the same set the path fence judges. */
function siblingDirs(root) {
  let listing = '';
  try {
    listing = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
  } catch {
    return [];
  }
  const out = [];
  for (const line of listing.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const dir = line.slice('worktree '.length).trim();
    if (dir !== '' && dir !== root) out.push(dir);
  }
  return out;
}

/**
 * The ground's manifest in every sibling worktree, before the run.
 *
 * @param {string|null} project the story's ground project name; `null` = no ground to protect
 * @param {{root?: string, dirs?: () => string[]}} [opts] injection seam for the test
 * @returns {Map<string, {digest: string, files: Map<string,string>}|null>}
 */
export function snapshotSiblingGrounds(project, opts = {}) {
  const snap = new Map();
  if (project === null || project === undefined) return snap;
  const dirs = opts.dirs ? opts.dirs() : siblingDirs(opts.root ?? process.cwd());
  for (const dir of dirs) snap.set(dir, groundManifest(join(dir, 'projects', project)));
  return snap;
}

/**
 * Which sibling trees' copy of the ground CHANGED across the run.
 *
 * DELIBERATELY NOT SOFTENED BY RULING 340. Growth anywhere in a sibling tree is
 * attributed by time window, so a concurrent lane's own writes are
 * indistinguishable from this run's and are reported without being fatal. A
 * NAMED ground is different in kind: `projects/<the ground this story
 * provisioned>` in a tree this run does not own is not somewhere another lane
 * is incidentally working — it is the operator's copy of the very repo this run
 * was told to leave alone. A change there is this run's, and it is RED
 * regardless of the beats.
 *
 * @param {string|null} project
 * @param {Map<string, object|null>} baseline from `snapshotSiblingGrounds`
 * @param {{root?: string, dirs?: () => string[]}} [opts]
 * @returns {Array<{root: string, before: string|null, after: string|null, changes: {added: string[], removed: string[], modified: string[]}}>}
 */
export function siblingGroundEscapes(project, baseline, opts = {}) {
  const out = [];
  if (project === null || project === undefined) return out;
  for (const [dir, before] of baseline) {
    const after = groundManifest(join(dir, 'projects', project));
    if ((before?.digest ?? null) === (after?.digest ?? null)) continue;
    out.push({
      root: dir,
      before: before?.digest ?? null,
      after: after?.digest ?? null,
      changes: groundChanges(before, after),
    });
  }
  return out;
}

/** The fence's own words for a changed ground — printed whether or not it is empty (§15.92). */
export function describeGroundEscapes(project, escapes) {
  if (project === null || project === undefined) return ['[stories] ground fence: no ground declared'];
  if (escapes.length === 0) return [`[stories] ground fence: clean — projects/${project} unchanged in every other worktree`];
  const lines = [];
  for (const e of escapes) {
    lines.push(`[stories] GROUND ESCAPE ${e.root}/projects/${project}: ${e.before ?? '(absent)'} -> ${e.after ?? '(absent)'} (method C)`);
    for (const p of e.changes.added) lines.push(`[stories]   added    ${p}`);
    for (const p of e.changes.modified) lines.push(`[stories]   modified ${p}`);
    for (const p of e.changes.removed) lines.push(`[stories]   removed  ${p}`);
  }
  return lines;
}
