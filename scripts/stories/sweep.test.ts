/**
 * sweep.test.ts — the crash-safe sweep, ported from the old harness's one
 * genuinely load-bearing guard (`scripts/lib/journey-residue.mjs`).
 *
 * THE MEASURED INCIDENT it exists for (2026-08-24): a run SIGKILLed at beat 6
 * left `_queue/in-flight/…`, `_queue/failed/…`, a `_logs/` dir and a
 * half-stripped tracked `project.json` behind — because the harness installs
 * no signal handlers, so no kill ever reaches its end-of-run `finally`. The
 * daemon guard then refused to start *because of* that residue, and the only
 * code that could clear it sat downstream of the guard. Self-perpetuating,
 * and misdiagnosed twice as a flaky beat, because a surviving detached bridge
 * sometimes cleared the stray first — a race with an orphan, which is exactly
 * what "flaky" means.
 *
 * The cure is structural, not a cleanup step someone must remember: sweep at
 * the START of every run. A start-of-run sweep is crash-safe against every
 * signal by construction, because it does not depend on the previous process
 * having survived to do anything.
 *
 * §3.1 requires it at BOTH ends: the leading sweep stops a run inheriting a
 * dead run's state, the trailing sweep stops a successful run leaving residue
 * for the next story. Same function, called twice.
 *
 * Pinned before implementation (`_1.0/gate-manifests/M1-B.txt`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fixturePathsFor, sweepStoryResidue } from './sweep.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'stories-sweep-'));
const plant = (p) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, 'residue');
};

test('every fixture path is namespaced by the story that owns it', () => {
  // This is what makes a start-of-run sweep safe: it can only ever remove
  // paths carrying its own story id.
  const paths = fixturePathsFor('smoke', '/r');
  assert.ok(paths.length > 0);
  for (const p of paths) assert.match(p, /smoke/);
});

test('the sweep is DATE-INDEPENDENT — the same story sweeps the same paths', () => {
  // The per-id cleanups this backstops were date-stamped, so a run on a later
  // day could not clean an earlier day's residue. Kills any Date.now() in the
  // path derivation.
  assert.deepEqual(fixturePathsFor('smoke', '/r'), fixturePathsFor('smoke', '/r'));
});

test('the sweep removes residue left by a previous interrupted run', () => {
  const root = scratch();
  const victim = fixturePathsFor('smoke', root)[0];
  plant(victim);
  const { removed, failed } = sweepStoryResidue('smoke', root);
  assert.equal(existsSync(victim), false);
  assert.ok(removed.includes(victim));
  assert.deepEqual(failed, []);
});

test("the sweep never touches another story's fixtures", () => {
  // The property that lets nine stories share one repo. Kills a sweep that
  // globs a whole directory.
  const root = scratch();
  const mine = fixturePathsFor('smoke', root)[0];
  const theirs = fixturePathsFor('S5', root)[0];
  plant(mine);
  plant(theirs);
  sweepStoryResidue('smoke', root);
  assert.equal(existsSync(mine), false);
  assert.equal(existsSync(theirs), true, "S5's fixture must survive smoke's sweep");
});

test('a clean tree sweeps to an empty report rather than throwing', () => {
  // The leading sweep runs before everything, including on a first-ever run.
  // It must be a no-op, not an error.
  const { removed, failed } = sweepStoryResidue('smoke', scratch());
  assert.deepEqual(removed, []);
  assert.deepEqual(failed, []);
});

test('the sweep never throws — it reports what it could not remove', () => {
  // Kills a sweep that propagates an unlink error. It runs before the run has
  // any reporting set up; throwing there loses the reason and the run.
  const root = scratch();
  assert.doesNotThrow(() => sweepStoryResidue('smoke', root));
});

test('a failure is REPORTED, never silently swallowed', () => {
  // The shape matters even when the happy path is empty: `failed` entries
  // carry the path and the reason, so a residue that survives is visible.
  const result = sweepStoryResidue('smoke', scratch());
  assert.ok(Array.isArray(result.failed));
  assert.ok(Array.isArray(result.removed));
});

test('a story id that could escape its namespace is rejected', () => {
  // The sweep deletes recursively from a caller-supplied id. An id of '..' or
  // one carrying a separator would resolve outside the story's namespace and
  // take the whole demos/ tree with it.
  assert.throws(() => fixturePathsFor('../..', '/r'), /story id/);
  assert.throws(() => fixturePathsFor('a/b', '/r'), /story id/);
});

// ── M1-F: a story that onboards a project owns that project as a fixture.
//
// §3.1: "fixtures are named by the story that owns them and swept by the
// story's last beat (crash-safe leading sweep retained)". The proof story
// presses "Onboard project →", which scaffolds a real directory under
// `projects/`, and a second run must not inherit it.

test('a story owns the project fixture named story-<id>, and the sweep reaches it', () => {
  const paths = fixturePathsFor('proof', '/root');
  assert.ok(paths.includes('/root/projects/story-proof'), paths.join(' | '));
});

test('onboarding also scaffolds a Brain 3 profile, and the sweep reaches that too', () => {
  // Measured, not assumed: the first proof run left `brain/projects/story-proof`
  // behind because only `projects/story-proof` was swept. A fixture is every
  // path the product creates for it, not the one the story names.
  const paths = fixturePathsFor('proof', '/root');
  assert.ok(paths.includes('/root/brain/projects/story-proof'), paths.join(' | '));
});

test('the sweep can never reach a REAL project, whatever a story is called', () => {
  // Kills `projects/<storyId>`: a story named after its own ground — `gitpulse`,
  // `gitweave` — would delete the repo it was written to prove things about,
  // silently, before the first beat ran. `story-` is a reserved prefix no real
  // project carries.
  for (const id of ['gitweave', 'gitpulse', 'mdtoc']) {
    const paths = fixturePathsFor(id, '/root');
    assert.ok(!paths.includes(`/root/projects/${id}`));
    assert.ok(!paths.includes(`/root/brain/projects/${id}`));
  }
});
