/**
 * The package's contract: the public door exports exactly what `README.md`
 * says it does, and this test fails against an empty index.
 *
 * THE README IS PARSED, NOT TRANSCRIBED. The expected list is read out of
 * `README.md` at run time, so it cannot drift from the document humans read.
 * A hand-copied list here would be a second source of truth, and the first
 * thing it would do is disagree. Mirrors `packages/flows/contract.test.ts`'s
 * shape (`packages/flows/README.md`'s own door convention).
 *
 * The last test is the acceptance criterion for the whole file: the same
 * comparison must REJECT an empty export map. Without it, an index that
 * regressed to `export {}` alongside a README emptied to match would be two
 * near-empty sets agreeing with each other, and this file would report success.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as stations from './index.ts';

const README = new URL('./README.md', import.meta.url);

/** Pull the backtick-quoted identifiers out of the README's API tables: the
 *  values table's rows are `| seam | `a` · `b` |`, the Types paragraph is a
 *  `·`-separated run. Both come from the same document the humans read. */
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
  return {
    values: ids(section('## API', '### Types')),
    types: ids(section('### Types', '## What')),
  };
}

const exported = (): string[] => Object.keys(stations).sort();

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
  assert.ok(values.length >= 8, `README.md advertises only ${values.length} value exports — expected at least the measured 9 (the executor, its two deps helpers, the five statically-bound bands, and the docs gate).`);
  assert.ok(types.length >= 4, `README.md advertises only ${types.length} types — expected at least the 4 the door re-exports (ChangeClass, ClassProfilePort, FlowRunnerDeps, GateProfile).`);
});

test('contract: the door states its rank and its one port', () => {
  const text = readFileSync(README, 'utf8');
  assert.match(text, /rank/i,
    "README.md must state the package's rank in the allow-graph.");
  assert.match(text, /ClassProfilePort/,
    'README.md must name the ClassProfilePort seam — the whole reason a band reaches the class table by injection instead of importing it.');
});

test('contract: the door never imports factory — the port exists so it never has to', () => {
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const offenders = index.split('\n').filter((l) => /@forge\/factory/.test(l));
  assert.deepEqual(offenders, [], `the door imports factory directly, defeating the port:\n${offenders.join('\n')}`);
});

test('contract (CONTROL): the same comparison REJECTS an empty index — this is the acceptance criterion for the whole file', () => {
  const want = readmeApi().values;
  assert.throws(
    () => assert.deepEqual([], want),
    'comparing an EMPTY export map against the README API list must throw. If this control passes silently, the ' +
    'assertion in the first test cannot distinguish a populated index from `export {}`.',
  );
});
