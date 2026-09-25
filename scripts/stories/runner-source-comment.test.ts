/**
 * runner-source-comment.test.ts — `forge-8vfn.7.6.112`: an anchor whose only
 * occurrence in the winning module sits on a comment-shaped line must refuse,
 * not silently resolve. Kept apart from `runner-source.test.ts` (that file is
 * owned by an open sibling PR) so this bead's doors have their own home.
 *
 * THE HAZARD, restated from the bead. `runnerSourceContaining` matches with
 * `source.includes(anchor)`, and a comment counts as a hit exactly like code
 * does. If code carrying an anchor moves to another module and only a comment
 * NAMING it is left behind, there is exactly one hit, on prose, and the
 * resolver returned that module — silently, because one hit reads as a clean
 * resolution. `run.mjs`'s own seam comment ("the beat loop ... lives in
 * `run-story.mjs`") is exactly that shape.
 *
 * THE FIX ONLY LOOKS AT THE WINNING MODULE, and only when there is exactly
 * one. Multiple hits already refuse as ambiguous before this check runs, and
 * a module with at least one non-comment hit resolves exactly as before — a
 * legitimate anchor always has one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runnerSourceContaining } from './runner-source.mjs';

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'runner-source-comment-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

test('REFUSES when the only occurrence of the anchor is on a `//` comment line', () => {
  // The exact hazard shape: the code that used to carry the anchor moved
  // away, and only a seam comment naming it remains.
  const dir = fixture({
    'a.mjs': '// the beat loop now lives in b.mjs\nexport function unrelated() { return 1; }\n',
    'b.mjs': 'export function unrelated2() { return 2; }\n',
  });
  assert.throws(
    () => runnerSourceContaining('the beat loop now lives in b.mjs', dir),
    (e: Error) => {
      assert.match(e.message, /a\.mjs/, 'must name the module it refused, not silently return it');
      assert.match(e.message, /comment/i, 'must say the hits were comment-shaped');
      return true;
    },
  );
});

test('REFUSES when the only occurrence sits on a `*`/`/*` block-comment line', () => {
  const dir = fixture({
    'a.mjs': '/**\n * calls doThing(x, y) somewhere else now\n */\nexport const z = 1;\n',
  });
  assert.throws(
    () => runnerSourceContaining('calls doThing(x, y) somewhere else now', dir),
    (e: Error) => {
      assert.match(e.message, /a\.mjs/);
      assert.match(e.message, /comment/i);
      return true;
    },
  );
});

test('resolves when the winning module has one code hit alongside a comment hit', () => {
  // A comment MENTIONING the anchor beside the real code that still carries
  // it must not regress — the common, safe case the bead's header already
  // covers is untouched by this refusal.
  const dir = fixture({
    'a.mjs': '// calls doThing(x, y) below\nfunction run() { return doThing(x, y); }\n',
  });
  const { path } = runnerSourceContaining('doThing(x, y)', dir);
  assert.match(path, /a\.mjs$/);
});

test('C\'s four measured probes against the real runner tree still behave', () => {
  // Re-derived from `_1.0/plans/m7-b-triage/C.md` §7.6.112 at this lane's own
  // HEAD, not asserted as literal fixtures: two of the four are already
  // ambiguous (2+ modules) before this refusal ever runs, which this test
  // pins so a regression that makes them SINGLE-hit does not silently change
  // meaning underneath this bead.
  assert.equal(
    // T1 1372/1384: the trailing sweep's call moved from `run-story.mjs`
    // (`sweepProductFixtures(story.id, ...)` directly) into
    // `sweep-teardown.mjs`'s `reapCensusAndSweep` (`sweep(storyId, root, {
    // ... })`, `sweep` being the injected seam whose default IS
    // `sweepProductFixtures` — a different call shape, same property.
    runnerSourceContaining('sweep(storyId, root, {').path.endsWith('sweep-teardown.mjs'),
    true,
    'a single code hit still resolves',
  );
  assert.equal(
    runnerSourceContaining('turn-ended-unpriced').path.endsWith('spend.mjs'),
    true,
    'a module with a code hit among several comment hits still resolves',
  );
  assert.throws(
    () => runnerSourceContaining('runStory(story, uiUrl'),
    /is in 2 modules/,
    'already ambiguous (definition + call site) — unaffected by the comment refusal',
  );
  assert.throws(
    () => runnerSourceContaining('run-story.mjs'),
    /is in \d+ modules/,
    'already ambiguous across several modules — unaffected by the comment refusal',
  );
});
