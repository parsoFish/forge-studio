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

// Bead `forge-8vfn.8.1.32` (T1 1694) — the containment verdict (every
// `if (...) { ...; return 1; }` gate plus the final green/red return) is a
// PURE MOVE out of `run-story.mjs` into its own module, `run-story-verdict.mjs`
// (see that file's header). Doors below that assert a GATE exists now read
// THIS source; doors about what feeds the verdict (the bindings themselves)
// still read `src()`.
const VERDICT_PATH = join(import.meta.dirname, 'run-story-verdict.mjs');
const verdictSrc = () => readFileSync(VERDICT_PATH, 'utf8');

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
  const s = verdictSrc();
  const idx = s.indexOf('if (!trailing.census.empty)');
  assert.notEqual(idx, -1, 'the census-refusal gate must exist in the verdict section');
  const nearby = s.slice(idx, idx + 400);
  assert.match(nearby, /return 1;/, 'a non-empty census must end the run non-zero, not merely print a line');
});

test('row 75: an artefact that reappeared after the census reported empty REDS the run', () => {
  const s = verdictSrc();
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
  const s = verdictSrc();
  const idx = s.indexOf('if (fence.reappeared.length > 0)');
  assert.notEqual(idx, -1, 'fence.reappeared must gate the verdict');
  const nearby = s.slice(idx, idx + 400);
  assert.match(nearby, /return 1;/, 'fence.reappeared must end the run non-zero');
});

test('row 75: all three new gates run BEFORE the final green/red return, so none of them can be skipped by an early exit above them going away', () => {
  const s = verdictSrc();
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
 * invites, one call site removed. Bead `forge-8vfn.8.1.32` moved the gates
 * themselves into `run-story-verdict.mjs`, so the property now spans two
 * files: `run-story.mjs` must hand `containmentVerdict` the SAME `trailing`
 * binding it assigned, never a re-derived one, and the gates on the other
 * side must read the parameter `containmentVerdict` actually declares.
 */
test('row 75: the census and artefact gates read the SAME `trailing` object the sweep call produced', () => {
  const s = src();
  const assign = s.indexOf('const trailing = await reapCensusAndSweep(');
  const handoff = s.indexOf('containmentVerdict({');
  assert.ok(assign !== -1, 'the sweep call must be assigned to `trailing`');
  assert.ok(handoff !== -1, 'run-story.mjs must call containmentVerdict');
  assert.ok(assign < handoff, 'trailing must be assigned before it is handed to the verdict');
  const handoffCall = s.slice(handoff, s.indexOf('});', handoff));
  assert.match(
    handoffCall, /(?<![.\w])trailing(?![.\w:])/,
    'the SAME `trailing` binding must be passed, not a re-derived one',
  );
  const g = verdictSrc();
  assert.match(
    g, /function containmentVerdict\(\{[^}]*\btrailing\b/s,
    'containmentVerdict must declare a `trailing` parameter',
  );
});

/**
 * Bead `forge-8vfn.8.1.32`, T1 ruling 1694 — S10 proof run 35's merge fence.
 * `applyMergeAccounting`'s pin must be read BEFORE the own-ground drift block
 * runs any beat (a pin captured after the run would be pinning against
 * itself); its widened `expectedChanges` must be what `classifyOwnGroundDrift`
 * actually receives, not the story's raw declarations alone; and an
 * unverifiable claimed merge must REDS the run exactly like every other
 * containment gate — never a silent pass (§6.15).
 */
test('T1 1694: the ground pin is captured before ownGroundBefore\'s own drift is judged, never after', () => {
  const s = src();
  const pinAt = s.indexOf('captureGroundPin(ROOT,');
  const driftAt = s.indexOf('if (ownGroundBefore !== null) {');
  assert.ok(pinAt !== -1, 'captureGroundPin must be called');
  assert.ok(pinAt < driftAt, 'the pin must be captured before the own-ground drift block runs any beat');
});

test('T1 1694: applyMergeAccounting runs before classifyOwnGroundDrift and its widened expectedChanges reach it', () => {
  const s = src();
  const mergeAt = s.indexOf('applyMergeAccounting({');
  const classifyAt = s.indexOf('classifyOwnGroundDrift(');
  assert.ok(
    mergeAt !== -1 && mergeAt < classifyAt,
    'applyMergeAccounting must run before classifyOwnGroundDrift',
  );
  const between = s.slice(classifyAt, s.indexOf(');', classifyAt));
  assert.match(
    between, /merge\.expectedChanges/,
    'classifyOwnGroundDrift must receive merge.expectedChanges, not the story\'s raw declarations alone',
  );
  assert.doesNotMatch(
    between, /story\.ground\?\.expectedChanges/,
    'the raw story declarations must no longer reach classifyOwnGroundDrift directly',
  );
});

test('T1 1694: an unverifiable merge alignment REDS the run before the undeclared-paths gate', () => {
  const s = verdictSrc();
  const mergeGate = s.indexOf('if (ownGroundDrift.mergeAlignmentFailure !== null)');
  const undeclaredGate = s.indexOf('if (ownGroundDrift.undeclared.length > 0)');
  assert.ok(mergeGate !== -1, 'the merge-alignment gate must exist in the verdict section');
  assert.match(
    s.slice(mergeGate, mergeGate + 200), /return 1;/,
    'an unverifiable merge alignment must end the run non-zero',
  );
  assert.ok(
    mergeGate < undeclaredGate,
    'the named merge-alignment reason must be checked before the generic undeclared dump',
  );
});
