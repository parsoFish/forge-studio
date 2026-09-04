/**
 * The package's contract: the public door exports exactly what `README.md`
 * says it does, and this test FAILS against an empty index.
 *
 * T1 ruling 31. `packages/sessions/index.ts` was `export {}` for the whole
 * campaign, which made every claim about "the public API of this package"
 * unfalsifiable — an importer following the README got `undefined`, and no test
 * could tell.
 *
 * THE README IS PARSED, NOT TRANSCRIBED. The expected list is read out of
 * `README.md` at run time, so it cannot drift from the document humans read. A
 * hand-copied list here would be a second source of truth whose first act would
 * be to disagree with the first.
 *
 * The last test is the acceptance criterion for the whole file: the same
 * comparison must REJECT an empty export map. Without it, an index that
 * regressed to `export {}` alongside a README emptied to match would be two
 * near-empty sets agreeing with each other, and this file would report success.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as sessions from './index.ts';

const README = new URL('./README.md', import.meta.url);

/** Pull the backtick-quoted identifiers out of the README's API table and its
 *  Types paragraph — the same document a human reads. */
function readmeApi(): { values: string[]; types: string[] } {
  const text = readFileSync(README, 'utf8');
  const section = (heading: string, until: string): string => {
    const from = text.indexOf(heading);
    assert.ok(from >= 0, `README.md must contain a "${heading}" heading — this test reads its API list from there`);
    const end = text.indexOf(until, from + heading.length);
    return text.slice(from, end === -1 ? text.length : end);
  };
  const ids = (chunk: string): string[] =>
    [...new Set([...chunk.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]!))].sort();
  // The API table's module column also carries backticked paths; those contain
  // `/` or `.` and so never match the identifier pattern above.
  return {
    values: ids(section('## API', '### Types')),
    types: ids(section('### Types', '## Three status pairs')),
  };
}

const exported = (): string[] => Object.keys(sessions).sort();

test('contract: the index exports exactly the values README.md advertises — no undocumented export, no documented-but-missing one', () => {
  const want = readmeApi().values;
  const got = exported();
  assert.deepEqual(got, want,
    'the public door and its documentation have diverged.\n' +
    `  documented but NOT exported (an importer following the README gets undefined): ${want.filter((w) => !got.includes(w)).join(', ') || 'none'}\n` +
    `  exported but NOT documented (public surface nobody agreed to support):        ${got.filter((g) => !want.includes(g)).join(', ') || 'none'}`);
});

test('contract: the README advertises a non-trivial API — a list that shrank to nothing would make the assertion above vacuous', () => {
  const { values, types } = readmeApi();
  assert.ok(values.length >= 28,
    `README.md advertises only ${values.length} value exports. The measured external surface of this package is 34 ` +
    'values across 18 module paths; a list this short means the README was emptied rather than the package, and the ' +
    'equality assertion above would then be comparing two near-empty sets and reporting success.');
  assert.ok(types.length >= 12, `README.md advertises only ${types.length} types; expected the 15 the package exports.`);
});

test('contract: SPEC.md §5 — the package owns ONE seam, and the door says so', () => {
  const text = readFileSync(README, 'utf8');
  assert.match(text, /run one interactive session/i,
    'README.md must state the seam this package owns (SPEC.md §5); a door that does not name its seam cannot be ' +
    'checked against one.');
  assert.match(text, /rank 4/i,
    "README.md must state the package's rank, because the ports in this package exist BECAUSE of it — knowledge is " +
    'rank 2 and cannot import sessions, flows is rank 5 and cannot be imported by it.');
});

test('contract: all three status pairs are named, so the near-collision cannot silently return', () => {
  const text = readFileSync(README, 'utf8');
  for (const name of ['guardedReadStatus', 'guardedWriteStatus', 'readSessionStatus', 'writeSessionStatus',
                      'guardedReadSessionStatus', 'guardedWriteSessionStatus']) {
    assert.match(text, new RegExp(`\\b${name}\\b`),
      `README.md must name ${name}. Three read/write status pairs exist and they are not interchangeable; a fourth, ` +
      'a raw readStatus/writeStatus in kinds/architect.ts, was one letter of difference from the generic pair and was ' +
      'deleted in M4-sessions s6. Naming all six survivors in the door is what stops that collision coming back.');
  }
});

test('contract (CONTROL): the same comparison REJECTS an empty index — this is the acceptance criterion for the whole file', () => {
  const want = readmeApi().values;
  assert.throws(
    () => assert.deepEqual([], want),
    'comparing an EMPTY export map against the README API list must throw. If this control passes silently, the ' +
    'assertion in the first test cannot distinguish a populated index from `export {}` — which is exactly the state ' +
    'this package was in before T1 ruling 31, and exactly the vacuous-contract shape the M4 campaign exists to remove.',
  );
});
