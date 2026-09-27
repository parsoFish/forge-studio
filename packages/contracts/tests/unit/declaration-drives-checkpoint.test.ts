/**
 * `declarationDrivesCheckpoint` — the ONE "does this demo declaration drive a
 * checkpoint" rule (bead forge-mfv5.2.8). The `DEMO-SKILL` preflight clause and
 * the demo-builder session's lock both apply it, so a declaration the lock
 * accepts is never one preflight then reports as undrivable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { declarationDrivesCheckpoint } from '../../demo-declaration.ts';

test('one bare-argv capture step drives a checkpoint — counted against every capture step', () => {
  const result = declarationDrivesCheckpoint([
    { kind: 'capture', text: 'Prose only.' },
    { kind: 'capture', text: 'Run `npm run demo` to see it.' },
    { kind: 'verify', text: 'Assert the output.' },
  ]);
  assert.deepEqual(result, { ok: true, drivable: 1, captures: 2 });
});

test('no capture step at all is refused, saying so', () => {
  const result = declarationDrivesCheckpoint([{ kind: 'verify', text: 'Run `npm test`.' }]);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : '', /declares no step of kind 'capture'/);
});

test('an empty declaration is refused the same way', () => {
  assert.equal(declarationDrivesCheckpoint([]).ok, false);
});

test('every undrivable capture step is named with its reason', () => {
  const result = declarationDrivesCheckpoint([
    { kind: 'capture', text: 'Somehow show it.' },
    { kind: 'capture', text: 'Run `npm run demo | tee out` to see it.' },
  ]);
  assert.equal(result.ok, false);
  const reason = !result.ok ? result.reason : '';
  assert.match(reason, /capture step 0 \("Somehow show it\."\) yields no drivable command — no inline-code span to run/);
  assert.match(reason, /capture step 1 .* shell metacharacters in `npm run demo \| tee out`/);
});
