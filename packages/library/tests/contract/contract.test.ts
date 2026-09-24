/**
 * contract.test.ts — `index.ts` exports EXACTLY the API `README.md` names.
 *
 * T1 ruling 31. Exit row 5 asks for a contract test on the package's public
 * door, and the ruling adds the part that makes it mean anything: it must FAIL
 * against an empty index. Against `export {}` the naive form of this assertion
 * is `[] === []` — a contract every implementation satisfies, which is the
 * exact shape this campaign exists to remove. This file was written and run
 * BEFORE `index.ts` was populated, and it failed there; see the PR body for
 * that output.
 *
 * WHY IT PARSES THE README RATHER THAN HARD-CODING A LIST. A hard-coded list
 * would be a third place to keep in step, and the first one to rot: the README
 * would drift, the test would keep passing against its own private copy, and
 * the door's documentation would quietly stop describing the door. Parsing the
 * README makes the two mutually enforcing — add an export without documenting
 * it and this fails; document one that does not exist and this fails.
 *
 * WHAT IT CANNOT CHECK, STATED. A module namespace only enumerates VALUES at
 * runtime, so the seven exported TYPES cannot appear in `Object.keys`. They are
 * marked `type` in the README table and excluded from the comparison. The type
 * rows are checked structurally instead (forge-8vfn.20): parsed as an AST via
 * the real TypeScript compiler (`ts.createSourceFile`, the same tool `tsc`
 * itself uses, mirroring `path-guard-caller-built-root-ratchet.test.ts`'s own
 * precedent for this), reading each top-level `export { ... }` declaration's
 * type-only specifiers — never a regex over the raw source text, which would
 * match a name that merely appears in a comment or string. A type documented
 * in the README but only mentioned in prose, never actually exported, is
 * exactly what this catches.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import * as library from '../../index.ts';

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The README's API table, as data: `| \`symbol\` | value|type | … |`. */
function readmeApi(): { values: string[]; types: string[] } {
  const md = readFileSync(join(PKG_DIR, 'README.md'), 'utf8');
  const values: string[] = [];
  const types: string[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|\s*(value|type)\s*\|/);
    if (!m) continue;
    (m[2] === 'value' ? values : types).push(m[1]!);
  }
  return { values: values.sort(), types: types.sort() };
}

/** The names REALLY exported as type-only from `index.ts` — parsed as an AST
 *  (forge-8vfn.20), never a regex over the raw text, so a name that merely
 *  appears in a comment or string cannot pass for an export. Covers both
 *  `export type { X } from '...'` (declaration-level `isTypeOnly`) and
 *  `export { type X } from '...'` (specifier-level `isTypeOnly`) — the two
 *  real TS syntaxes; `index.ts` today uses the latter. */
function indexExportedTypeNames(): Set<string> {
  const indexPath = join(PKG_DIR, 'index.ts');
  const sf = ts.createSourceFile(indexPath, readFileSync(indexPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt) || !stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue;
    for (const el of stmt.exportClause.elements) {
      if (stmt.isTypeOnly || el.isTypeOnly) names.add(el.name.text);
    }
  }
  return names;
}

test('the README documents a real API — the table is not empty and its rows are unique', () => {
  // The non-vacuity guard for everything below: a parser that silently matched
  // nothing would make every other assertion in this file `[] === []`, which is
  // precisely the failure ruling 31 exists to prevent. Assert the shape of the
  // evidence before asserting on the evidence.
  const { values, types } = readmeApi();
  assert.ok(values.length >= 20, `the README's API table parsed only ${values.length} values — the parser or the table is broken`);
  assert.ok(types.length > 0, 'the README documents no types; the table or the parser is wrong');
  assert.equal(new Set(values).size, values.length, 'a symbol is listed twice in the README table');
  assert.equal(new Set(types).size, types.length, 'a type is listed twice in the README table');
});

test('index.ts exports exactly the values the README names — no more, no less', () => {
  const { values } = readmeApi();
  const exported = Object.keys(library).sort();

  const undocumented = exported.filter((k) => !values.includes(k));
  const missing = values.filter((k) => !exported.includes(k));

  assert.deepEqual(undocumented, [], `exported from index.ts but NOT in README.md's table:\n  ${undocumented.join('\n  ')}`);
  assert.deepEqual(missing, [], `named in README.md's table but NOT exported from index.ts:\n  ${missing.join('\n  ')}`);
});

test('every type the README names is really exported from index.ts', () => {
  // Types vanish at runtime, so this cannot be the namespace check the value
  // test above is — it is an AST check instead (forge-8vfn.20), reading the
  // parsed export declarations rather than the raw text, which catches the
  // drift that matters: a type documented as public that the index never
  // actually re-exports (including one merely MENTIONED in a comment, which
  // a source-text regex would have wrongly accepted).
  const { types } = readmeApi();
  const reallyExported = indexExportedTypeNames();
  const absent = types.filter((t) => !reallyExported.has(t));
  assert.deepEqual(absent, [], `documented as public but not exported as a type from index.ts:\n  ${absent.join('\n  ')}`);
});

test('non-vacuity: indexExportedTypeNames() finds a real, non-empty set of type-only exports — proves the AST walk itself is not silently matching nothing', () => {
  const reallyExported = indexExportedTypeNames();
  assert.ok(reallyExported.size > 0, 'indexExportedTypeNames() found zero type exports — the AST walk or index.ts is broken');
});

test('design.md names the ADRs that govern this package', () => {
  // Exit row 5's own wording. Not a word count — the check is that the file
  // cites decision records by number, so a reader arriving at the package can
  // reach the reasoning rather than infer it.
  const design = readFileSync(join(PKG_DIR, 'design.md'), 'utf8');
  const adrs = [...design.matchAll(/ADR\s+(\d{3})/g)].map((m) => m[1]);
  assert.ok(adrs.length >= 2, `design.md cites ${adrs.length} ADR(s); exit row 5 asks it to name the ones that govern the package`);
  assert.ok(adrs.includes('024'), 'design.md must cite ADR 024 — agents compose skills, which is this package\'s own boundary');
  assert.match(design, /isolation/i, 'design.md must state spec §0\'s deferral of plugin-host process isolation');
});
