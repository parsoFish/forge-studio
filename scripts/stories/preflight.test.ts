/**
 * preflight.test.ts — memory preflight and the host lock.
 *
 * MEMORY. Measured (tiered-orchestration, wave-8): a foreign leaked process at
 * 10 GB on this 13 GB host OOM-kills the browser and produces a trailing
 * cluster of `Target crashed` failures **that read exactly like code defects**.
 * Diagnosing it with the cheap tool costs 3 minutes; chasing it as a code
 * defect costs a 45-minute blind re-run and risks re-scoping a healthy beat.
 * So the runner refuses up front and says why, rather than producing a
 * plausible-looking red.
 *
 * HOST LOCK. Ports 4123/4124 are host-global (`journey-sync` rule 6). Two
 * story runs on one host collide on the bridge and the UI, and M0 finding 3
 * measured concurrent suites flaking a wall-clock assertion on this box.
 *
 * Pinned before implementation (`_1.0/gate-manifests/M1-B.txt`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  memoryVerdict, MIN_AVAILABLE_MB, hostLockPath, foreignSessionVerdict,
  remoteSwitchVerdict, REMOTE_BINDING_STORIES,
} from './preflight.mjs';

test('ample memory passes', () => {
  const v = memoryVerdict(8000);
  assert.equal(v.ok, true);
});

test('memory below the floor REFUSES, and the reason names the number and the symptom', () => {
  // Kills a warn-and-continue preflight. The whole value of this check is
  // that the operator is told "this is memory, not code" BEFORE they spend 45
  // minutes reading a crash as a defect.
  const v = memoryVerdict(300);
  assert.equal(v.ok, false);
  assert.match(v.reason, /300/);
  assert.match(v.reason, new RegExp(String(MIN_AVAILABLE_MB)));
  assert.match(v.reason, /Target crashed|memory/i);
});

test('exactly at the floor passes; one below refuses', () => {
  // Measure the boundary rather than trusting a magic number reads "large".
  assert.equal(memoryVerdict(MIN_AVAILABLE_MB).ok, true);
  assert.equal(memoryVerdict(MIN_AVAILABLE_MB - 1).ok, false);
});

test('an unreadable memory figure REFUSES rather than assuming plenty', () => {
  // Kills `available ?? Infinity`. If we cannot tell, we do not proceed to
  // spend a browser boot and a set of beats on it.
  assert.equal(memoryVerdict(null).ok, false);
  assert.equal(memoryVerdict(NaN).ok, false);
});

test('the floor is a stated constant, not a literal buried in a branch', () => {
  assert.equal(typeof MIN_AVAILABLE_MB, 'number');
  assert.ok(MIN_AVAILABLE_MB > 0);
});

test('the host lock lives OUTSIDE the worktree, so two worktrees contend for one lock', () => {
  // The bug this kills: a lock at `<root>/_local/stories.lock` gives every
  // worktree its OWN lock file, so two lanes each acquire "the" lock and both
  // run — while the thing being guarded, ports 4123/4124, is host-global.
  // A per-repo lock on a host-global resource is not a lock at all.
  // hostLockPath takes no argument BY DESIGN — that is the property:
  // it cannot vary with the tree it is called from.
  const a = hostLockPath();
  const b = hostLockPath();
  assert.equal(a, b, 'every tree on this host must resolve the SAME lock path');
  assert.ok(!a.startsWith('/home/parso/forge'), 'the lock must not live inside any worktree');
});

// ── 6.11.50: A COSTED RUN MUST NOT START BESIDE ANOTHER STORY'S SESSIONS
//
// THE INCIDENT, S2 run 10 (funded, $0.3942, VOID as a test). It was launched
// minutes after S1 run 10 in the same lane. Its beat 12 pressed
// `open-session` — a handle `HomeSessionsStrip` renders ONCE PER CARD, so the
// runner's `.first()` takes whichever card sorts first — and landed on
// `2026-09-07T03-38-22-20436835`, S1 run 10's FAILED demo session on
// `gitweave`: a different story, a different project, a different kind. It
// then spent ten minutes waiting for an architect's question box on a demo
// session's page and reported `answered 0 round(s)`.
//
// The product was fine throughout: run 10's own session wrote its questions
// 62 s in and sat at `awaiting-answers` for the rest of the bound.
//
// The trailing sweep removes `story-*` fixtures and has no reason to touch a
// real project's sessions, so nothing was wrong with the sweep either. What
// was missing is a preflight question: IS THIS LANE CLEAN OF OTHER PEOPLE'S
// SESSIONS? A costed run that cannot tell its own session from a neighbour's
// is a run that can spend its bound on the wrong page.

test('6.11.50 (RED): a costed run REFUSES when a session from another project is on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-foreign-'));
  // The exact residue S1 run 10 left behind.
  mkdirSync(join(root, 'projects', 'gitweave', '_demo', '2026-09-07T03-38-22-20436835'), { recursive: true });
  writeFileSync(
    join(root, 'projects', 'gitweave', '_demo', '2026-09-07T03-38-22-20436835', 'status.json'),
    JSON.stringify({ phase: 'failed', project: 'gitweave' }),
  );

  const v = foreignSessionVerdict(root, 'story-s2');
  assert.equal(v.ok, false);
  assert.match(v.reason, /gitweave/, 'the refusal names the project whose session is in the way');
  assert.match(v.reason, /2026-09-07T03-38-22-20436835/, 'and the session, so the operator can go and look at it');
});

test('6.11.50: the run\'s OWN project\'s sessions do not refuse it — the positive control', () => {
  // S1 restores its ground and then fills it with its own sessions. A rule
  // that refused those would refuse every S1 run after its first beat.
  const root = mkdtempSync(join(tmpdir(), 'preflight-own-'));
  mkdirSync(join(root, 'projects', 'gitweave', '_architect', 'a-1'), { recursive: true });
  writeFileSync(join(root, 'projects', 'gitweave', '_architect', 'a-1', 'status.json'), '{}');

  const v = foreignSessionVerdict(root, 'gitweave');
  assert.equal(v.ok, true, v.reason);
});

test('6.11.50: a lane with no sessions at all passes, and says so', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-none-'));
  mkdirSync(join(root, 'projects'), { recursive: true });
  const v = foreignSessionVerdict(root, 'story-s2');
  assert.equal(v.ok, true);
  assert.match(v.reason, /no sessions/i);
});

/**
 * `forge-8vfn.7.6.5` (T1 ruling 518's neighbour, D minted) — the check could
 * not see the sessions that actually got left behind.
 *
 * A flow-bound KB seeds itself through a real project-brain session, and that
 * session is anchored under a DOT-PREFIXED project directory:
 * `projects/.kb-<id>/_project-brain/<sid>`. `foreignSessionVerdict` skipped
 * every `projects/<name>` whose name starts with `.`, so the one shape that
 * routinely survives a run was the one shape the preflight was blind to.
 *
 * MEASURED: S6 left one behind. S4's preflight then reported "sessions ok — 1
 * session(s) on disk, all in gitpulse" and the S4 run drove S6's CRASHED
 * session — beat 12's captured frame is byte-identical to S6 beat 6's (md5
 * `999bcd29…`). A preflight that says "ok" while the residue is on disk is
 * worse than no preflight: it is the reason nobody looked.
 *
 * The skip was never load-bearing. `!project.isDirectory()` already excludes
 * files, and the kind filter below only descends into `_`-prefixed
 * subdirectories, so a dot-directory that is not a project cannot produce a
 * session path by accident.
 */
test('7.6.5 (RED): a session under a DOT-PREFIXED project directory is refused, by name', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-dotproject-'));
  // The exact residue S6 left behind: a flow-bound KB's seeding session.
  const sid = '2026-09-08T01-14-09-88213107';
  mkdirSync(join(root, 'projects', '.kb-story-s6-flow', '_project-brain', sid), { recursive: true });
  writeFileSync(
    join(root, 'projects', '.kb-story-s6-flow', '_project-brain', sid, 'status.json'),
    JSON.stringify({ phase: 'analyzing', project: '.kb-story-s6-flow' }),
  );

  const v = foreignSessionVerdict(root, 'gitpulse');
  assert.equal(v.ok, false, 'a costed run cannot start on top of a foreign session it cannot see');
  assert.match(v.reason, /\.kb-story-s6-flow/, 'the refusal names the dot-prefixed project');
  assert.match(v.reason, new RegExp(sid), 'and the session, so the operator can go and look at it');
});

test('7.6.5: a dot-prefixed project that IS this run\'s own ground does not refuse it', () => {
  // The positive control that stops "refuse dot directories" from passing for
  // the wrong reason: ownership is what decides, exactly as it does for every
  // other project, and a run whose ground IS the flow-bound KB must survive
  // its own seeding session.
  const root = mkdtempSync(join(tmpdir(), 'preflight-dotown-'));
  mkdirSync(join(root, 'projects', '.kb-story-s6-flow', '_project-brain', 'b-1'), { recursive: true });
  writeFileSync(join(root, 'projects', '.kb-story-s6-flow', '_project-brain', 'b-1', 'status.json'), '{}');

  const v = foreignSessionVerdict(root, '.kb-story-s6-flow');
  assert.equal(v.ok, true, v.reason);
  assert.match(v.reason, /1 session/, 'it is COUNTED — seen and owned, not skipped');
});

test('7.6.5: a dot-prefixed entry that is not a project mints no session', () => {
  // Why dropping the skip is safe. `.git` under `projects/` has no `_`-prefixed
  // child, so the walk finds nothing to report and the run is not refused for
  // a directory that never held a session.
  const root = mkdtempSync(join(tmpdir(), 'preflight-dotjunk-'));
  mkdirSync(join(root, 'projects', '.git', 'objects', 'ab'), { recursive: true });
  mkdirSync(join(root, 'projects', 'gitpulse', '_architect', 'a-1'), { recursive: true });

  const v = foreignSessionVerdict(root, 'gitpulse');
  assert.equal(v.ok, true, v.reason);
});

// ── 7.5.7: a story that binds a remote stands on an operator switch ─────────
//
// MEASURED (T1 ruling 456, §15.248). `projects.remote.create` is per-worktree
// operator state in a GITIGNORED `forge.config.json` and it defaults OFF
// (ruling 323 — `bridge-studio-project-onboard.ts:215` mints a remote only when
// it is true). S2's beat 5 asserts the remote, so in any worktree nobody
// remembered to switch on, that beat is red BY CONSTRUCTION — and A's S2 run 1
// spent $1.76 discovering the lane's own config rather than anything about the
// product.
//
// The refusal is worth more than the beat's failure for one reason: a red beat
// says the product is wrong, and this was never the product.

/** A worktree whose `forge.config.json` is `cfg` — or absent when null. */
function tree(cfg: unknown | null): string {
  const d = mkdtempSync(join(tmpdir(), 'remote-switch-'));
  if (cfg !== null) writeFileSync(join(d, 'forge.config.json'), typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
  return d;
}

test('7.5.7: a selection with no remote-binding story is never blocked by the switch', () => {
  // The check must not become a new way for an unrelated run to fail.
  const v = remoteSwitchVerdict(tree(null), ['S1', 'S4', 'smoke']);
  assert.equal(v.ok, true);
  assert.match(v.reason, /no selected story binds a GitHub remote/);
});

test('7.5.7 (RED): S2 with the switch OFF is REFUSED, naming the switch and the file', () => {
  const d = tree({ projectsDir: './projects' });
  const v = remoteSwitchVerdict(d, ['S2']);
  assert.equal(v.ok, false);
  assert.match(v.reason, /S2/);
  assert.match(v.reason, /projects\.remote\.create/, `the switch must be named: ${v.reason}`);
  assert.match(v.reason, new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'and the file it read');
  assert.match(v.reason, /restore it unconditionally/, 'and what to do after (rulings 323/354)');
});

test('7.5.7: S2 with the switch ON passes, and says so', () => {
  const v = remoteSwitchVerdict(tree({ projects: { remote: { create: true } } }), ['S2']);
  assert.equal(v.ok, true);
  assert.match(v.reason, /projects\.remote\.create is on/);
});

test('7.5.7: a MISSING config and an OFF switch refuse DIFFERENTLY', () => {
  // "no config here" and "the switch is off" send the operator to different
  // places, so they must not print the same sentence.
  const missing = remoteSwitchVerdict(tree(null), ['S2']);
  const off = remoteSwitchVerdict(tree({ projectsDir: './projects' }), ['S2']);
  assert.equal(missing.ok, false);
  assert.equal(off.ok, false);
  assert.match(missing.reason, /does not exist/);
  assert.notEqual(missing.reason, off.reason);
});

test('7.5.7 POSITIVE CONTROL: an unparseable config REFUSES rather than assuming the switch', () => {
  // The fail-open shape this campaign keeps meeting: "we could not tell" is
  // not "it is on".
  const v = remoteSwitchVerdict(tree('{ not json'), ['S2']);
  assert.equal(v.ok, false);
  assert.match(v.reason, /could not be parsed/);
  assert.match(v.reason, /refusing rather than assuming/);
});

test('7.5.7: a truthy-but-not-true switch is still OFF', () => {
  // `=== true`, exactly as the product reads it
  // (`bridge-studio-project-onboard.ts:215`). A check looser than the code it
  // guards would pass a run the product then refuses.
  for (const value of ['true', 1, {}, 'yes']) {
    const v = remoteSwitchVerdict(tree({ projects: { remote: { create: value } } }), ['S2']);
    assert.equal(v.ok, false, `create: ${JSON.stringify(value)} must not read as on`);
  }
});

test('7.5.7: the remote-binding set is explicit, so extending it is one line', () => {
  assert.deepEqual([...REMOTE_BINDING_STORIES], ['S2']);
});
