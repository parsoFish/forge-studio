/**
 * CONTRACT for `@forge/factory` — the package whose door is deliberately empty.
 *
 * `packages/flows/contract.test.ts` pins a README against an `index.ts`. That
 * shape cannot be copied here, and the reason is the point of the package:
 * `index.ts` is `export {}` ON PURPOSE (ADR 048). The two seams import DEEP
 * specifiers precisely so a barrel cannot drag the demo-capture machinery into
 * the bridge's module graph, and populating one to give this test something to
 * read would build a second door with no consumer — the exact "declared data
 * nobody reads" shape M5-A has now found four times.
 *
 * So the door this file pins is the one that EXISTS: the set of module
 * specifiers the enumerated seams import. It is measured from the seam files
 * themselves, never from a list kept here, so the README cannot drift from what
 * the product actually reaches for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..');
const SEAMS = ['apps/forge/factory-wiring.ts', 'apps/forge/factory-cli-wiring.ts'];
const SPECIFIER = /@forge\/factory\/[A-Za-z0-9_./-]+\.ts/g;

function specifiersIn(relPath: string): Set<string> {
  return new Set(readFileSync(join(REPO, relPath), 'utf8').match(SPECIFIER) ?? []);
}

const doorFromSeams = new Set(SEAMS.flatMap((s) => [...specifiersIn(s)]));
const readme = readFileSync(join(import.meta.dirname, 'README.md'), 'utf8');
const doorFromReadme = new Set(readme.match(SPECIFIER) ?? []);

test('kills "the README lists a door nobody opens": every documented specifier is one a seam actually imports', () => {
  const undocumentedByProduct = [...doorFromReadme].filter((s) => !doorFromSeams.has(s)).sort();
  assert.deepEqual(undocumentedByProduct, [], 'the README promises a module no seam imports');
});

test('kills "a seam reaches past the document": every specifier a seam imports is in the README', () => {
  const undocumented = [...doorFromSeams].filter((s) => !doorFromReadme.has(s)).sort();
  assert.deepEqual(
    undocumented,
    [],
    'a seam imports a module the package door does not document — the surface grew without the document that supports it',
  );
});

test('kills "the seam set drifted from the deletability proof": this file and factory-deletable.mjs agree on what a seam is', () => {
  // The proof refuses any production importer outside its own SEAM set. If the
  // two lists disagreed, one of them would be checking a door the other does
  // not consider real, and ADR 048's "fixed, enumerated set of seams" would be
  // enumerated twice with two answers.
  const proof = readFileSync(join(REPO, 'scripts/factory-deletable.mjs'), 'utf8');
  const declared = proof.match(/const SEAM = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
  const proofSeams = [...declared.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
  assert.deepEqual(proofSeams, [...SEAMS].sort());
});

test('kills "someone populated the barrel": index.ts stays an empty door, and says why', () => {
  const index = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf8');
  assert.match(index, /export \{\};?\s*$/, '`index.ts` must remain `export {}` — a barrel here re-couples the bridge to the demo-capture machinery');
  assert.match(index, /Empty on purpose/, 'and the reason must stay beside it, or the next reader will "fix" it');
});

test('the door is not empty in the other direction — this package IS reached, and by exactly two modules', () => {
  assert.ok(doorFromSeams.size > 0, 'a door of zero specifiers would make every assertion above vacuously true');
  assert.equal(SEAMS.length, 2);
});
