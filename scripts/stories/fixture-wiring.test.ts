/**
 * fixture-wiring.test.ts — the SOURCE-ORDER door for D2's fixture-ground wiring
 * (M7-D, D1).
 *
 * WHY A STATIC TEXT CHECK, following `module-wiring.test.ts`'s own precedent:
 * `run.mjs` and `run-story.mjs` boot a bridge, bind the host-global Studio
 * ports and drive a real browser — neither can run inside `npm test`, so a
 * wiring defect in them is invisible to every gate that DOES run there. But
 * ORDERING is not a behavioural question; it is a property of the SOURCE TEXT,
 * answerable by reading it, the same move `module-wiring.test.ts` makes for
 * "does this name resolve".
 *
 * THE THREE PROPERTIES PINNED, each one a place D2's wiring can be half-done
 * and still look plausible on a skim:
 *
 *   - `provisionFixtureGround(` must run AFTER the leading residue sweep and
 *     BEFORE the bridge identity probe — a fixture ground has to exist before
 *     any beat can navigate to it, and provisioning after the bridge is up
 *     would race a driven browser against a `git init` still in flight.
 *   - `teardownFixtureGround(` must run AFTER the LAST `classifyOwnGroundDrift(`
 *     call — tearing the ground down before the drift classification reads it
 *     would make every fixture-ground run's own-ground check pass by finding
 *     nothing there, which is a false green wearing a clean run's clothes.
 *   - `snapshotRealGrounds(` must be called at least twice — once before the
 *     run, once after — because a single call proves nothing: the escape check
 *     (`realGroundEscapes`) needs a BEFORE and an AFTER to compare.
 *
 * None of these names exist in either module yet, so every assertion below is
 * expected RED right now, each one for a distinct absence rather than a single
 * blanket failure — the wiring can be done in three different wrong ways and
 * this catches each one by name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const readSource = (file: string) => readFileSync(join(HERE, file), 'utf8');
const indexOfCall = (source: string, name: string) => source.indexOf(`${name}(`);

test('run.mjs: provisionFixtureGround runs AFTER the leading residue sweep and BEFORE the bridge identity probe', () => {
  const source = readSource('run.mjs');
  const sweepAt = indexOfCall(source, 'sweepStoryResidue');
  const bridgeAt = indexOfCall(source, 'probeBridgeIdentity');
  const provisionAt = indexOfCall(source, 'provisionFixtureGround');

  assert.ok(sweepAt !== -1, 'sweepStoryResidue( must appear in run.mjs — this door\'s own anchor moved');
  assert.ok(bridgeAt !== -1, 'probeBridgeIdentity( must appear in run.mjs — this door\'s own anchor moved');
  assert.ok(
    provisionAt !== -1,
    'run.mjs never calls provisionFixtureGround( — a fixture-ground story would run with no ground provisioned',
  );
  assert.ok(
    provisionAt > sweepAt,
    `provisionFixtureGround( (at ${provisionAt}) must run AFTER sweepStoryResidue( (at ${sweepAt}) — ` +
      'provisioning before the leading sweep would have the sweep remove the ground it just wrote',
  );
  assert.ok(
    provisionAt < bridgeAt,
    `provisionFixtureGround( (at ${provisionAt}) must run BEFORE probeBridgeIdentity( (at ${bridgeAt}) — ` +
      'a beat can drive the browser to a fixture ground only once it exists',
  );
});

test('run-story.mjs: teardownFixtureGround runs AFTER the LAST classifyOwnGroundDrift call', () => {
  const source = readSource('run-story.mjs');
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
  const source = readSource('run-story.mjs');
  const count = (source.match(/snapshotRealGrounds\(/g) ?? []).length;
  assert.ok(
    count >= 2,
    `expected snapshotRealGrounds( at least twice (a BEFORE snapshot and an AFTER one for realGroundEscapes ` +
      `to compare) — found ${count}`,
  );
});
