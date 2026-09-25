/**
 * run.test.ts — WIRING DOORS for `run.mjs`'s teardown exit code, D's review
 * of #906, MUST 1.
 *
 * `main()` CANNOT BE EXERCISED AS A UNIT. It boots a real bridge, a real
 * Playwright browser, checks host locks and memory, and calls
 * `main().then((code) => process.exit(code))` at module scope — importing it
 * at all RUNS it. So these doors read the SOURCE TEXT instead, the same
 * shape `run-story.test.ts` and `reap.test.ts`'s "controls file raises
 * keepArtifacts BEFORE the reap" test use for the identical reason.
 *
 * WHAT THIS CAN AND CANNOT PROVE. `teardownExitCode` itself — the actual
 * decision logic — is a plain, pure function and is fully behaviourally
 * doored in `sweep-teardown.test.ts` (red before it existed, green after,
 * mutation-checked). What THIS file proves is narrower and cannot be proven
 * any other way: that `main()` actually CALLS that function with its own
 * `exitCode` and `stop`, and actually REASSIGNS `exitCode` from the result,
 * rather than computing a fold nobody reads — exactly the shape of MUST 1's
 * defect (a surviving daemon grandchild printed a REFUSING/DID NOT HOLD line
 * and the process still exited 0).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC_PATH = join(import.meta.dirname, 'run.mjs');
const src = () => readFileSync(SRC_PATH, 'utf8');

test('MUST 1: teardownExitCode is imported from sweep-teardown.mjs', () => {
  assert.match(
    src(),
    /import\s*\{[^}]*\bteardownExitCode\b[^}]*\}\s*from\s*'\.\/sweep-teardown\.mjs';/,
    'teardownExitCode must be imported alongside stopSchedulerCensusAndRelease',
  );
});

test('MUST 1: the teardown\'s stop result is folded into exitCode, and exitCode is REASSIGNED from it', () => {
  const s = src();
  const stopAt = s.indexOf('const stop = await stopSchedulerCensusAndRelease(ROOT);');
  assert.notEqual(stopAt, -1, 'the teardown call itself must still exist, unmoved');
  const foldAt = s.indexOf('teardownExitCode(exitCode, stop)', stopAt);
  assert.notEqual(foldAt, -1, 'teardownExitCode must be called with the CURRENT exitCode and the stop it just produced, after the stop call');
  const reassignAt = s.indexOf('exitCode = teardown.exitCode;', foldAt);
  assert.notEqual(reassignAt, -1, 'exitCode must be REASSIGNED from the fold\'s result — computing it and discarding it is the exact defect MUST 1 closes');
});

test('MUST 1: the fold runs inside the SAME finally block as the teardown call, before that block ends', () => {
  const s = src();
  const finallyAt = s.indexOf('} finally {');
  const stopAt = s.indexOf('const stop = await stopSchedulerCensusAndRelease(ROOT);');
  const reassignAt = s.indexOf('exitCode = teardown.exitCode;');
  const finallyCloses = s.indexOf('\n  }\n', reassignAt); // the finally block's own closing brace, first one after the reassignment
  assert.ok(finallyAt !== -1 && finallyAt < stopAt, 'the teardown call must be inside the finally block, not the try');
  assert.ok(stopAt < reassignAt, 'the fold must read the stop result the SAME pass produced, never a stale one');
  assert.ok(reassignAt < finallyCloses, 'the reassignment must land before the finally block ends, so the outer `return exitCode` sees it');
});

test('MUST 1: the final return still reads the SAME exitCode variable the teardown can now change', () => {
  const s = src();
  assert.match(s, /\n\s*return exitCode;\s*\n\}/, 'main() must still return the mutable exitCode, not a snapshot taken before the finally block');
});
