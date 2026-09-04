/**
 * The package's contract: the public door exports exactly what `README.md`
 * says it does, and this test fails against an empty index.
 *
 * T1 ruling 31. `packages/flows/index.ts` was `export {}` for the whole
 * campaign — and unlike a genuinely empty package, flows already had 131
 * symbols crossing its boundary through deep specifiers. So every claim about
 * "the public API of this package" was unfalsifiable in the worst way: the
 * surface existed, nothing described it, and no test could tell a populated
 * index from an empty one.
 *
 * THE README IS PARSED, NOT TRANSCRIBED. The expected list is read out of
 * `README.md` at run time, so it cannot drift from the document humans read.
 * A hand-copied list here would be a second source of truth, and the first
 * thing it would do is disagree.
 *
 * The last test is the acceptance criterion for the whole file: the same
 * comparison must REJECT an empty export map. Without it, an index that
 * regressed to `export {}` alongside a README emptied to match would be two
 * near-empty sets agreeing with each other, and this file would report success.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as flows from './index.ts';

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
    types: ids(section('### Types', '## Three things')),
  };
}

const exported = (): string[] => Object.keys(flows).sort();

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
  assert.ok(values.length >= 110,
    `README.md advertises only ${values.length} value exports. The measured external surface of this package is 131 ` +
    'symbols across 47 module paths; a list this short means the README was emptied rather than the package, and the ' +
    'equality assertion above would then be comparing two near-empty sets and reporting success.');
  assert.ok(types.length >= 30, `README.md advertises only ${types.length} types; expected the 33 the door re-exports.`);
});

test('contract: SPEC.md §2 — the package owns ONE seam, and the door says so', () => {
  const text = readFileSync(README, 'utf8');
  assert.match(text, /run one flow/i,
    'README.md must state the seam this package owns (SPEC.md §2: run one flow); a door that does not name its seam ' +
    'cannot be checked against one.');
  assert.match(text, /rank 5/i,
    "README.md must state the package's rank, because the port injection in this package exists BECAUSE of it — rank 5 " +
    'may not import factory, so the phase executors arrive at `apps/forge` rather than through an import.');
});

test('contract: the door never re-exports factory, and never names a phase executor', () => {
  // The rank-5 rule is the reason this package has a port at all. A door that
  // leaked an executor would mean `runFlow` had acquired a concrete dependency
  // on the tree it is not allowed to import, and the boundary lint alone would
  // not say so — the lint sees imports, not the shape of the public surface.
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const offenders = index
    .split('\n')
    .filter((l) => /^export\b/.test(l))
    .filter((l) => /@forge\/factory|orchestrator\/phases|['"][^'"]*\/phases\/(?!closure|orchestrated-capture|wi-spec-compile)/.test(l));
  assert.deepEqual(offenders, [],
    `the door re-exports something from factory or from an executor module:\n${offenders.join('\n')}`);
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
