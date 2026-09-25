/**
 * fork-grounds-wiring.test.ts — THE CONNECTION for T1 ruling 1350's gap-close.
 *
 * `fork-grounds.mjs` is doored on its own (`fork-grounds.test.ts`); a module
 * that exists and reaches nothing is exactly the `7.6.123 WIRING` species
 * (`ground-clear.test.ts`) and `beats-fork-wiring.test.ts`'s own precedent.
 * No test in this repo imports `runStory` (a real chromium context), so this
 * pins the connection statically via `runnerSourceContaining`.
 *
 *   1. the "before" snapshot of every fill fork's per-case ground is taken
 *      before the beat loop runs — the same moment the base ground's own
 *      `ownGroundBefore` is read, and for the same reason: none of them exist
 *      yet;
 *   2. `judgeForkGrounds` is called with that snapshot, and its lines printed;
 *   3. a non-null `redReason` ends the run red, regardless of the beats —
 *      the same class of gate the base ground's own checks are.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnerSourceContaining } from './runner-source.mjs';

// The DEFINITION site (`export function judgeForkGrounds(`, in fork-grounds.mjs)
// also contains the bare name, so the anchor is the CALL shape specifically —
// unique to the one place run-story.mjs invokes it.
const CALL = '= judgeForkGrounds(';

test('the runner imports snapshotForkGrounds and judgeForkGrounds from fork-grounds.mjs', () => {
  const runner = runnerSourceContaining(CALL);
  assert.match(
    runner.path.split('/').pop() ?? '',
    /^run-story\.mjs$/,
  );
  assert.match(
    runner.source,
    /import \{[^}]*snapshotForkGrounds[^}]*judgeForkGrounds[^}]*\} from '\.\/fork-grounds\.mjs'/s,
  );
});

test('the per-case "before" snapshot is taken before the beat loop, not after', () => {
  const runner = runnerSourceContaining(CALL);
  const snapshotAt = runner.source.indexOf('snapshotForkGrounds(');
  const loopAt = runner.source.indexOf('expandForkedBeats(story.beats,');
  assert.notEqual(snapshotAt, -1, 'snapshotForkGrounds must be called');
  assert.notEqual(loopAt, -1, 'the beat loop must still exist');
  assert.ok(snapshotAt < loopAt, 'the per-case ground snapshot must be taken BEFORE any beat runs');
});

test('judgeForkGrounds\'s lines are printed', () => {
  const runner = runnerSourceContaining(CALL);
  const callAt = runner.source.indexOf(CALL);
  assert.notEqual(callAt, -1);
  const after = runner.source.slice(callAt, callAt + 400);
  assert.match(after, /for \(const line of \w+\.lines\) console\.log\(line\);/);
});

test('a non-null redReason ends the run red, regardless of the beats', () => {
  const runner = runnerSourceContaining(CALL);
  const callAt = runner.source.indexOf(CALL);
  // The gate sits near the END of the run (after every other containment
  // check), so the window is "from the call to EOF" rather than a fixed size.
  const after = runner.source.slice(callAt);
  const gateAt = after.indexOf('redReason !== null');
  assert.notEqual(gateAt, -1, 'the gate must actually read redReason');
  assert.match(after.slice(gateAt, gateAt + 200), /return 1;/, 'and end the run non-zero');
});
