/**
 * runner-source.test.ts — the doors for `runner-source.mjs` (forge-0fli).
 *
 * WHY IT NEEDS ITS OWN DOORS. It exists so a door can name a PROPERTY and an
 * anchor instead of a filename, which means every door that uses it inherits
 * its correctness. Its two refusals are the load-bearing part: the resolver
 * that silently returned an empty string on a missing anchor would make every
 * caller assert nothing and pass.
 *
 * THE AMBIGUITY REFUSAL FIRED ON ITS FIRST REAL USE, which is why it refuses
 * in BOTH directions rather than only on absence. `queue-claim.test.ts`'s
 * 7.6.74 door was first pointed at `sweepProductFixtures(` — which matches its
 * own definition in `sweep.mjs` as well as the call in `run-story.mjs`. Two
 * hits, and a resolver that took the first would have sliced the arguments out
 * of the DEFINITION's signature and asserted them happily.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runnerSourceContaining, runnerModules } from './runner-source.mjs';

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'runner-source-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

test('resolves the single module holding the anchor, and returns its path', () => {
  const dir = fixture({ 'a.mjs': 'const x = 1;\n', 'b.mjs': 'the anchor lives here\n' });
  const { path, source } = runnerSourceContaining('the anchor', dir);
  assert.match(path, /b\.mjs$/);
  assert.match(source, /the anchor lives here/);
});

test('REFUSES when no module holds the anchor — a door that cannot run is not a door that passed', () => {
  const dir = fixture({ 'a.mjs': 'const x = 1;\n' });
  assert.throws(
    () => runnerSourceContaining('nowhere at all', dir),
    (e: Error) => {
      assert.match(e.message, /no module/);
      assert.match(e.message, /"nowhere at all"/, 'the refusal must name the anchor it looked for');
      assert.match(e.message, /not the same as the property being absent/);
      return true;
    },
  );
});

test('REFUSES when two modules hold the anchor, and NAMES both', () => {
  const dir = fixture({ 'a.mjs': 'shared anchor\n', 'b.mjs': 'shared anchor\n' });
  assert.throws(
    () => runnerSourceContaining('shared anchor', dir),
    (e: Error) => {
      assert.match(e.message, /is in 2 modules/);
      assert.match(e.message, /a\.mjs/);
      assert.match(e.message, /b\.mjs/);
      return true;
    },
  );
});

test('enumerates from the DIRECTORY, so a module added later is visible without editing a list', () => {
  const dir = fixture({ 'a.mjs': 'x\n' });
  assert.equal(runnerModules(dir).length, 1);
  writeFileSync(join(dir, 'b.mjs'), 'the anchor\n');
  assert.equal(runnerModules(dir).length, 2, 'a new .mjs must appear with no edit here');
  assert.match(runnerSourceContaining('the anchor', dir).path, /b\.mjs$/);
});

test('ignores non-.mjs files — a .test.ts mentioning an anchor is not the runner', () => {
  const dir = fixture({ 'a.mjs': 'real anchor\n', 'a.test.ts': 'real anchor\n', 'notes.md': 'real anchor\n' });
  assert.deepEqual(runnerModules(dir).map((p) => p.split('/').pop()), ['a.mjs']);
  assert.match(runnerSourceContaining('real anchor', dir).path, /a\.mjs$/);
});

test('a DIRECTORY named *.mjs is not a module — it never reaches readFileSync', () => {
  // C's note reviewing forge-0fli: the file's whole argument is that enumerating
  // beats keeping a list, and enumeration is where this surprise lives. Without
  // the isFile filter this throws EISDIR — an unnamed failure from the function
  // that exists to give named ones.
  const dir = fixture({ 'real.mjs': 'the anchor\n' });
  mkdirSync(join(dir, 'decoy.mjs'));
  assert.deepEqual(runnerModules(dir).map((p) => p.split('/').pop()), ['real.mjs']);
  assert.match(runnerSourceContaining('the anchor', dir).path, /real\.mjs$/);
});
