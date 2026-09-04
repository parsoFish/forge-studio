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
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
 * Every path this story owns. Pure, date-independent, and every entry carries
 * the story id (case-insensitively — see `storyFixtureNames`).
 */
export function fixturePathsFor(storyId, root) {
  assertSafeStoryId(storyId);
  const names = storyFixtureNames(storyId);
  return [
    join(root, 'demos', 'stories', storyId),
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
 * Remove this story's residue. Never throws: it runs before the run has any
 * reporting set up, so a failure is returned rather than raised.
 *
 * @returns {{removed: string[], failed: {path: string, error: string}[]}}
 */
export function sweepStoryResidue(storyId, root) {
  const removed = [];
  const failed = [];
  for (const path of fixturePathsFor(storyId, root)) {
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
