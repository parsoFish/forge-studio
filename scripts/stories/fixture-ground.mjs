/**
 * fixture-ground.mjs — forge-owned FIXTURE grounds (M7-D, D1).
 *
 * A REAL ground under `projects/` is a moving target: the launcher pins a
 * method-C hash and refuses a run whose ground has drifted, so a story that
 * needs to drive real git operations against a from-scratch history either
 * mutates a real project (trusted to put it back) or goes unwritten. A
 * FIXTURE ground is forge's own: provisioned fresh from a tracked seed under
 * `tests/stories/grounds/<name>/seed/` before the run and torn down after, so
 * nothing of it survives between runs to drift.
 *
 * TWO SAFETY PROPERTIES carry all the weight, and both are namespace guards
 * rather than behavioural ones:
 *
 *   - `project` must be in `storyFixtureNames(storyId)` — the same reserved
 *     `story-<id>` prefix the residue sweep already trusts. A provisioner
 *     that could target `projects/gitpulse` would DELETE a real ground on its
 *     way to writing the seed into it.
 *   - a provision that fails writes NOTHING. A half-provisioned ground would
 *     look like a good pin to whatever runs next.
 *
 * DETERMINISM is the other half: two provisions of the same seed commit to
 * the IDENTICAL sha, because a story's beats may assert against that commit.
 * `FIXTURE_COMMIT_ENV` freezes author/committer identity and timestamp so the
 * commit is a pure function of the seed's tree, never of when or by whom it
 * was made.
 */
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { groundManifest } from './ground-hash.mjs';
import { storyFixtureNames, assertSafeStoryId } from './sweep.mjs';

export const FIXTURE_ROOT = 'tests/stories/grounds';

/** A fixture name is a single safe path segment — it is interpolated into a
 *  filesystem path with no separators or traversal possible. */
export const FIXTURE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Frozen so a provision can never drift with who ran it or when — the sha
 *  this produces is a pure function of the seed's tree and this object. */
export const FIXTURE_COMMIT_ENV = Object.freeze({
  GIT_AUTHOR_NAME: 'forge stories',
  GIT_AUTHOR_EMAIL: 'stories@forge.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'forge stories',
  GIT_COMMITTER_EMAIL: 'stories@forge.invalid',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
});

export function fixtureSeedDir(root, fixture) {
  return join(root, FIXTURE_ROOT, fixture, 'seed');
}

/**
 * Every file under `dir`, as sorted paths relative to it.
 *
 * D1 review, M5 — THROWS, naming the unreadable path, rather than swallowing.
 * `readdirSync(dir, { recursive: true })` fails the WHOLE walk the moment it
 * meets one unreadable subdirectory, not just that subtree, and a caller that
 * swallowed the failure would go on to `cpSync` the (unfiltered) seed anyway.
 * Measured on this host: `cpSync` walking into that same permission-denied
 * directory does not raise a catchable JS exception at all — it aborts the
 * whole process. So this has to throw BEFORE `cpSync` ever runs, and it is
 * called outside `provisionFixtureGround`'s try block for exactly that reason
 * — nothing has been written yet when it does, so there is nothing to clean
 * up. `d.parentPath` is used unconditionally: Node 22 always sets it, and a
 * `?? d.path` fallback is a backwards-compat path this codebase's own rule
 * against fallbacks does not allow.
 */
function listFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch (e) {
    throw new Error(`provisionFixtureGround: could not list ${dir} — ${e?.message ?? e}`);
  }
  return entries
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)))
    .sort();
}

/** `spawnSync` with an explicit argv, never a shell — named so every call
 *  site's failure reads as "what step" rather than a bare git exit code. */
function runGit(args, what, opts = {}) {
  const res = spawnSync('git', args, { encoding: 'utf8', ...opts });
  if (res.error !== undefined) {
    throw new Error(`provisionFixtureGround: ${what} could not run — ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(
      `provisionFixtureGround: ${what} exited ${res.status}` +
      (res.stderr ? ` — ${String(res.stderr).trim()}` : ''),
    );
  }
  return res.stdout;
}

/**
 * Refuse a project outside this story's own reserved namespace — the same
 * guard the residue sweep already trusts. Shared by provision and teardown
 * so neither can ever be pointed at a real ground.
 *
 * D1 review, I1 — `assertSafeStoryId(storyId)` FIRST, unconditionally.
 * `storyFixtureNames` does no validation of the id it is given, so a
 * traversal-shaped `storyId` (`'/../mdtoc'`) paired with a `project` built to
 * match it (`'story-/../mdtoc'`) passed the membership check while
 * `join(root, 'projects', project)` resolved to `projects/mdtoc` — a REAL
 * ground's own path. Every caller today passes an id `validateStory` already
 * constrained, which is why this was latent rather than live; the module's
 * own header calls this guard the thing that "carries all the weight", so it
 * has to hold even for a caller that skipped that upstream check.
 */
function assertOwnNamespace(fn, storyId, project) {
  assertSafeStoryId(storyId);
  const names = storyFixtureNames(storyId);
  if (!names.includes(project)) {
    throw new Error(
      `${fn}: project ${JSON.stringify(project)} is not in ${storyId}'s own fixture namespace ` +
      `(${names.join(', ')}) — refusing, because a fixture call that could reach a real project ` +
      'would delete or provision over the very ground it exists to leave alone.',
    );
  }
}

/**
 * Provision `projects/<project>` from `tests/stories/grounds/<fixture>/seed/`.
 * Refuses (writing nothing) before any write for every shape violation; a
 * failure once the copy has started removes what it wrote and rethrows.
 *
 * @returns {{dir: string, digest: string, commit: string, files: string[]}} frozen
 */
export function provisionFixtureGround(root, { storyId, project, fixture }) {
  if (typeof fixture !== 'string' || !FIXTURE_NAME.test(fixture)) {
    throw new Error(
      `provisionFixtureGround: fixture ${JSON.stringify(fixture)} is not a safe fixture name ` +
      `(expected ${FIXTURE_NAME})`,
    );
  }
  assertOwnNamespace('provisionFixtureGround', storyId, project);

  const seedDir = fixtureSeedDir(root, fixture);
  if (!existsSync(seedDir)) {
    throw new Error(`provisionFixtureGround: seed dir ${seedDir} does not exist`);
  }
  const provenance = join(root, FIXTURE_ROOT, fixture, 'PROVENANCE.md');
  if (!existsSync(provenance)) {
    throw new Error(
      `provisionFixtureGround: ${provenance} (PROVENANCE.md) is missing — every fixture records its ` +
      'source, deviations and the stories it serves beside its seed; refusing to provision from one that does not.',
    );
  }
  const dest = join(root, 'projects', project);
  if (existsSync(dest)) {
    throw new Error(`provisionFixtureGround: ${dest} already exists — refusing to provision over it`);
  }

  const files = listFiles(seedDir);
  try {
    cpSync(seedDir, dest, { recursive: true });
    runGit(['-C', dest, 'init', '-q', '-b', 'main'], 'git init');
    // EXACTLY the seed file list, fed on stdin — never `add -A`/`.`, which
    // would also add whatever this run's own beats later write into the
    // ground before anyone asks it to.
    runGit(['-C', dest, 'add', '--pathspec-from-file=-'], 'git add', { input: `${files.join('\n')}\n` });
    runGit(
      ['-C', dest, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', `fixture: ${fixture} (seed of ${storyId})`],
      'git commit',
      { env: { ...process.env, ...FIXTURE_COMMIT_ENV } },
    );
    const commit = runGit(['-C', dest, 'rev-parse', 'HEAD'], 'git rev-parse HEAD').trim();

    const seedDigest = groundManifest(seedDir)?.digest ?? null;
    const destManifest = groundManifest(dest);
    if (seedDigest === null || destManifest === null || destManifest.digest !== seedDigest) {
      throw new Error(
        `provisionFixtureGround: digest mismatch provisioning ${dest} from ${seedDir} — ` +
        `expected ${seedDigest ?? '(unreadable)'}, got ${destManifest?.digest ?? '(unreadable)'}`,
      );
    }
    return Object.freeze({ dir: dest, digest: destManifest.digest, commit, files: Object.freeze(files) });
  } catch (e) {
    // A half-provisioned ground would look like a good pin to whatever runs
    // next, so any failure past this point removes everything it wrote.
    rmSync(dest, { recursive: true, force: true });
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Remove a provisioned fixture ground. THROWS on a project outside this
 *  story's own namespace, same guard as provisioning; never throws on the
 *  removal itself — the caller is a run's own teardown, and a teardown that
 *  raises would lose the verdict the run just produced. */
export function teardownFixtureGround(root, { storyId, project }) {
  assertOwnNamespace('teardownFixtureGround', storyId, project);
  const dest = join(root, 'projects', project);
  if (!existsSync(dest)) return Object.freeze({ removed: false });
  try {
    rmSync(dest, { recursive: true, force: true });
    return Object.freeze({ removed: true });
  } catch (e) {
    return Object.freeze({ removed: false, error: e?.message ?? String(e) });
  }
}

/**
 * Every REAL ground this run does not own: `<tree>/projects/<name>` for each
 * tree in `[root, ...worktrees]`, excluding a `story-`/`.`-prefixed name (a
 * fixture or a KB scaffold, never a real project) and, in `root` only, the
 * project this run's own ground IS.
 *
 * @returns {string[]} sorted absolute directories
 */
export function realGroundDirs(root, { ownProject = null, worktrees = [] } = {}) {
  const out = [];
  for (const tree of [root, ...worktrees]) {
    const projectsDir = join(tree, 'projects');
    let entries;
    try {
      entries = readdirSync(projectsDir, { withFileTypes: true });
    } catch {
      continue; // no projects/ dir in this tree — nothing to see
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('story-') || entry.name.startsWith('.')) continue;
      if (tree === root && entry.name === ownProject) continue;
      out.push(join(projectsDir, entry.name));
    }
  }
  return out.sort();
}

/** Method-C digest of every dir in `dirs`, or `null` where absent. */
export function snapshotRealGrounds(dirs) {
  const snap = new Map();
  for (const dir of dirs) snap.set(dir, groundManifest(dir)?.digest ?? null);
  return snap;
}

/** One human line per dir whose digest moved between two snapshots — modified,
 *  appeared or vanished. `[]` when every ground compares equal. */
export function realGroundEscapes(before, after) {
  const dirs = new Set([...before.keys(), ...after.keys()]);
  const lines = [];
  for (const dir of [...dirs].sort()) {
    const b = before.get(dir) ?? null;
    const a = after.get(dir) ?? null;
    if (b === a) continue;
    if (b === null) lines.push(`APPEARED ${dir}: (absent) -> ${a}`);
    else if (a === null) lines.push(`VANISHED ${dir}: ${b} -> (absent)`);
    else lines.push(`MODIFIED ${dir}: ${b} -> ${a}`);
  }
  return lines;
}

/**
 * The real-ground fence as a PURE, tested verdict — D1 review, I3.
 *
 * The D1 fence was hand-rolled inline in `run-story.mjs`: `realGroundMoved`
 * computed from `realGroundEscapes`, an unconditional summary line, and a
 * `.length > 0` check reaching `return 1`. Deleting any one of those three
 * kept every pinned test green, because nothing exercised the REQUIREMENT —
 * only the two primitives it was built from. This is the seam a test can
 * hold: one function, one frozen record, one door.
 *
 * `hashed` counts only dirs `before` produced a digest FOR — a dir
 * `groundManifest` could not read (an unreadable file, or output past its 64
 * MiB bound) returns `null` and was never actually hashed, whatever a count
 * of listed dirs would have claimed (the sibling of review finding M2).
 * `trees` counts DISTINCT `<tree>` roots among the keys, not the number of
 * dirs — a key is always `<tree>/projects/<name>`, so the tree is its
 * grandparent.
 *
 * @param {Map<string, string|null>} before
 * @param {Map<string, string|null>} after
 * @returns {{ok: boolean, moved: string[], hashed: number, trees: number, summary: string}} frozen
 */
export function realGroundFenceVerdict(before, after) {
  const moved = realGroundEscapes(before, after);
  let hashed = 0;
  const trees = new Set();
  for (const [dir, digest] of before) {
    if (digest !== null) hashed += 1;
    trees.add(dirname(dirname(dir))); // `<tree>/projects/<name>` -> `<tree>`
  }
  return Object.freeze({
    ok: moved.length === 0,
    moved,
    hashed,
    trees: trees.size,
    summary: `real grounds: ${hashed} hashed in ${trees.size} tree(s), ${moved.length} moved`,
  });
}

/**
 * Provision every fixture-ground story in `stories`, IN ORDER, stopping at
 * the first refusal — D1 review, M1. "A provision that fails writes nothing"
 * held for one story and not for a batch: `run.mjs`'s original loop kept
 * provisioning after a refusal, and nothing tore down what an earlier story
 * in the same call had already written. This restates that promise at the
 * batch's own level: on a refusal, every ground THIS CALL already
 * provisioned is torn down before the refusal is returned, so "writes
 * nothing" is true of the whole batch, not just the story that failed.
 *
 * A story with no `ground.fixture` is skipped, not provisioned — the caller
 * hands over its full story list rather than pre-filtering.
 *
 * @param {string} root
 * @param {Array<{id: string, ground?: {project?: string, fixture?: string}}>} stories
 * @returns {{provisioned: Array<{storyId: string, project: string, digest: string, commit: string}>, refused: {storyId: string, message: string}|null}} frozen
 */
export function provisionFixtureGrounds(root, stories) {
  const provisioned = [];
  for (const s of stories) {
    if (typeof s.ground?.fixture !== 'string') continue;
    let r;
    try {
      r = provisionFixtureGround(root, { storyId: s.id, project: s.ground.project, fixture: s.ground.fixture });
    } catch (e) {
      // Undo everything THIS CALL already wrote before reporting the refusal.
      // Each id here was already validated by a provision that just
      // succeeded, so a rollback failure is not expected — best-effort
      // regardless, because losing the refusal that caused it would be worse
      // than a ground left behind for the next leading sweep to remove.
      for (const p of provisioned) {
        try {
          teardownFixtureGround(root, { storyId: p.storyId, project: p.project });
        } catch {
          /* see above — the refusal below is the fact that must survive */
        }
      }
      return Object.freeze({
        provisioned: Object.freeze([]),
        refused: Object.freeze({ storyId: s.id, message: e?.message ?? String(e) }),
      });
    }
    provisioned.push(Object.freeze({ storyId: s.id, project: s.ground.project, digest: r.digest, commit: r.commit }));
  }
  return Object.freeze({ provisioned: Object.freeze(provisioned), refused: null });
}
