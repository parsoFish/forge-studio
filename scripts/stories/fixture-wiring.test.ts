/**
 * fixture-wiring.test.ts — the SOURCE-ORDER door for the fixture-ground
 * wiring in `run.mjs` / `run-story.mjs` (M7-D, D1 and its fix round 1).
 *
 * WHY A STATIC TEXT CHECK, following `module-wiring.test.ts`'s own precedent:
 * `run.mjs` and `run-story.mjs` boot a bridge, bind the host-global Studio
 * ports and drive a real browser — neither can run inside `npm test`, so a
 * wiring defect in them is invisible to every gate that DOES run there. But
 * ORDERING is not a behavioural question; it is a property of the SOURCE TEXT,
 * answerable by reading it, the same move `module-wiring.test.ts` makes for
 * "does this name resolve".
 *
 * COMMENTS ARE STRIPPED before every match below — the D1 review's own
 * finding (I3): "the fixture-wiring run-story door passes if a comment
 * contains `teardownFixtureGround(`, because it uses the first `indexOf`."
 * A mention in a doc comment must never satisfy a door that exists to prove
 * the CODE does the thing the comment claims.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Block comments first (they can span lines and would otherwise swallow a
 *  following line-comment marker), then line comments. Not a general JS/TS
 *  parser — this codebase's own comment style (full-line `//…` and `/** … *​/`
 *  blocks, no `//` inside the string literals near these anchors) is all it
 *  has to survive, and it is verified against the real files below. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const readStripped = (file: string) => stripComments(readFileSync(join(HERE, file), 'utf8'));
const indexOfCall = (source: string, name: string) => source.indexOf(`${name}(`);

test('comment-stripping does not eat real code — sanity check on this door\'s own instrument', () => {
  // If this ever failed it would mean `stripComments` is silently deleting
  // anchors the checks below depend on, which would make every RED below a
  // false one. `sweepStoryResidue(` and `probeBridgeIdentity(` both exist in
  // real code in run.mjs; both must still be found after stripping.
  const stripped = readStripped('run.mjs');
  assert.ok(indexOfCall(stripped, 'sweepStoryResidue') !== -1);
  assert.ok(indexOfCall(stripped, 'probeBridgeIdentity') !== -1);
});

// ── run.mjs ──────────────────────────────────────────────────────────────

test('run.mjs: provisionFixtureGrounds (the BATCH function, not the singular in a loop) runs AFTER the leading residue sweep and BEFORE the bridge identity probe', () => {
  // D1 review, M1: the singular `provisionFixtureGround(` called in a loop has
  // no batch atomicity — a refusal partway through leaves every earlier
  // story's ground provisioned. The fix replaces the loop with ONE call to
  // the batch function, which stops at the first refusal and tears down
  // everything it already wrote in that call.
  const source = readStripped('run.mjs');
  const sweepAt = indexOfCall(source, 'sweepStoryResidue');
  const bridgeAt = indexOfCall(source, 'probeBridgeIdentity');
  const provisionAt = indexOfCall(source, 'provisionFixtureGrounds');

  assert.ok(sweepAt !== -1, 'sweepStoryResidue( must appear in run.mjs — this door\'s own anchor moved');
  assert.ok(bridgeAt !== -1, 'probeBridgeIdentity( must appear in run.mjs — this door\'s own anchor moved');
  assert.ok(
    provisionAt !== -1,
    'run.mjs never calls provisionFixtureGrounds( (the batch form) — a loop over the singular has no ' +
      'batch-level rollback on a later story\'s refusal (I3/M1)',
  );
  assert.ok(
    provisionAt > sweepAt,
    `provisionFixtureGrounds( (at ${provisionAt}) must run AFTER sweepStoryResidue( (at ${sweepAt}) — ` +
      'provisioning before the leading sweep would have the sweep remove the ground it just wrote',
  );
  assert.ok(
    provisionAt < bridgeAt,
    `provisionFixtureGrounds( (at ${provisionAt}) must run BEFORE probeBridgeIdentity( (at ${bridgeAt}) — ` +
      'a beat can drive the browser to a fixture ground only once it exists',
  );
});

test('run.mjs: the finally block tears down any fixture ground still standing — a bridge refusal or throw after provisioning must not leave it behind', () => {
  // D1 review, M1: nothing tears down grounds already provisioned when a LATER
  // step refuses or throws (the bridge `refuse` decision, a `bootOwnBridge`
  // failure, an earlier story's `runStory` throwing). The existing abort
  // backstop — the outer `finally` that already stops the scheduler, restores
  // swept paths and reaps agents — is where that belongs; a refusal or crash
  // downstream of provisioning still reaches it.
  const source = readStripped('run.mjs');
  const finallyAt = source.indexOf('finally');
  const teardownAt = indexOfCall(source, 'teardownFixtureGround');

  assert.ok(finallyAt !== -1, 'run.mjs must have its abort-backstop finally block — this door\'s own anchor moved');
  assert.ok(
    teardownAt !== -1,
    'run.mjs never calls teardownFixtureGround( — a fixture ground provisioned before a later refusal or ' +
      'throw would be left behind forever',
  );
  assert.ok(
    teardownAt > finallyAt,
    `teardownFixtureGround( (at ${teardownAt}) must run inside the finally block (which starts at ${finallyAt}) ` +
      '— cleanup that only runs on the happy path is not an abort backstop',
  );
});

// ── run-story.mjs ────────────────────────────────────────────────────────

test('run-story.mjs: teardownFixtureGround runs AFTER the LAST classifyOwnGroundDrift call', () => {
  const source = readStripped('run-story.mjs');
  const lastDriftAt = source.lastIndexOf('classifyOwnGroundDrift(');
  const teardownAt = indexOfCall(source, 'teardownFixtureGround');

  assert.ok(lastDriftAt !== -1, 'classifyOwnGroundDrift( must appear in run-story.mjs — this door\'s own anchor moved');
  assert.ok(
    teardownAt !== -1,
    'run-story.mjs never calls teardownFixtureGround( — a fixture ground would survive every run and the next ' +
      'provision would refuse on "destination already exists"',
  );
  assert.ok(
    teardownAt > lastDriftAt,
    `teardownFixtureGround( (at ${teardownAt}) must run AFTER the last classifyOwnGroundDrift( call (at ${lastDriftAt}) — ` +
      'tearing the ground down first would make the drift classification read an empty directory and report ' +
      'a false-clean run',
  );
});

test('run-story.mjs: snapshotRealGrounds is called at least twice — once before the run, once after', () => {
  const source = readStripped('run-story.mjs');
  const count = (source.match(/snapshotRealGrounds\(/g) ?? []).length;
  assert.ok(
    count >= 2,
    `expected snapshotRealGrounds( at least twice (a BEFORE snapshot and an AFTER one for realGroundEscapes ` +
      `to compare) — found ${count}`,
  );
});

/**
 * D1 review, I3 — "no test covers the requirement that makes the verdict red,
 * so a print-only implementation passes every pinned test." Four separate
 * ways the fence could be gutted and still look wired, each named here:
 *
 *   - `realGroundFenceVerdict(` is never called at all (a hand-rolled inline
 *     check, which is what shipped in D1 and is exactly what I3 found no door
 *     for).
 *   - its `.summary` is computed but never logged (a fence nobody prints is a
 *     fence nobody reads — deleting the unconditional summary line kept every
 *     D1 test green).
 *   - its `.ok` is read but nothing downstream ever reaches `return 1` on a
 *     false one (deleting the `realGroundMoved.length > 0 -> return 1` block
 *     also kept every D1 test green).
 *   - `teardownFixtureGround(` runs BEFORE the last `ownGroundManifest(`
 *     re-read, which would make that re-read see an empty directory.
 *
 * TOKEN ORDER, not a parsed AST: `realGroundFenceVerdict(` … `.ok` … `return 1`,
 * each found by searching forward from the previous match. `run-story.mjs`
 * uses `.ok` nowhere else today (checked directly, not assumed), so this is
 * unambiguous without needing to scope it to one syntactic block.
 */
test('run-story.mjs: the real-ground fence verdict is a real call, its summary is logged, a false .ok reaches return 1, and evidence rides into the artifact', () => {
  const source = readStripped('run-story.mjs');

  const verdictAt = source.indexOf('realGroundFenceVerdict(');
  assert.ok(
    verdictAt !== -1,
    'run-story.mjs never calls realGroundFenceVerdict( (outside comments) — the fence verdict must be a real, ' +
      'tested function call, not hand-rolled inline logic a comment could describe without it being true (I3)',
  );

  const summaryAt = source.indexOf('.summary', verdictAt);
  assert.ok(
    summaryAt !== -1,
    'the verdict\'s .summary must be logged after it is computed — a fence nobody prints is a fence nobody reads',
  );

  const okAt = source.indexOf('.ok', verdictAt);
  assert.ok(
    okAt !== -1,
    'the verdict\'s .ok must gate the run — deleting the realGroundMoved.length > 0 check kept every D1 ' +
      'pinned test green (I3), which is exactly the class this door exists to close',
  );

  const returnAt = source.indexOf('return 1', okAt);
  assert.ok(
    returnAt !== -1,
    `a false .ok (read at ${okAt}) must reach a return 1 afterwards — found none. A print-only implementation ` +
      'must fail this door',
  );

  // I3's other half — the reviewer's point that a re-ordered fix could tear
  // the fixture down before its own-ground drift is re-read.
  const lastOwnGroundAt = source.lastIndexOf('ownGroundManifest(');
  const teardownFixtureAt = indexOfCall(source, 'teardownFixtureGround');
  assert.ok(lastOwnGroundAt !== -1, 'ownGroundManifest( must appear in run-story.mjs — this door\'s own anchor moved');
  assert.ok(teardownFixtureAt !== -1, 'run-story.mjs never calls teardownFixtureGround(');
  assert.ok(
    teardownFixtureAt > lastOwnGroundAt,
    `teardownFixtureGround( (at ${teardownFixtureAt}) must run AFTER the LAST ownGroundManifest( call ` +
      `(at ${lastOwnGroundAt}) — tearing the fixture down before the own-ground re-read would make that ` +
      're-read see an empty directory',
  );

  // Brief item 7 / review M3 — `realGroundMoved` (or whatever the verdict is
  // held in) never reached `result`, so a run that went red on this fence left
  // no record of the escape in its OWN artifact, only on the console.
  assert.ok(
    source.includes('realGrounds'),
    'run-story.mjs never mentions realGrounds — the fence verdict\'s { hashed, trees, moved } must reach ' +
      'story.json for a fixture run, not only the console (I3/M3)',
  );
});
