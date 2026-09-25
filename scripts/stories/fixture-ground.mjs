/**
 * fixture-ground.mjs — forge-owned FIXTURE grounds (M7-D, bead `forge-1rk5.1`).
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
 * DETERMINISM is the other half: every provision of the same seed commits to
 * the IDENTICAL sha, because a story's beats may assert against that commit.
 * The sha is a function of exactly three things — the seed's tree as checked
 * out (every path, its bytes and its executable bit), the fixture name in the
 * commit message, and `FIXTURE_COMMIT_ENV` — so two stories that provision
 * the same seed get the same sha, whenever and by whomever it is run. The
 * host's git config that would otherwise take part is overridden on every
 * call (`FIXTURE_GIT_CONFIG`), every call runs without the ambient `GIT_*`
 * environment (`fixtureGitEnv`), and `git init` copies no template.
 */
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { groundManifest } from './ground-hash.mjs';
import { storyFixtureNames, assertSafeStoryId } from './sweep.mjs';

export const FIXTURE_ROOT = 'tests/stories/grounds';

/** A fixture name is a single safe path segment — it is interpolated into a
 *  filesystem path with no separators or traversal possible. */
export const FIXTURE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Frozen so a provision can never drift with who ran it or when. */
export const FIXTURE_COMMIT_ENV = Object.freeze({
  GIT_AUTHOR_NAME: 'forge stories',
  GIT_AUTHOR_EMAIL: 'stories@forge.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'forge stories',
  GIT_COMMITTER_EMAIL: 'stories@forge.invalid',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
});

/**
 * Host git config that would otherwise change the commit, overridden on every
 * provisioning call: blobs are the seed's own bytes (no line-ending
 * conversion); no hook runs at all, so a host-wide `core.hooksPath` or
 * template hook cannot rewrite the message; no signature; no re-encoded
 * message.
 */
const FIXTURE_GIT_CONFIG = Object.freeze([
  '-c', 'core.autocrlf=false',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'commit.gpgsign=false',
  '-c', 'i18n.commitEncoding=UTF-8',
]);

/**
 * The environment for every provisioning git call: the ambient one with
 * every `GIT_*` variable removed, then `FIXTURE_COMMIT_ENV`. An exported
 * `GIT_DIR`, `GIT_WORK_TREE` or `GIT_INDEX_FILE` — a harness launched from a
 * git hook exports them — would otherwise point these calls at another
 * repository, and `GIT_CONFIG_*` would feed them config the `-c` list does
 * not cover. Read at call time, so it is always the current environment.
 */
function fixtureGitEnv() {
  const ambient = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return { ...ambient, ...FIXTURE_COMMIT_ENV };
}

export function fixtureSeedDir(root, fixture) {
  return join(root, FIXTURE_ROOT, fixture, 'seed');
}

/**
 * A fixture ground's OPTIONAL Brain 3 profile source —
 * `tests/stories/grounds/<fixture>/brain/`, a sibling of `seed/`, never
 * inside it. `packages/projects/preflight.ts`'s C4 clause reads
 * `brain/projects/<project>/profile.md` from the FORGE repo, keyed by the
 * project's own DIRECTORY NAME — Brain 3 lives outside `projects/` entirely,
 * so a plain `projects/<project>` seed copy has no way to carry it. Most
 * fixtures declare none; `existsSync` on the result decides whether this
 * ground has one.
 */
export function fixtureBrainSeedDir(root, fixture) {
  return join(root, FIXTURE_ROOT, fixture, 'brain');
}

/** Where a fixture's Brain 3 profile lands once provisioned —
 *  `brain/projects/<project>`, the exact path `packages/projects/preflight.ts`'s
 *  C4 clause reads and `sweep.mjs`'s `productFixturePathsFor` already treats
 *  as this story's own residue (`join(root, 'brain', 'projects', name)` for
 *  every `storyFixtureNames(storyId)`). Provision/teardown share this so
 *  neither can drift from where the sweep expects to find it. */
export function projectBrainDestDir(root, project) {
  return join(root, 'brain', 'projects', project);
}

/** What a non-regular directory entry is, in words for a refusal. */
function entryKind(d) {
  if (d.isSymbolicLink()) return 'a symbolic link';
  if (d.isFIFO()) return 'a FIFO';
  if (d.isSocket()) return 'a socket';
  if (d.isBlockDevice() || d.isCharacterDevice()) return 'a device';
  return 'not a regular file or directory';
}

/**
 * Every file under `dir`, as sorted paths relative to it. THROWS, naming the
 * path, on anything it cannot vouch for — before any write, because
 * `provisionFixtureGround` calls this ahead of `cpSync`:
 *
 *   - a directory it cannot read. `cpSync` walking into a permission-denied
 *     directory does not raise a catchable exception on this Node version;
 *     it aborts the whole process.
 *   - an entry that is neither a regular file nor a directory (a symlink, a
 *     FIFO, a socket, a device). `cpSync` would copy a symlink as a symlink
 *     into a ground the run then treats as a trusted worktree. The walk reads
 *     each entry's own type and never follows one.
 *   - an entry named `.git`, file or directory, at any depth. A seed `.git`
 *     is git state the provisioner would inherit rather than create: a
 *     gitfile's `gitdir:` points `git init`/`add`/`commit` at another
 *     repository, and a `.git/` directory brings its own hooks and config
 *     (`core.fsmonitor` runs on `git add`). A tracked seed cannot hold one,
 *     since git refuses to track a `.git` path, so any that is there was put
 *     there locally.
 */
function listFiles(dir) {
  const files = [];
  const walk = (abs) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch (e) {
      throw new Error(`provisionFixtureGround: could not list ${abs} — ${e?.message ?? e}`);
    }
    for (const d of entries) {
      const path = join(abs, d.name);
      if (d.name === '.git') {
        throw new Error(
          `provisionFixtureGround: seed entry ${path} is a .git ${d.isDirectory() ? 'directory' : 'entry'} — a seed ` +
          'carries no git state of its own (the provisioner creates the repository); refusing before anything is written',
        );
      }
      if (d.isDirectory()) walk(path);
      else if (d.isFile()) files.push(relative(dir, path));
      else {
        throw new Error(
          `provisionFixtureGround: seed entry ${path} is ${entryKind(d)} — a seed holds only regular files and ` +
          'directories; refusing before anything is written',
        );
      }
    }
  };
  walk(dir);
  return files.sort();
}

/** `spawnSync` with an explicit argv, never a shell, and `fixtureGitEnv()` —
 *  named so every call site's failure reads as "what step" rather than a
 *  bare git exit code. */
function runGit(args, what, opts = {}) {
  const res = spawnSync('git', args, { encoding: 'utf8', ...opts, env: fixtureGitEnv() });
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
 * `assertSafeStoryId(storyId)` runs FIRST, unconditionally.
 * `storyFixtureNames` does no validation of the id it is given, so a
 * traversal-shaped `storyId` (`'/../mdtoc'`) paired with a `project` built to
 * match it (`'story-/../mdtoc'`) would pass the membership check while
 * `join(root, 'projects', project)` resolved to `projects/mdtoc` — a REAL
 * ground's own path. This guard has to hold even for a caller that skipped
 * `validateStory`.
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
 * failure once the copy has started removes what it wrote and rethrows the
 * ORIGINAL error. If that removal fails too, both are thrown together as an
 * `AggregateError` whose message leads with the original and names the
 * ground left on disk — a cleanup failure never hides why provisioning failed.
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

  // Brain 3 is OPTIONAL and lives OUTSIDE `projects/` entirely (C4, above the
  // export). Same residue door as `dest`: refused BEFORE any write, because a
  // leftover profile from a prior run would silently make preflight look
  // healthier (or unhealthier) than THIS run's own ground earns.
  const brainSeedDir = fixtureBrainSeedDir(root, fixture);
  const hasBrain = existsSync(brainSeedDir);
  const brainDest = projectBrainDestDir(root, project);
  if (hasBrain && existsSync(brainDest)) {
    throw new Error(
      `provisionFixtureGround: ${brainDest} already exists — refusing to provision the fixture's Brain 3 ` +
      'profile over it',
    );
  }

  const files = listFiles(seedDir);
  // Validated with the SAME walk as the seed (no `.git`, no symlink/FIFO/
  // socket/device) before any write — a brain/ source gets no weaker a check
  // than the seed it sits beside.
  if (hasBrain) listFiles(brainSeedDir);
  try {
    cpSync(seedDir, dest, { recursive: true });
    if (hasBrain) cpSync(brainSeedDir, brainDest, { recursive: true });
    runGit(['-C', dest, ...FIXTURE_GIT_CONFIG, 'init', '-q', '-b', 'main', '--template=', '--object-format=sha1'], 'git init');
    // EXACTLY the seed file list, NUL-separated and literal (no glob, no
    // pathspec magic), fed on stdin — never `add -A`/`.`, which would also add
    // whatever this run's own beats later write into the ground.
    runGit(
      ['-C', dest, '--literal-pathspecs', ...FIXTURE_GIT_CONFIG, 'add', '--pathspec-from-file=-', '--pathspec-file-nul'],
      'git add',
      { input: `${files.join('\0')}\0` },
    );
    runGit(['-C', dest, ...FIXTURE_GIT_CONFIG, 'commit', '-q', '--no-verify', '-m', `fixture: ${fixture}`], 'git commit');
    const commit = runGit(['-C', dest, 'rev-parse', 'HEAD'], 'git rev-parse HEAD').trim();

    const seedDigest = groundManifest(seedDir)?.digest ?? null;
    const destManifest = groundManifest(dest);
    if (seedDigest === null || destManifest === null || destManifest.digest !== seedDigest) {
      throw new Error(
        `provisionFixtureGround: digest mismatch provisioning ${dest} from ${seedDir} — ` +
        `expected ${seedDigest ?? '(unreadable)'}, got ${destManifest?.digest ?? '(unreadable)'}`,
      );
    }
    return Object.freeze({
      dir: dest,
      digest: destManifest.digest,
      commit,
      files: Object.freeze(files),
      brainDir: hasBrain ? brainDest : null,
    });
  } catch (e) {
    // A half-provisioned ground would look like a good pin to whatever runs
    // next, so any failure past this point removes everything it wrote.
    const original = e instanceof Error ? e : new Error(String(e));
    try {
      rmSync(dest, { recursive: true, force: true });
      if (hasBrain) rmSync(brainDest, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [original, cleanupError],
        `${original.message} — and removing the half-provisioned ${dest} failed too, so it is still on disk: ` +
        `${cleanupError?.message ?? cleanupError}`,
      );
    }
    throw original;
  }
}

/** Remove a provisioned fixture ground AND its Brain 3 profile, if either
 *  exists. THROWS on a project outside this story's own namespace, same
 *  guard as provisioning; never throws on the removal itself — the caller is
 *  a run's own teardown, and a teardown that raises would lose the verdict
 *  the run just produced. Brain 3 is removed even when the ground directory
 *  is already gone — an orphaned profile is still this story's own residue
 *  (`sweep.mjs`'s `productFixturePathsFor` already lists it as such). */
export function teardownFixtureGround(root, { storyId, project }) {
  assertOwnNamespace('teardownFixtureGround', storyId, project);
  const dest = join(root, 'projects', project);
  const brainDest = projectBrainDestDir(root, project);
  const destExists = existsSync(dest);
  const brainExists = existsSync(brainDest);
  if (!destExists && !brainExists) return Object.freeze({ removed: false });
  try {
    if (destExists) rmSync(dest, { recursive: true, force: true });
    if (brainExists) rmSync(brainDest, { recursive: true, force: true });
    return Object.freeze({ removed: true });
  } catch (e) {
    return Object.freeze({ removed: false, error: e?.message ?? String(e) });
  }
}

/**
 * Every REAL ground in `root` and in each of `worktrees`: `<tree>/projects/<name>`
 * for every directory entry except a `story-`/`.`-prefixed name (a fixture or
 * a KB scaffold, never a real project). A fixture run's own ground is
 * `story-` namespaced, so it is always left out by that rule.
 *
 * `worktrees` is REQUIRED: a default of none would fence the root alone and
 * say nothing about every sibling it skipped. A tree with no `projects/` at
 * all contributes nothing; any OTHER failure to list one THROWS, naming it —
 * a fence that skipped a tree it could not read would call its grounds
 * unmoved without having looked. A symlinked entry is not a ground:
 * `discoverProjects` (`packages/kernel/project-layout.ts`) lists directories
 * only, so the product never treats one as a project.
 *
 * @param {string} root
 * SCOPE (moved from `run-story.mjs`): a FIXTURE run must never move a REAL
 * ground — every `projects/*` outside the `story-` namespace, in this tree and
 * every sibling worktree. It generalises the sibling-ground fence ("the ground
 * THIS STORY declares") to "every real ground THIS RUN DOES NOT OWN". Only a
 * fixture run pays for it: a real-ground run's own ground is one of these
 * dirs, already covered by its own-ground hashes. The runner passes
 * `siblingDirs`, not `snapshotSiblingWorktrees(...).keys()`, which skips a
 * sibling whose `git status` read fails and would take its grounds out of the
 * fence unnamed; a tree added or removed during the run is named, not judged.
 *
 * @param {{worktrees: string[]}} opts
 * @returns {string[]} sorted absolute directories
 */
export function realGroundDirs(root, { worktrees } = {}) {
  if (!Array.isArray(worktrees)) {
    throw new TypeError(
      'realGroundDirs: `worktrees` is required — every sibling worktree to fence, or [] for none; a default ' +
      'would fence the root alone and say nothing about the trees it skipped',
    );
  }
  const out = [];
  for (const tree of [root, ...worktrees]) {
    const projectsDir = join(tree, 'projects');
    let entries;
    try {
      entries = readdirSync(projectsDir, { withFileTypes: true });
    } catch (e) {
      if (e?.code === 'ENOENT') continue; // this tree has no projects/ dir at all
      throw new Error(
        `realGroundDirs: could not list ${projectsDir} (tree ${tree}) — ${e?.message ?? e}; refusing to fence ` +
        'the real grounds without the ones it cannot see',
      );
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('story-') || entry.name.startsWith('.')) continue;
      out.push(join(projectsDir, entry.name));
    }
  }
  return out.sort();
}

/** Method-C digest of every dir in `dirs`, or `null` where absent or unreadable. */
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

/** The `<tree>` a snapshot key `<tree>/projects/<name>` belongs to. */
const treeOf = (dir) => resolve(dirname(dirname(dir)));

/**
 * The real-ground fence's verdict, as one pure function so the decision that
 * reds a run is testable on its own.
 *
 * A ground is judged only inside a tree BOTH `treeListings` contain. A
 * worktree added or removed while the run was in progress (a lane starting or
 * finishing a work unit) brings or takes its `projects/*` with it; that is
 * not this run moving a ground, so such a tree is named in `treeLines` and
 * never judged. With no listings, every ground is judged.
 *
 * Inside a judged tree, a ground either snapshot LISTED but could not hash
 * (`null`: an unreadable file, output past `groundManifest`'s 64 MiB bound)
 * is `unreadable` — never compared, because `null` against `null` says
 * nothing about its contents. Every other ground that appeared, vanished or
 * changed is `moved`. Either list makes `ok` false.
 *
 * `hashed` counts the dirs `before` produced a digest for; `trees` counts the
 * distinct `<tree>` roots among `before`'s keys.
 *
 * @param {Map<string, string|null>} before
 * @param {Map<string, string|null>} after
 * @param {{before: string[], after: string[]}|null} [treeListings] the trees each snapshot listed
 * @returns {{ok: boolean, moved: string[], unreadable: string[], hashed: number, trees: number, treeLines: string[], summary: string}} frozen
 */
export function realGroundFenceVerdict(before, after, treeListings = null) {
  let persisted = null;
  const treeLines = [];
  if (treeListings !== null) {
    if (!Array.isArray(treeListings?.before) || !Array.isArray(treeListings?.after)) {
      throw new TypeError('realGroundFenceVerdict: treeListings must be { before: string[], after: string[] }');
    }
    const was = new Set(treeListings.before.map((t) => resolve(t)));
    const now = new Set(treeListings.after.map((t) => resolve(t)));
    persisted = new Set([...was].filter((t) => now.has(t)));
    for (const t of [...now].filter((x) => !was.has(x)).sort()) {
      treeLines.push(`real grounds: tree ${t} APPEARED during the run — not this run's ground, not red`);
    }
    for (const t of [...was].filter((x) => !now.has(x)).sort()) {
      treeLines.push(`real grounds: tree ${t} VANISHED during the run — not this run's ground, not red`);
    }
  }
  const judged = (snap) => new Map([...snap].filter(([dir]) => persisted === null || persisted.has(treeOf(dir))));
  const judgedBefore = judged(before);
  const judgedAfter = judged(after);
  const unreadableSet = new Set(
    [...judgedBefore, ...judgedAfter].filter(([, digest]) => digest === null).map(([dir]) => dir),
  );
  const readable = (snap) => new Map([...snap].filter(([dir]) => !unreadableSet.has(dir)));
  const moved = realGroundEscapes(readable(judgedBefore), readable(judgedAfter));
  const unreadable = [...unreadableSet].sort();

  let hashed = 0;
  const trees = new Set();
  for (const [dir, digest] of before) {
    if (digest !== null) hashed += 1;
    trees.add(treeOf(dir));
  }
  return Object.freeze({
    ok: moved.length === 0 && unreadable.length === 0,
    moved: Object.freeze(moved),
    unreadable: Object.freeze(unreadable),
    hashed,
    trees: trees.size,
    treeLines: Object.freeze(treeLines),
    summary:
      `real grounds: ${hashed} hashed in ${trees.size} tree(s), ${moved.length} moved, ${unreadable.length} unreadable`,
  });
}

/**
 * Provision every fixture-ground story in `stories`, IN ORDER, stopping at
 * the first refusal. "A provision that fails writes nothing" is restated at
 * the batch's own level: on a refusal, every ground THIS CALL already
 * provisioned is torn down before the refusal is returned, so it holds for
 * the whole batch, not just the story that failed.
 *
 * A story with no `ground.fixture` is skipped, not provisioned — the caller
 * hands over its full story list rather than pre-filtering.
 *
 * A rollback that could not undo its own write is NAMED, not swallowed:
 * `rollbackFailures` carries `{ project, error }` for every
 * already-provisioned ground the rollback failed to remove (empty on a clean
 * rollback, and always `[]` when nothing refused). A caller that discarded
 * this would leave a ground nothing knows about, printed nowhere.
 *
 * @param {string} root
 * @param {Array<{id: string, ground?: {project?: string, fixture?: string}}>} stories
 * @returns {{provisioned: Array<{storyId: string, project: string, digest: string, commit: string}>, refused: {storyId: string, message: string}|null, rollbackFailures: Array<{project: string, error: string}>}} frozen
 */
export function provisionFixtureGrounds(root, stories) {
  const provisioned = [];
  for (const s of stories) {
    if (typeof s.ground?.fixture !== 'string') continue;
    let r;
    try {
      r = provisionFixtureGround(root, { storyId: s.id, project: s.ground.project, fixture: s.ground.fixture });
    } catch (e) {
      // Undo everything THIS CALL already wrote before reporting the
      // refusal. A `teardownFixtureGround` that returns `{removed: false,
      // error}` or itself throws is named in `rollbackFailures`.
      const rollbackFailures = [];
      for (const p of provisioned) {
        let t;
        try {
          t = teardownFixtureGround(root, { storyId: p.storyId, project: p.project });
        } catch (te) {
          rollbackFailures.push(Object.freeze({ project: p.project, error: te?.message ?? String(te) }));
          continue;
        }
        if (!t.removed && t.error !== undefined) {
          rollbackFailures.push(Object.freeze({ project: p.project, error: t.error }));
        }
      }
      return Object.freeze({
        provisioned: Object.freeze([]),
        refused: Object.freeze({ storyId: s.id, message: e?.message ?? String(e) }),
        rollbackFailures: Object.freeze(rollbackFailures),
      });
    }
    provisioned.push(Object.freeze({ storyId: s.id, project: s.ground.project, digest: r.digest, commit: r.commit }));
  }
  return Object.freeze({ provisioned: Object.freeze(provisioned), refused: null, rollbackFailures: Object.freeze([]) });
}

/**
 * The real-ground fence's console lines, as `{level, line}` (moved out of
 * `run-story.mjs` at its 800-line cap; the verdict itself is
 * `realGroundFenceVerdict`, and the run's red gate stays in the runner). The
 * `summary` line stays in the runner too, printed even at zero (`forge-e8dn`):
 * it is the one line that proves the fence looked at all.
 */
export function describeRealFence(realFence) {
  return [
    ...realFence.treeLines.map((l) => ({ level: 'log', line: `[stories] ${l}` })),
    ...realFence.moved.map((l) => ({ level: 'error', line: `[stories] REAL GROUND MOVED ${l}` })),
    ...realFence.unreadable.map((dir) => ({
      level: 'error',
      line: `[stories] REAL GROUND UNREADABLE ${dir} — method C could not hash it, so nothing proves it unmoved`,
    })),
  ];
}

/**
 * WHEN THE TEARDOWN RUNS (moved from `run-story.mjs`). LAST: the trailing
 * sweep kept the fixture ground (`keepProjects`) so the own-ground drift and
 * the real-ground fence could both read it; nothing after the fence needs
 * `projects/<project>` on disk. And ONLY on an empty trailing census (row 75 ×
 * D1): when `reapCensusAndSweep` refused the sweep because a writer from this
 * run was still alive, the ground stays too — an `rmSync` under a live writer
 * is the race the census closes. The runner's CONTAINMENT FAILURE reds that
 * run, and the next run's leading sweep removes the ground.
 *
 * The fixture-ground teardown's one line. Printed even when there was nothing
 * to remove: a silent no-op reads the same as a teardown nobody wired in.
 */
export function describeFixtureTeardown(teardown, { storyId, project }) {
  if (teardown.removed) return { level: 'log', line: `[stories] fixture ground: torn down projects/${project}` };
  if (teardown.error !== undefined) {
    return {
      level: 'warn',
      line:
        `[stories] fixture ground: could not tear down projects/${project}: ${teardown.error} — ` +
        `the leading sweep of the next run that includes ${storyId} removes it`,
    };
  }
  return { level: 'log', line: `[stories] fixture ground: projects/${project} already absent` };
}
