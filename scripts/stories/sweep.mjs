/**
 * sweep.mjs — the crash-safe sweep, ported from `scripts/lib/journey-residue.mjs`.
 *
 * WHY IT IS STRUCTURAL, not a cleanup step someone must remember. The runner
 * installs no signal handlers; Node terminates on SIGINT/SIGTERM without
 * running a pending `finally`, and SIGKILL cannot be handled at all. So every
 * kind of kill — an operator Ctrl-C included — skips end-of-run teardown.
 * A sweep at the START of every run is crash-safe against all of them by
 * construction: it does not depend on the previous process having survived.
 *
 * Measured 2026-08-24 on the old harness: a run SIGKILLed at beat 6 left
 * queue manifests behind, the daemon guard refused to start because of them,
 * and the only code that could clear them sat downstream of that guard.
 *
 * TWO PROPERTIES make it safe to run before anything else:
 *   · every path it touches carries the owning story's id, so it can never
 *     reach another story's fixtures;
 *   · it is date-independent, so a run on any day cleans any day's residue —
 *     the date-stamped per-id cleanups it replaces could not.
 */
import { rmSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

/** A story id must be a single safe path segment — it is interpolated into
 *  paths that are then removed recursively. `..` or a separator would resolve
 *  outside the story's namespace. */
function assertSafeStoryId(storyId) {
  if (typeof storyId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(storyId) || storyId.includes('..')) {
    throw new Error(
      `unsafe story id ${JSON.stringify(storyId)}: expected a single path segment of [A-Za-z0-9._-]`,
    );
  }
}

/**
 * The `story-<id>` fixture names a story can mint, in every case the product
 * might use. A story declares its id as authored (`S2`, `S4`); `create` slugs
 * the typed name to lower case before it writes a directory, so the sweep has
 * to ask for both or it can never own the ground it made. Measured on S2 run 1
 * (2026-09-04, bead `forge-8vfn.2.21`): a story declared `S2` minted
 * `projects/story-s2` while the sweep removed `projects/story-S2` — different
 * directories on a case-sensitive filesystem, so the next run reds at the
 * create beat with "already exists", a FIXTURE failure wearing a product
 * failure's clothes.
 *
 * `story-` stays a reserved prefix in every variant, so the guard that keeps a
 * story named after its own ground from deleting that ground is untouched.
 */
function storyFixtureNames(storyId) {
  const names = new Set([`story-${storyId}`, `story-${storyId.toLowerCase()}`]);
  return [...names];
}

/**
 * The PRODUCT fixtures a story minted — everything it owns except the run's own
 * output. The leading sweep takes all of it; the TRAILING sweep takes only this
 * subset, because `demos/stories/<id>` is the artifact the run exists to
 * produce and deleting it would delete the clip, the frames and `story.json`.
 *
 * `run.mjs` carried no trailing sweep at all, justified with "the smoke story
 * creates none" — true of `smoke`, false of `proof`, S2 and S4. A green `proof`
 * run left `brain/projects/story-proof` behind twice in one session (M5-B s1).
 */
export function productFixturePathsFor(storyId, root) {
  assertSafeStoryId(storyId);
  const names = storyFixtureNames(storyId);
  return [
    join(root, '_queue', 'in-flight', `STORY-${storyId}.md`),
    join(root, '_queue', 'failed', `STORY-${storyId}.md`),
    join(root, '_logs', `STORY-${storyId}`),
    // A story that onboards a project owns that project — the repo AND the
    // Brain 3 profile onboarding scaffolds beside it. The `story-` prefix is
    // reserved and no real project carries it, so a story named after its own
    // ground can never delete the repo it exists to prove things about.
    ...names.map((name) => join(root, 'projects', name)),
    ...names.map((name) => join(root, 'brain', 'projects', name)),
    // A story that SAVES a flow owns that flow file. `/flows/new` saves with
    // `create: true`, so a leftover `studio/flows/story-<id>/` makes the second
    // run of the same story 409 on the name and reds every beat after the save
    // for a fixture reason. Measured on S4 run 1 (bead `forge-8vfn.2.26`).
    ...names.map((name) => join(root, 'studio', 'flows', name)),
  ];
}

/**
 * Every path this story owns. Pure, date-independent, and every entry carries
 * the story id (case-insensitively — see `storyFixtureNames`).
 */
export function fixturePathsFor(storyId, root) {
  assertSafeStoryId(storyId);
  return [join(root, 'demos', 'stories', storyId), ...productFixturePathsFor(storyId, root)];
}

/**
 * Remove this story's residue. Never throws: it runs before the run has any
 * reporting set up, so a failure is returned rather than raised.
 *
 * @returns {{removed: string[], failed: {path: string, error: string}[]}}
 */
export function sweepStoryResidue(storyId, root) {
  return removeAll(fixturePathsFor(storyId, root));
}

/**
 * The trailing half of §3.1's duty: the product fixtures this story minted, and
 * never its own artifact. Same removal, a narrower list.
 */
export function sweepProductFixtures(storyId, root) {
  return removeAll(productFixturePathsFor(storyId, root));
}

/**
 * Remove a set of absolute paths, reporting only what was actually there.
 * Exported for ruling 308's late removal: the ground's Brain 3 is HELD through
 * the fence so preflight C4 can pass while the verdict is read, then removed
 * once `story.json` is written.
 */
export function removePaths(paths) {
  return removeAll(paths);
}

function removeAll(paths) {
  const removed = [];
  const failed = [];
  for (const path of paths) {
    try {
      // Check first so `removed` reports only what was actually there —
      // `rmSync(force: true)` is a silent no-op on a missing path, which would
      // otherwise make every clean run claim it swept four paths.
      if (!existsSync(path)) continue;
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    } catch (e) {
      failed.push({ path, error: e?.message ?? String(e) });
    }
  }
  return { removed, failed };
}

/**
 * ── The fence: a story run leaves the tree as it found it ────────────────────
 *
 * A story drives the PRODUCT, and the product writes where it likes. S8 beat 8
 * writes a row into the repo-tracked `studio/community/registry.yaml`, beat 4
 * rewrites that file's `meta.lastRefresh` from a live network refresh, and beat
 * 14 vendors a package into `studio/hooks/` (`S8.story.mjs:93-100`). None of it
 * carries a story id, so no name-keyed sweep can own it: a second run meets a
 * registry that already carries `story-s8-skill`, and live upstream numbers sit
 * in the working tree waiting to be committed (bead `forge-8vfn.6.3`).
 *
 * The fence is by DELTA, never by name. A name-keyed rule ("remove every
 * `SKILL.md` the `skills` tree gained") is the §15.100/.150 shape — it would
 * let a story delete a skill the operator authored. What was not there when the run
 * started, and is not the run's own artifact, is the run's residue; what was
 * already dirty is the operator's and is never touched.
 */

/**
 * Read `git status --porcelain -z` into rows. `-z` is not an optimisation: the
 * human-readable form QUOTES a path containing a space, and §15.155 is the
 * incident where a positional reader met a field with a space in it.
 *
 * A rename or copy emits its SOURCE as a second field with no status. A reader
 * that does not consume it reads it as an entry and mis-attributes every path
 * after it.
 */
export function parseGitPorcelain(stdout) {
  const fields = stdout.split('\0');
  const rows = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (field === '') continue;
    const xy = field.slice(0, 2);
    rows.push({ xy, path: field.slice(3) });
    if (xy[0] === 'R' || xy[0] === 'C') i += 1;
  }
  return rows;
}

/** The porcelain of `root`, now. */
export function readGitPorcelain(root) {
  return parseGitPorcelain(
    execFileSync('git', ['status', '--porcelain', '-z'], { cwd: root, encoding: 'utf8' }),
  );
}

/**
 * The run's own output. All four are listed so the fence is independent of
 * WHERE in the run it is called — the doc and the gallery are written after the
 * snapshot today, and an ordering nobody has to remember is one that cannot be
 * got wrong later (§15.80).
 */
function runArtifactPaths(storyId) {
  return [
    `demos/stories/${storyId}/`,
    'demos/stories/index.html',
    `docs/tutorials/${storyId}.md`,
    `docs/how-to/${storyId}.md`,
  ];
}

/**
 * What this run wrote that is not its own. Pure — the judgement, apart from the
 * git and fs calls that carry it out.
 *
 * @returns {{restore: string[], remove: string[]}} tracked paths to put back,
 *   and paths that did not exist before this run and are not its artifact.
 */
export function fenceBreaches(before, after, storyId, groundProject = null) {
  assertSafeStoryId(storyId);
  const wasDirty = new Set(before.map((entry) => entry.path));
  const artifacts = runArtifactPaths(storyId);
  const isArtifact = (path) =>
    artifacts.some((a) => (a.endsWith('/') ? path.startsWith(a) : path === a));

  // Ruling 308 — the ground project's Brain 3 sub-wiki is a DESIGNED write, not
  // an escape: S1's onboarding creates it, and preflight clause C4 requires it,
  // so removing it at fence time made S1's own exit row unreachable. Only the
  // ground THIS story declares is exempt; another project's brain is still an
  // escape. It is held, not kept — the trailing removal runs once the verdict
  // is recorded, so a post-run `forge preflight` still sees it.
  const groundBrain =
    groundProject !== null && /^[a-zA-Z0-9._-]+$/.test(groundProject)
      ? `brain/projects/${groundProject}/`
      : null;

  const restore = [];
  const remove = [];
  const defer = [];
  for (const entry of after) {
    if (wasDirty.has(entry.path) || isArtifact(entry.path)) continue;
    if (groundBrain !== null && entry.path.startsWith(groundBrain)) { defer.push(entry.path); continue; }
    (entry.xy === '??' ? remove : restore).push(entry.path);
  }
  return { restore, remove, defer };
}

/**
 * Escapes into git worktrees this run does NOT own — T1 ruling 309(b).
 *
 * S1 run 5 printed `fence: clean` in the same run that wrote into the main
 * checkout. The fence read only its own tree's porcelain, so a sibling-tree
 * write was invisible by construction — and that is the escape that matters
 * most, because it touches a tree the run does not own.
 *
 * Siblings come from `git worktree list`, never a hardcoded path: the guard
 * must cover whatever trees the host has, and the tree that got hit was the
 * main checkout only by accident. Call once before the run for a baseline,
 * once after with that baseline to get what GREW.
 *
 * Nothing here is ever removed. Deleting from a tree the run does not own is
 * not the fence's business; naming it is.
 *
 * @param {string} root the run's OWN worktree, excluded from the result
 * @returns {Map<string,Set<string>>} sibling worktree dir -> its dirty paths
 */
export function snapshotSiblingWorktrees(root) {
  const trees = new Map();
  let listing = '';
  try {
    listing = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
  } catch {
    return trees; // not a worktree-bearing checkout (or no git): no siblings to judge
  }
  for (const line of listing.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const dir = line.slice('worktree '.length).trim();
    if (dir === '' || resolve(dir) === resolve(root)) continue;
    let rows = [];
    try {
      // `-uall` and not the default: git COLLAPSES an untracked directory to its
      // top level, so the escape that started this would have been named
      // `brain/` — true, and useless to whoever has to investigate it. An
      // escape report is only actionable at full path precision.
      rows = parseGitPorcelain(
        execFileSync('git', ['status', '--porcelain', '-z', '-uall'], { cwd: dir, encoding: 'utf8' }),
      );
    } catch {
      continue; // a pruned or unreadable tree is not this run's finding
    }
    trees.set(dir, new Set(rows.map((r) => r.path)));
  }
  return trees;
}

/**
 * What GREW in a sibling worktree since `baseline` — the escapes this run is
 * answerable for. Pre-existing dirt in someone else's tree is never charged to
 * this run.
 *
 * @param {string} root the run's own worktree
 * @param {Map<string,Set<string>>} baseline from `snapshotSiblingWorktrees` before the run
 * @returns {Array<{root: string, paths: string[]}>}
 */
export function siblingWorktreeEscapes(root, baseline) {
  const grown = [];
  for (const [dir, paths] of snapshotSiblingWorktrees(root)) {
    const was = baseline.get(dir) ?? new Set();
    const added = [...paths].filter((p) => !was.has(p)).sort();
    if (added.length > 0) grown.push({ root: dir, paths: added });
  }
  return grown;
}

/**
 * How many entries of a removed tree the fence records before it stops. A
 * runaway directory must not turn one verdict line into a wall of text — and
 * when it does stop, it SAYS so (`truncated`), because a silently short list
 * reads exactly like a genuinely short one.
 */
const FENCE_LISTING_MAX = 20;

/**
 * What a directory held, just before the fence removed it.
 *
 * Bead `forge-8vfn.6.12`. S4 run 2's fence caught a real containment escape —
 * the run created `skills/dev/`, `skills/plan/` and `skills/review/`
 * forge-wide, outside its artifacts and outside its ground — removed them, and
 * printed three lines naming the paths. With the directories gone, the one
 * question worth asking became unanswerable: what was IN them, and therefore
 * who wrote them? A scaffolded `SKILL.md` and an empty directory leave the same
 * trace once both are deleted, and ruling 242's source read could narrow the
 * writer to three candidate routes without pinning it.
 *
 * Sizes travel with the names because an empty scaffold and a real one differ
 * by nothing else. Never throws: evidence-gathering must not be able to stop
 * the fence from doing its actual job.
 */
function listRemovedTree(root, path) {
  const abs = join(root, path);
  let top;
  try {
    if (!statSync(abs).isDirectory()) return null;
    top = readdirSync(abs, { recursive: true, withFileTypes: true });
  } catch {
    return null;
  }
  const files = top.filter((d) => d.isFile());
  const entries = files.slice(0, FENCE_LISTING_MAX).map((d) => {
    const rel = relative(abs, join(d.parentPath ?? d.path, d.name));
    let bytes = null;
    try {
      bytes = statSync(join(abs, rel)).size;
    } catch {
      /* raced or unreadable — the name alone is still evidence */
    }
    return { path: rel, bytes };
  });
  if (entries.length === 0) return null;
  return { path, entries, truncated: files.length > entries.length, total: files.length };
}

/**
 * Put the tree back. Never throws — a fence that dies takes the run's verdict
 * with it. Every failure is returned and reported by name (§15.92): a tree left
 * dirty must be a distinct, named outcome, never a silence.
 *
 * `removed` stays a plain path list — it is the shape `story.json` and every
 * reader already carry — and the listing rides beside it in `removedContents`,
 * present only for directories that actually held something. A removed FILE
 * owes no listing: it is its own evidence.
 *
 * @returns {{restored: string[], removed: string[], removedContents: {path: string, entries: {path: string, bytes: number|null}[], truncated: boolean, total: number}[], failed: {path: string, error: string}[]}}
 */
export function applyFence(breaches, root) {
  const restored = [];
  const removed = [];
  const removedContents = [];
  const failed = [];
  for (const path of breaches.restore) {
    try {
      execFileSync('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', path], {
        cwd: root,
        stdio: 'pipe',
      });
      restored.push(path);
    } catch (e) {
      failed.push({ path, error: e?.stderr?.toString().trim() || e?.message || String(e) });
    }
  }
  for (const path of breaches.remove) {
    try {
      // Read it BEFORE removing it — this is the only moment the evidence exists.
      const listing = listRemovedTree(root, path);
      rmSync(join(root, path), { recursive: true, force: true });
      removed.push(path);
      if (listing !== null) removedContents.push(listing);
    } catch (e) {
      failed.push({ path, error: e?.message ?? String(e) });
    }
  }
  return { restored, removed, removedContents, failed };
}

/** `skills/dev — contained SKILL.md (19 B)`, or `… and 21 more`. */
function describeRemoved(path, removedContents) {
  const record = removedContents.find((r) => r.path === path);
  if (record === undefined) return '';
  const named = record.entries
    .map((e) => (e.bytes === null ? e.path : `${e.path} (${e.bytes} B)`))
    .join(', ');
  return ` — contained ${named}${record.truncated ? ` and ${record.total - record.entries.length} more` : ''}`;
}

/**
 * The env var and the operator-root file the story sweep's DELETE token is read
 * from. Constants, not literals at the call site: they name where an operator
 * puts a credential that can delete repositories, and that location is a
 * decision, not an implementation detail.
 *
 * The path is deliberately OUTSIDE the repo and outside every agent env. A
 * `delete_repo` token reaches EVERY repository the account owns, so it is never
 * the token the agents run under: never `AGENT_ENV_ALLOWLIST`, never a project
 * `secrets.env`, never a spawned session's env.
 */
export const SWEEP_DELETE_TOKEN_ENV = 'FORGE_STORY_SWEEP_DELETE_TOKEN';
export const SWEEP_DELETE_TOKEN_PATH = join(homedir(), '.config', 'forge', 'story-sweep-token');

/** Read the delete token, or null. Operator-root file first, then the env var
 *  the operator may export from it; a missing or empty token is `null`, never
 *  an empty string that would reach `gh` as a credential. */
function readSweepDeleteToken() {
  try {
    const raw = readFileSync(SWEEP_DELETE_TOKEN_PATH, 'utf8').trim();
    if (raw !== '') return raw;
  } catch { /* absent is an ordinary state, not an error */ }
  const env = process.env[SWEEP_DELETE_TOKEN_ENV];
  return typeof env === 'string' && env.trim() !== '' ? env.trim() : null;
}

/**
 * Delete the GitHub remotes a story's run created — bead `forge-8vfn.6.11.2`,
 * T1 ruling 255. The sweep owns every fixture a story authors (#407/#412), and
 * `gh repo create` at project creation makes one of those a real repository.
 *
 * TWO INDEPENDENT CONDITIONS gate every delete, and neither is sufficient
 * alone: the repo must appear in the RUN'S OWN creation manifest, AND its name
 * must carry the story's `story-<id>` prefix. A manifest is written by the run
 * and a prefix is a string; `delete_repo` is not a permission to be one mistake
 * away from.
 *
 * Absent the token this REFUSES LOUDLY BY NAME — naming both the env var and
 * the path — rather than skipping quietly. An un-swept remote nobody is told
 * about is how a story leaks a repository per run, and the token is not yet
 * issued, so the refusal is the expected state today.
 *
 * `readToken` and `runGh` are injected so no test touches a real credential or
 * a real GitHub.
 */
export function sweepStoryRemotes({ storyId, created = [], readToken = readSweepDeleteToken, runGh = null }) {
  const deleted = [];
  const refusals = [];
  const failed = [];
  if (created.length === 0) return { deleted, refusals, failed };

  const prefix = `story-${String(storyId).toLowerCase()}`;
  // The manifest is the AUTHORITY; the prefix is the second, independent check.
  const authorised = [];
  for (const entry of created) {
    const nameWithOwner = typeof entry === 'string' ? entry : entry?.nameWithOwner;
    if (typeof nameWithOwner !== 'string' || nameWithOwner === '') continue;
    const repo = nameWithOwner.split('/').pop() ?? '';
    if (!repo.startsWith(prefix)) {
      refusals.push(
        `REFUSING to delete ${nameWithOwner}: it is in this run's creation manifest but its name does not ` +
          `carry the "${prefix}" story prefix. Both conditions must hold before a delete_repo token is used.`,
      );
      continue;
    }
    authorised.push(nameWithOwner);
  }
  if (authorised.length === 0) return { deleted, refusals, failed };

  const token = readToken();
  if (token === null) {
    refusals.push(
      `REFUSING to delete ${authorised.length} remote(s) this run created (${authorised.join(', ')}): no delete ` +
        `token. Provide it at ${SWEEP_DELETE_TOKEN_PATH} (mode 0600) or as ${SWEEP_DELETE_TOKEN_ENV}. ` +
        'The sweep does not fall back to the agents\' own gh auth: delete_repo reaches every repository the ' +
        'account owns, so it is deliberately not a permission the agents run under. Delete these by hand.',
    );
    return { deleted, refusals, failed };
  }

  const gh =
    runGh ??
    ((args) =>
      execFileSync('gh', args, {
        encoding: 'utf8',
        env: { ...process.env, GH_TOKEN: token },
      }).toString());
  for (const nameWithOwner of authorised) {
    try {
      gh(['repo', 'delete', nameWithOwner, '--yes']);
      deleted.push(nameWithOwner);
    } catch (e) {
      failed.push({ path: nameWithOwner, error: e?.message ?? String(e) });
    }
  }
  return { deleted, refusals, failed };
}

/**
 * The starter agents a flow SAVE may legitimately materialise into the roster.
 *
 * Bead `forge-8vfn.6.12` (T1 ruling 275). `PUT /api/studio/flows/:id` copies a
 * starter package into `skills/<slug>` so a seeded canvas validates on a fresh
 * install (`apps/forge/bridge-studio-writes.ts:191/225-266/449`) — designed,
 * documented, a CLOSED slug set, and an existing `skills/<slug>` always wins.
 * S4 runs 2 and 3 both had the fence remove three of them and call each an
 * escape.
 *
 * The removal is right: run 2 must not inherit run 1's roster. The WORDING was
 * not — calling a designed write an escape trains a reader to skim the fence's
 * own output, which is the one place a real escape appears.
 *
 * DERIVED from `studio/starters/agents/`, the same directory `listStarterAgents`
 * enumerates, never a hardcoded `dev|plan|review`: a hardcoded list drifts the
 * moment a starter is added and would quietly stop naming the new one. A tree
 * without the directory yields none, so every removal reads exactly as before.
 */
export function starterAgentSlugs(root) {
  try {
    return readdirSync(join(root, 'studio', 'starters', 'agents'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** The fence's report, always printed — a clean run says so (§15.92). */
export function describeFence(fence, expectedStarters = []) {
  const defer = fence.defer ?? [];
  const escapes = fence.escapes ?? [];
  if (
    fence.restored.length === 0 && fence.removed.length === 0 && fence.failed.length === 0 &&
    defer.length === 0 && escapes.length === 0
  ) {
    return ['[stories] fence: clean — the run wrote nothing outside its own artifacts'];
  }
  return [
    // Ruling 308 — a sanctioned write is still a write, and is still stated. It
    // is NOT folded into "clean": a reader who learns that the fence's one line
    // sometimes hides a write stops reading the line an escape appears on.
    ...defer.map((p) =>
      `[stories] fence: HELD ${p} — EXPECTED: the story's own onboarding creates the ground's ` +
      'Brain 3 sub-wiki (ADR 035) and preflight clause C4 requires it; kept until the verdict ' +
      'is recorded, then removed by the trailing sweep',
    ),
    // Ruling 309(b) — a tree this run does not own. Never removed from here.
    ...escapes.flatMap(({ root, paths }) =>
      paths.map((p) =>
        `[stories] fence: ESCAPED ${p} — written into ${root}, a worktree this run does not own; ` +
        'NOT removed (that tree is not the fence\'s to edit) — investigate before trusting this run',
      ),
    ),
    ...fence.restored.map((p) => `[stories] fence: RESTORED ${p} — the run wrote a repo-tracked file outside its artifacts`),
    ...fence.removed.map((p) => {
      const slug = /^skills\/([^/]+)$/.exec(p)?.[1];
      const expected = slug !== undefined && expectedStarters.includes(slug);
      return (
        `[stories] fence: REMOVED ${p} — ` +
        (expected
          ? 'EXPECTED: a flow save materialises this starter agent into the roster (bead forge-8vfn.6.12); removed so the next run does not inherit it'
          : 'created by the run, not its artifact') +
        describeRemoved(p, fence.removedContents ?? [])
      );
    }),
    ...fence.failed.map((f) => `[stories] fence: COULD NOT clear ${f.path}: ${f.error} — the tree is left dirty`),
  ];
}
