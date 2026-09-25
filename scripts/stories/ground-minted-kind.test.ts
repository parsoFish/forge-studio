/**
 * ground-minted-kind.test.ts — review finding 1: `groundMintedSessionPaths`
 * (`ground-hash.mjs`) must never licence a `_<kind>/<id>` prefix as a minted
 * session on shape alone.
 *
 * THE PROVEN DEFECT. The first cut counted ANY new top-level `_<kind>/<id>`
 * as minted, and `mintedSessionDirsToClear` → `captureAndClearMintedSessions`
 * DELETES whatever this licenses. A new `_snapshots/2026-09-26/report.md`
 * with no `_logs` correlate at all read as PRODUCED and was cleared — a
 * directory this run never minted, removed on the strength of matching a
 * regex. Split from `ground-hash.test.ts` at the 800-line cap (SPLIT, NEVER
 * BASELINE, the same reason `sweep-teardown-scheduler.test.ts` split from
 * `sweep-teardown.test.ts`): that file sits at the ceiling with no room for
 * four new doors, and this suite exercises one function already imported
 * there rather than a new one.
 *
 * THE FIX (both required, `ground-hash.mjs`): (a) `kind` must be a REGISTERED
 * session kind, and (b) the after-manifest must hold `_<kind>/<id>/status.json`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groundMintedSessionPaths, classifyOwnGroundDrift, groundChanges, groundIgnoreNoneForTests } from './ground-hash.mjs';

const REGISTERED = new Set(['instructions', 'architect']);

test('review finding 1: an UNREGISTERED kind is never minted, even shaped exactly _<kind>/<id> with a status.json', () => {
  // The repro: `_snapshots/2026-09-26/report.md`, no `_logs` correlate,
  // `snapshots` is not a session kind the product declares at all.
  const before = { files: new Map([['CLAUDE.md', 'h1']]) };
  const after = {
    files: new Map([
      ['CLAUDE.md', 'h1'],
      ['_snapshots/2026-09-26/report.md', 'h2'],
      ['_snapshots/2026-09-26/status.json', 'h3'], // even WITH a status.json, an unregistered kind is not a session
    ]),
  };
  assert.deepEqual(groundMintedSessionPaths(before, after, REGISTERED), []);

  // Unioned into the classifier: UNDECLARED, never PRODUCED — so the run's
  // trailing clear never reaches it, closing the "classified produced and
  // cleared" half of the repro too.
  const { produced, undeclared } = classifyOwnGroundDrift(
    groundChanges(before, after), [], new Map(), groundIgnoreNoneForTests(),
  );
  assert.equal(produced.length, 0);
  assert.ok(undeclared.length > 0, 'an unregistered-kind write must surface as UNDECLARED, never silently produced');
});

test('review finding 1: a REGISTERED kind with status.json IS minted', () => {
  const before = { files: new Map() };
  const after = { files: new Map([['_instructions/abc123/status.json', 'h1']]) };
  assert.deepEqual(groundMintedSessionPaths(before, after, REGISTERED), ['_instructions/abc123']);
});

test('review finding 1: a REGISTERED kind with no status.json is never minted — a notes file alone is not a session', () => {
  const before = { files: new Map() };
  const after = { files: new Map([['_instructions/abc123/notes.md', 'h1']]) };
  assert.deepEqual(groundMintedSessionPaths(before, after, REGISTERED), []);
});

test('review finding 1: registeredKindIds is REQUIRED — a caller cannot skip the check and fall back to the old shape', () => {
  const before = { files: new Map() };
  const after = { files: new Map([['_instructions/abc123/status.json', 'h1']]) };
  assert.throws(() => (groundMintedSessionPaths as (b: unknown, a: unknown) => unknown)(before, after));
  assert.throws(() => (groundMintedSessionPaths as (b: unknown, a: unknown, r: unknown) => unknown)(before, after, ['instructions']));
});
