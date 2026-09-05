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
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  applyFence,
  starterAgentSlugs,
  describeFence,
  fenceBreaches,
  fixturePathsFor,
  parseGitPorcelain,
  productFixturePathsFor,
  sweepStoryResidue,
} from './sweep.mjs';

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

// ---------------------------------------------------------------------------
// M5-B: two fixtures a story authors that the sweep did not own. Both measured
// on this lane's own runs (2026-09-04, `_1.0/evidence/m5-b-S{2,4}-run1/`).
// ---------------------------------------------------------------------------

test('a story that saves a flow owns that flow file, and the sweep reaches it', () => {
  // Measured on S4 run 1: the run left `studio/flows/story-s4/flow.yaml`, which
  // no path in this list covered. A `/flows/new` save carries `create: true`,
  // so the SECOND run of the same story 409s on the name and every beat after
  // the save reds for a FIXTURE reason wearing a product failure's clothes —
  // the `forge-8vfn.2.19` class through the flows door. Bead `forge-8vfn.2.26`.
  const paths = fixturePathsFor('S4', '/root');
  assert.ok(paths.includes('/root/studio/flows/story-s4'), paths.join(' | '));
});

test('the project fixture is swept under the id the PRODUCT mints, not the one the story declares', () => {
  // Bead `forge-8vfn.2.21`, measured on S2 run 1: `create` slugs the typed name
  // to lower case, so a story declared `S2` mints `projects/story-s2` while the
  // sweep asked for `projects/story-S2`. On a case-sensitive filesystem those
  // are different directories, so the sweep could NEVER own the ground it made
  // and the next run reds at the create beat with "already exists".
  const paths = fixturePathsFor('S2', '/root');
  assert.ok(paths.includes('/root/projects/story-s2'), paths.join(' | '));
  assert.ok(paths.includes('/root/brain/projects/story-s2'), paths.join(' | '));
});

test('the namespacing invariant holds for an UPPERCASE id too', () => {
  // The safety property is unchanged by the case fix, only restated: every path
  // still carries the owning story's id — case-insensitively, because the
  // product lower-cases and the story does not.
  for (const p of fixturePathsFor('S4', '/r')) assert.match(p.toLowerCase(), /s4/);
});

test('the sweep removes a saved flow left by a previous interrupted run', () => {
  const root = scratch();
  plant(join(root, 'studio', 'flows', 'story-s4', 'flow.yaml'));
  const report = sweepStoryResidue('S4', root);
  assert.equal(existsSync(join(root, 'studio', 'flows', 'story-s4')), false);
  assert.ok(report.removed.some((p) => p.endsWith(join('studio', 'flows', 'story-s4'))));
});

test('the sweep can never reach a REAL flow, whatever a story is called', () => {
  // The `story-` prefix guard, carried to the flows namespace: the two shipped
  // starters (`develop`, `forge-architect`) and any flow the operator authored
  // must be unreachable however a story is named.
  for (const id of ['develop', 'forge-architect', 'gitpulse']) {
    const paths = fixturePathsFor(id, '/root');
    assert.ok(!paths.includes(`/root/studio/flows/${id}`), paths.join(' | '));
  }
});

// ── M5-B s2: a story run leaves the tree as it found it (beads forge-8vfn.6.3,
// the trailing-sweep half of `run.mjs`).
//
// TWO MEASURED HOLES, one property.
//
//   1. There is no trailing sweep. `run.mjs` justified its absence with "the
//      smoke story creates none" — true of `smoke`, false of `proof`, S2 and
//      S4. A green `proof` run left `brain/projects/story-proof` behind twice
//      in one session (M5-B s1). The trailing duty is the PRODUCT fixtures a
//      story minted; the run's own clip, doc and `story.json` ARE its output
//      and must survive.
//
//   2. A story drives the product into writing REPO-TRACKED files outside its
//      own namespace, and nothing puts them back. S8 beat 8 writes a row into
//      `studio/community/registry.yaml`, beat 4 rewrites that file's
//      `meta.lastRefresh` from a live network refresh, and beat 14 vendors a
//      package into `studio/hooks/` (S8.story.mjs:93-100, bead 6.3). A second
//      run then meets a registry that already carries `story-s8-skill`, and
//      live upstream numbers sit in the working tree waiting to be committed.
//
// The fence is by DELTA, never by name. A pattern-kill ("remove `skills/*/
// SKILL.md`") is the §15.100/.150 shape — it would let a story delete a skill
// the operator authored. A file that was not there when the run started, and
// is not the run's artifact, is the run's residue; a file that was already
// dirty is the operator's and is never touched.

const porcelainZ = (...entries: string[]) => `${entries.join('\0')}\0`;

test('the trailing sweep owns the product fixtures a story minted, never the artifact it exists to produce', () => {
  const product = productFixturePathsFor('S4', '/r');
  assert.ok(!product.includes('/r/demos/stories/S4'), product.join(' | '));
  for (const p of ['/r/projects/story-s4', '/r/brain/projects/story-s4', '/r/studio/flows/story-s4']) {
    assert.ok(product.includes(p), `${p} missing from ${product.join(' | ')}`);
  }
  // The leading sweep's contract is unchanged: it still owns everything.
  assert.deepEqual(fixturePathsFor('S4', '/r'), ['/r/demos/stories/S4', ...product]);
});

test('porcelain is read from the NUL-delimited stream, so a path carrying a space survives', () => {
  // S15.155: a field containing a space breaks every positional reader
  // downstream of it. `git status --porcelain` QUOTES such a path; the `-z`
  // form does not, and is the only form a split can be trusted on.
  const rows = parseGitPorcelain(porcelainZ(' M studio/my flows/a.yaml', '?? skills/plan/SKILL.md'));
  assert.deepEqual(rows, [
    { xy: ' M', path: 'studio/my flows/a.yaml' },
    { xy: '??', path: 'skills/plan/SKILL.md' },
  ]);
});

test('a rename entry does not swallow the path that follows it', () => {
  // In `-z`, a rename emits the destination and then the SOURCE as its own
  // field. A reader that does not consume the source reads it as an entry with
  // no status and mis-attributes every path after it.
  const rows = parseGitPorcelain(porcelainZ('R  new.ts', 'old.ts', ' M kept.ts'));
  assert.deepEqual(rows, [
    { xy: 'R ', path: 'new.ts' },
    { xy: ' M', path: 'kept.ts' },
  ]);
});

test('a tracked file the RUN dirtied is restored, and an untracked file the run created is removed', () => {
  const before = parseGitPorcelain(porcelainZ());
  const after = parseGitPorcelain(
    porcelainZ(' M studio/community/registry.yaml', '?? studio/hooks/block-protected-branch-push/', '?? skills/plan/SKILL.md'),
  );
  assert.deepEqual(fenceBreaches(before, after, 'S8'), {
    restore: ['studio/community/registry.yaml'],
    remove: ['studio/hooks/block-protected-branch-push/', 'skills/plan/SKILL.md'],
  });
});

test('a file that was ALREADY dirty before the run is the operator\'s, and is never touched', () => {
  // Kills the fence-as-tree-cleaner. The lane commits before every run, but an
  // operator watching a run must not have their work-in-progress reverted by
  // a gate they only meant to observe.
  const dirty = porcelainZ(' M packages/projects/reset.ts', '?? notes.md');
  const breaches = fenceBreaches(parseGitPorcelain(dirty), parseGitPorcelain(dirty), 'S8');
  assert.deepEqual(breaches, { restore: [], remove: [] });
});

test('the run\'s OWN artifacts are never a breach, wherever the fence is called', () => {
  // The clip, the story.json, the generated doc and the gallery index are the
  // run's output. Listing all four makes the fence independent of where in the
  // run it is called — there is no ordering left to remember (S15.80).
  const after = parseGitPorcelain(
    porcelainZ('?? demos/stories/S8/', ' M demos/stories/index.html', ' M docs/how-to/S8.md', '?? docs/tutorials/S8.md'),
  );
  assert.deepEqual(fenceBreaches([], after, 'S8'), { restore: [], remove: [] });
});

test('another story\'s artifact IS a breach — the allowance is this run\'s id, not the gallery', () => {
  const after = parseGitPorcelain(porcelainZ(' M demos/stories/S2/story.json', ' M docs/how-to/S2.md'));
  assert.deepEqual(fenceBreaches([], after, 'S8'), {
    restore: ['demos/stories/S2/story.json', 'docs/how-to/S2.md'],
    remove: [],
  });
});

test('the fence refuses an unsafe story id before it interpolates one into a path', () => {
  assert.throws(() => fenceBreaches([], [], '../../etc'), /unsafe story id/);
  assert.throws(() => productFixturePathsFor('..', '/r'), /unsafe story id/);
});

/**
 * bead `forge-8vfn.6.12` — the fence must record WHAT it removed, not only that
 * it removed something.
 *
 * S4 run 2's fence caught a real containment escape: the run created three
 * forge-wide skill directories, `skills/dev/`, `skills/plan/` and
 * `skills/review/`, outside its artifacts and outside its ground. It removed
 * them and printed three lines naming the paths — and with the directories
 * gone, the one question worth asking ("what was IN them, and therefore who
 * wrote them?") became unanswerable. Ruling 242 sent the lane looking for the
 * writer by reading source; the read narrowed it and could not pin it, because
 * a scaffolded `SKILL.md` and an empty directory leave the same trace once both
 * are deleted.
 *
 * So the fence now lists each removed tree before it removes it. Bounded, and
 * the bound is disclosed rather than silent: a runaway directory must not turn
 * a verdict line into a wall of text.
 */
test('AT-6.12-1 (RED) the fence records the CONTENTS of a directory it removes', () => {
  const root = mkdtempSync(join(tmpdir(), 'fence-record-'));
  try {
    mkdirSync(join(root, 'skills', 'dev'), { recursive: true });
    const skillBody = '---\nname: dev\n---\n';
    writeFileSync(join(root, 'skills', 'dev', 'SKILL.md'), skillBody, 'utf8');

    const fence = applyFence({ restore: [], remove: ['skills/dev'] }, root);

    assert.deepEqual(fence.removed, ['skills/dev'], 'the path is still reported as before');
    assert.ok(!existsSync(join(root, 'skills', 'dev')), 'and it is still actually removed');
    const record = fence.removedContents.find((r) => r.path === 'skills/dev');
    assert.ok(record, `the fence must record what it removed. Got: ${JSON.stringify(fence.removedContents)}`);
    assert.deepEqual(record.entries.map((e) => e.path), ['SKILL.md'], JSON.stringify(record));
    assert.equal(
      record.entries[0].bytes,
      Buffer.byteLength(skillBody),
      'the size travels with it — an empty scaffold and a real one differ by nothing else',
    );
    assert.equal(record.truncated, false);

    const said = describeFence(fence).join('\n');
    assert.match(said, /skills\/dev/, said);
    assert.match(said, /SKILL\.md/, `the printed line must name the contents too. Got: ${said}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.12-2 a removed FILE records itself, with no contents list', () => {
  const root = mkdtempSync(join(tmpdir(), 'fence-record-'));
  try {
    writeFileSync(join(root, 'stray.txt'), 'x', 'utf8');
    const fence = applyFence({ restore: [], remove: ['stray.txt'] }, root);
    assert.deepEqual(fence.removed, ['stray.txt']);
    assert.equal(fence.removedContents.length, 0, 'a file IS its own evidence — no listing is owed');
    assert.doesNotMatch(describeFence(fence).join('\n'), /contained/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.12-3 the listing is BOUNDED, and says so rather than truncating in silence', () => {
  const root = mkdtempSync(join(tmpdir(), 'fence-record-'));
  try {
    mkdirSync(join(root, 'runaway'), { recursive: true });
    for (let i = 0; i < 40; i += 1) writeFileSync(join(root, 'runaway', `f${i}.txt`), 'x', 'utf8');
    const fence = applyFence({ restore: [], remove: ['runaway'] }, root);
    const record = fence.removedContents.find((r) => r.path === 'runaway');
    assert.ok(record);
    assert.equal(record.truncated, true, 'a runaway directory must not become a wall of text');
    assert.ok(record.entries.length <= 20, `bounded — got ${record.entries.length}`);
    assert.match(describeFence(fence).join('\n'), /and \d+ more/, 'the bound is disclosed in the line itself');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.12-4 (positive control) a clean fence still says clean, and carries an empty record', () => {
  const fence = applyFence({ restore: [], remove: [] }, tmpdir());
  assert.deepEqual(fence.removedContents, []);
  assert.deepEqual(describeFence(fence), ['[stories] fence: clean — the run wrote nothing outside its own artifacts']);
});

/**
 * The fence names an EXPECTED starter materialisation as such (bead
 * `forge-8vfn.6.12`, T1 ruling 275).
 *
 * S4 runs 2 and 3 both had the fence remove `skills/{dev,plan,review}` and
 * report them as escapes. #459's listing then pinned the writer: `PUT
 * /api/studio/flows/:id` materialises STARTER agents into the roster so a
 * seeded canvas validates on a fresh install (`bridge-studio-writes.ts`
 * :191/:225-266/:449) — designed behaviour, a CLOSED slug set, and an existing
 * `skills/<slug>` always wins.
 *
 * So the removal is right and the WORDING was not: calling a designed,
 * documented write an escape trains the reader to skim the fence's own output,
 * which is the one place a real escape would appear. The fence still removes
 * them — run 2 must not inherit run 1's roster — and still reds anything else.
 *
 * The expected set is DERIVED from `studio/starters/agents/`, the same source
 * `listStarterAgents` enumerates. Hardcoding `dev|plan|review` would drift the
 * moment a starter is added, and would quietly stop naming the new one.
 */
test('AT-6.12-5 (RED) a removed starter agent is named an EXPECTED materialisation, not an escape', () => {
  const root = mkdtempSync(join(tmpdir(), 'fence-starter-'));
  try {
    mkdirSync(join(root, 'studio', 'starters', 'agents', 'plan'), { recursive: true });
    mkdirSync(join(root, 'skills', 'plan'), { recursive: true });
    writeFileSync(join(root, 'skills', 'plan', 'SKILL.md'), '---\nname: plan\n---\n', 'utf8');

    const fence = applyFence({ restore: [], remove: ['skills/plan'] }, root);
    assert.deepEqual(fence.removed, ['skills/plan'], 'still removed — run 2 must not inherit run 1 roster');
    assert.ok(!existsSync(join(root, 'skills', 'plan')), 'and actually gone');

    const said = describeFence(fence, starterAgentSlugs(root)).join('\n');
    assert.match(said, /EXPECTED/, `a designed materialisation must be named as one. Got: ${said}`);
    assert.match(said, /skills\/plan/, said);
    assert.doesNotMatch(said, /created by the run, not its artifact/, `not the escape wording. Got: ${said}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.12-6 (positive control) a FOREIGN path is still reported as an escape, unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'fence-starter-'));
  try {
    mkdirSync(join(root, 'studio', 'starters', 'agents', 'plan'), { recursive: true });
    mkdirSync(join(root, 'skills', 'not-a-starter'), { recursive: true });
    writeFileSync(join(root, 'skills', 'not-a-starter', 'SKILL.md'), 'x', 'utf8');

    const fence = applyFence({ restore: [], remove: ['skills/not-a-starter'] }, root);
    const said = describeFence(fence, starterAgentSlugs(root)).join('\n');
    assert.match(said, /created by the run, not its artifact/, `an unknown slug is still an escape. Got: ${said}`);
    assert.doesNotMatch(said, /EXPECTED/, said);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.12-7 the expected set is DERIVED from studio/starters/agents, never hardcoded', () => {
  const root = mkdtempSync(join(tmpdir(), 'fence-starter-'));
  try {
    // A starter this repo does not ship today. A hardcoded dev|plan|review list
    // would call it an escape; deriving the set names it correctly.
    mkdirSync(join(root, 'studio', 'starters', 'agents', 'brand-new-starter'), { recursive: true });
    mkdirSync(join(root, 'skills', 'brand-new-starter'), { recursive: true });
    writeFileSync(join(root, 'skills', 'brand-new-starter', 'SKILL.md'), 'x', 'utf8');

    assert.deepEqual(starterAgentSlugs(root), ['brand-new-starter']);
    const fence = applyFence({ restore: [], remove: ['skills/brand-new-starter'] }, root);
    assert.match(describeFence(fence, starterAgentSlugs(root)).join('\n'), /EXPECTED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.12-8 (positive control) with NO starters declared, every removal reads exactly as before', () => {
  const root = mkdtempSync(join(tmpdir(), 'fence-starter-'));
  try {
    mkdirSync(join(root, 'skills', 'plan'), { recursive: true });
    writeFileSync(join(root, 'skills', 'plan', 'SKILL.md'), 'x', 'utf8');
    assert.deepEqual(starterAgentSlugs(root), [], 'a tree with no starters dir yields no expected slugs');
    const fence = applyFence({ restore: [], remove: ['skills/plan'] }, root);
    assert.match(describeFence(fence, starterAgentSlugs(root)).join('\n'), /created by the run, not its artifact/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
