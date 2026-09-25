/**
 * run-story.test.ts — WIRING DOORS for `run-story.mjs`, finding row 75
 * (T1 rulings 1258, 1332).
 *
 * `runStory()` CANNOT BE EXERCISED AS A UNIT. It drives a real Playwright
 * browser against a real Studio bridge end to end, and T3 rule 3 forbids
 * running any story from this seat — there has never been a `run-story.test.ts`
 * for exactly that reason. So these doors read the SOURCE TEXT instead, the
 * same shape `reap.test.ts`'s "the controls file raises keepArtifacts BEFORE
 * the reap" test uses for the identical reason (a condition — or here, a
 * gate — that cannot be produced or observed by invoking the function at all).
 *
 * WHAT THIS CAN AND CANNOT PROVE. A source-text door cannot show the gates
 * behave correctly at runtime — `sweep-teardown.test.ts`'s real-process doors
 * already prove `reapCensusAndSweep` itself does that. What this CAN show,
 * and mutation-checks, is that `runStory()` actually WIRES those results into
 * its own verdict rather than computing and discarding them — the exact shape
 * of the defect this row closes: `quiesce.settled` and `fence.reappeared` were
 * both already computed and printed, and neither ever reached a `return 1`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC_PATH = join(import.meta.dirname, 'run-story.mjs');
const src = () => readFileSync(SRC_PATH, 'utf8');

test('row 75: the trailing sweep is reached through the census-gated reapCensusAndSweep, never a bare sweepProductFixtures call', () => {
  const s = src();
  assert.match(
    s, /import\s*\{\s*reapCensusAndSweep\s*\}\s*from\s*'\.\/sweep-teardown\.mjs';/,
    'reapCensusAndSweep must be imported from sweep-teardown.mjs',
  );
  assert.doesNotMatch(
    s, /[^.]sweepProductFixtures\(/,
    'no direct call may remain — the census gate lives INSIDE reapCensusAndSweep, so a direct call would bypass it',
  );
  assert.match(s, /await reapCensusAndSweep\(\{/, 'the trailing sweep must be reached through the census-gated function');
});

test('row 75: a census that never settled REDS the run — checked, not only logged', () => {
  const s = src();
  const idx = s.indexOf('if (!trailing.census.empty)');
  assert.notEqual(idx, -1, 'the census-refusal gate must exist in the verdict section');
  const nearby = s.slice(idx, idx + 400);
  assert.match(nearby, /return 1;/, 'a non-empty census must end the run non-zero, not merely print a line');
});

test('row 75: an artefact that reappeared after the census reported empty REDS the run', () => {
  const s = src();
  const idx = s.indexOf('if (trailing.reappearedArtefacts.length > 0)');
  assert.notEqual(idx, -1, 'the reappeared-artefact gate must exist');
  const nearby = s.slice(idx, idx + 400);
  assert.match(nearby, /return 1;/, 'a reappeared artefact must end the run non-zero — never a silent CLEARED');
});

/**
 * T1 ruling 1332's own words: `fence.reappeared` NAMED a removal that did not
 * stick and stopped there — a comment near `ownGroundDrift.clear.unremoved`
 * already called it "the same failure `fence.reappeared` exists for" while
 * `fence.reappeared` itself only ever reached a `console.warn`. "Never a
 * silent CLEARED" is a sentence printed, not enforced, until it also ends
 * the run.
 */
test('row 75: fence.reappeared REDS the run, not only console.warn', () => {
  const s = src();
  const idx = s.indexOf('if (fence.reappeared.length > 0)');
  assert.notEqual(idx, -1, 'fence.reappeared must gate the verdict');
  const nearby = s.slice(idx, idx + 400);
  assert.match(nearby, /return 1;/, 'fence.reappeared must end the run non-zero');
});

test('row 75: all three new gates run BEFORE the final green/red return, so none of them can be skipped by an early exit above them going away', () => {
  const s = src();
  const censusGate = s.indexOf('if (!trailing.census.empty)');
  const artefactGate = s.indexOf('if (trailing.reappearedArtefacts.length > 0)');
  const fenceGate = s.indexOf('if (fence.reappeared.length > 0)');
  const finalReturn = s.indexOf('return (row.status ===');
  assert.ok(finalReturn !== -1, 'the final green/red return must still exist');
  for (const [name, at] of [['census', censusGate], ['artefact', artefactGate], ['fence.reappeared', fenceGate]] as const) {
    assert.ok(at !== -1, `${name} gate must exist`);
    assert.ok(at < finalReturn, `${name} gate must run before the final return, or a green beat score could outrun it`);
  }
});

/**
 * The census result must be threaded from the SAME object `reapCensusAndSweep`
 * returned — a second, independent computation of "did it settle" would be
 * the very drift `reap-census.mjs`'s header warns a duplicated /proc parser
 * invites, one call site removed.
 */
test('row 75: the census and artefact gates read the SAME `trailing` object the sweep call produced', () => {
  const s = src();
  const assign = s.indexOf('const trailing = await reapCensusAndSweep(');
  const censusGate = s.indexOf('if (!trailing.census.empty)');
  const artefactGate = s.indexOf('if (trailing.reappearedArtefacts.length > 0)');
  assert.ok(assign !== -1 && assign < censusGate && assign < artefactGate, 'both gates must read the one `trailing` this call produced');
});
