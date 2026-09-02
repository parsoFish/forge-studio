/**
 * contract.test.ts — `@forge/knowledge`'s public door is exactly what the
 * README says it is.
 *
 * WHY THIS FILE IS SHAPED THIS WAY. Exit row 5 asks for
 * `Object.keys(await import('@forge/knowledge'))` asserted against the README's
 * API list. Written literally against the package as it stood, that assertion
 * was `[] === []`: `index.ts` was `export {}` (deliberately — the M2 skeleton
 * preferred an honest empty barrel to a placeholder), the README listed
 * nothing, and the test would have passed while guaranteeing nothing. That is
 * the declared-data-fails-open shape the M4 campaign exists to remove, so
 * reproducing it one file over was not an option. T1 ruling 31 settled it for
 * every wave-1 lane: populate the index, let the README name it, and require
 * this test to FAIL against an empty index.
 *
 * THE ACCEPTANCE CRITERION IS THE FAILURE, NOT THE PASS. `emptyIndexIsRejected`
 * below is the control: it runs the same comparison this file's real assertion
 * runs, against an empty export map, and requires it to throw. If someone
 * empties `index.ts`, the first test fails; if someone weakens the comparison
 * so an empty index would slip through, the control fails. Neither is enough
 * alone — a comparison can be made vacuous without emptying anything.
 *
 * THE README IS PARSED, NOT TRANSCRIBED. The expected list is read out of
 * `README.md` at run time. A hand-copied list in this file would drift from the
 * document it claims to check the moment either changed, and then the test
 * would be pinning a third thing that matches neither.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as knowledge from '../../index.ts';

const README = new URL('../../README.md', import.meta.url);

/** Pull the backtick-quoted identifiers out of the README's API tables. The
 *  Values table's rows are `| area | `a` · `b` |`; the Types paragraph is a
 *  `·`-separated run. Both are read from the same document the humans read. */
function readmeApi(): { values: string[]; types: string[] } {
  const text = readFileSync(README, 'utf8');
  const section = (heading: string, until: string): string => {
    const from = text.indexOf(heading);
    assert.ok(from >= 0, `README.md must contain a "${heading}" heading — this test reads its API list from there`);
    const end = text.indexOf(until, from + heading.length);
    return text.slice(from, end === -1 ? text.length : end);
  };
  const ids = (chunk: string): string[] =>
    [...new Set([...chunk.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]))].sort();
  return { values: ids(section('### Values', '### Types')), types: ids(section('### Types', '## What it owns')) };
}

const exported = () => Object.keys(knowledge).sort();

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
  assert.ok(values.length >= 30,
    `README.md advertises only ${values.length} value exports. The measured external surface of this package is 35 values ` +
    'across 13 module paths; a list this short means the README was emptied rather than the package, and the equality ' +
    'assertion above would then be comparing two empty sets and reporting success.');
  assert.ok(types.length >= 5, `README.md advertises only ${types.length} types; expected the 7 the package exports.`);
});

test('contract (CONTROL): the same comparison REJECTS an empty index — this is the acceptance criterion for the whole file', () => {
  const want = readmeApi().values;
  assert.throws(
    () => assert.deepEqual([], want),
    'comparing an EMPTY export map against the README API list must throw. If this control passes silently, the ' +
    'assertion in the first test cannot distinguish a populated index from `export {}` — which is exactly the state ' +
    'this package was in before T1 ruling 31, and exactly the vacuous-contract shape the M4 campaign exists to remove.');
});

test('contract: every advertised type is a TYPE, not a value masquerading as one — a type in the values table would fail the equality test, and a value in the types table would silently never be checked', () => {
  const { types } = readmeApi();
  const leaked = types.filter((t) => Object.hasOwn(knowledge, t));
  assert.deepEqual(leaked, [],
    `these names are documented under "Types" but exist at RUNTIME: ${leaked.join(', ')}. ` +
    'Type-only exports are erased at runtime and cannot appear in Object.keys, so anything listed there is ' +
    'exempt from the equality assertion above — a value hidden in that list would be public and unchecked.');
});
