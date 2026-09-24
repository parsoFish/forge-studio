/**
 * no-live-tree-plants.test.ts — a `scripts/*.test.ts` file may not point a
 * write call at the repository ROOT.
 *
 * Bead forge-8vfn.5.64 — the flake CLASS, not just one symptom of it. CI run
 * 36024767395: `check-boundaries.test.ts:272` `writeFileSync`d
 * `packages/kernel/__assembly_probe__.ts` into the live tree while
 * `guard-stdout-flush.test.ts` ran `check-package-caps.mjs` over that same
 * live tree in a concurrent process (`node --test` runs `scripts/*.test.ts`
 * files in parallel); `check-package-caps` listed the probe, then read it
 * after `check-boundaries.test.ts`'s `finally` had already deleted it, and
 * REFUSED (rc 75) rather than passing or failing —
 * `guard-stdout-flush.test.ts:94` went red for a reason no diff caused.
 * `check-disabled-reason.test.ts` did the same thing to its own
 * `__ratchet_probe__.tsx` (second victim; `#342` closed only
 * `check-file-size.mjs`'s side of that one symptom), and
 * `check-file-size.test.ts` planted `__cap_probe__.mjs` /
 * `__headroom_probe__.mjs` the same way.
 *
 * `probe-hygiene.test.ts` (T1 ruling 512) already forbids a `scripts/*.test.ts`
 * file from creating or recursively removing a DIRECTORY under the
 * repository root — planting a FILE in a directory that was already there
 * was ruled fine at the time. It is not: a planted FILE races a concurrent
 * scanner exactly the way a planted DIRECTORY does, just one level down —
 * every incident above is a file, not a directory. This door closes that
 * gap: no `scripts/*.test.ts` file may call `writeFileSync`, `mkdirSync`,
 * `symlinkSync`, `copyFileSync` or `renameSync` with a WRITE-TARGET argument
 * that resolves — directly, or through one local binding (the same bounded,
 * one-level resolution `probe-hygiene.test.ts` already uses) — to the
 * repository root, under any of the names this tree uses for it (`ROOT`,
 * `REPO_ROOT`, `FORGE_ROOT`, `repoRoot`, `REPO`). The write-target argument
 * is function-specific — `writeFileSync`/`mkdirSync` take it first,
 * `copyFileSync`(src, dest)/`symlinkSync`(target, path) take it SECOND, and
 * `renameSync`(oldPath, newPath) mutates both — because the safe, common
 * pattern of reading a real file FROM the repo root to seed a `mkdtempSync`
 * fixture (`copyFileSync(join(ROOT, …), fixtureDest)`) puts `ROOT` in the
 * source position, not the target one.
 *
 * Plant in a `mkdtempSync` fixture instead, and drive the checker's
 * exported, root-taking entry point directly (`check-owner.mjs`'s `audit`,
 * `check-disabled-reason.mjs`'s `audit`) — or, for a test that wants the
 * CLI's own text output, its `--root` flag (`check-boundaries.mjs`,
 * `check-file-size.mjs`). A checker that shells out to `git` (`codeFiles()`
 * in `check-file-size.mjs`, `productionFiles()` in `check-owner.mjs`) needs
 * the fixture to be a real repository (`git init -q`) — `git ls-files`
 * refuses anywhere else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every write call this rule polices, and which zero-based argument
 *  index(es) are its WRITE TARGET. `writeFileSync`/`mkdirSync` take it
 *  first; `symlinkSync(target, path)` creates the link AT `path` (second);
 *  `copyFileSync(src, dest)` writes `dest` (second); `renameSync(oldPath,
 *  newPath)` mutates both (the source is removed from, the target created). */
const WRITE_CALLS: Record<string, number[]> = {
  writeFileSync: [0],
  mkdirSync: [0],
  symlinkSync: [1],
  copyFileSync: [1],
  renameSync: [0, 1],
};

/** Every name this tree uses for "the real repository root" in a
 *  `scripts/*.test.ts` file. */
const ROOT_NAMES = ['ROOT', 'REPO_ROOT', 'FORGE_ROOT', 'repoRoot', 'REPO'];
const ROOT_NAME_RE = new RegExp(`\\b(?:${ROOT_NAMES.join('|')})\\b`);

/** Blanks out the CONTENTS of `'...'`/`"..."`/`` `...` `` string literals so
 *  a label that merely spells a root-name as a substring (`'M-ROOT.globs'`,
 *  a test fixture's `tree=REPO` placeholder value) is never mistaken for a
 *  reference to the identifier of the same name. No nested-template handling
 *  — the snippets this scans are `join(...)` call arguments and binding
 *  right-hand-sides, not string-in-string interpolation. */
function stripStrings(text: string): string {
  return text.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => ' '.repeat(m.length));
}

/** Every `const <id> = <expr>;` in one source, as a lookup. One level, no
 *  scoping — `probe-hygiene.test.ts`'s identical helper explains why that
 *  bounded resolution is deliberate rather than a second import graph. */
function bindings(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const prior = out.get(m[1]) ?? [];
    prior.push(m[2]);
    out.set(m[1], prior);
  }
  return out;
}

/** Every top-level (paren-depth-1), comma-separated argument's source text
 *  of a call, by paren matching. */
function callArgs(source: string, callAt: number): string[] {
  const open = source.indexOf('(', callAt);
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) { args.push(source.slice(start, i)); return args; }
    } else if (c === ',' && depth === 1) {
      args.push(source.slice(start, i));
      start = i + 1;
    }
  }
  args.push(source.slice(start));
  return args;
}

/** Does this expression reach the repository root — directly, or through one
 *  local binding (property access, e.g. `f.repo`, does NOT count as a
 *  reference to a same-named top-level binding `repo`)? `mkdtempSync(join
 *  (tmpdir(), …))` reaches nothing, which is what a hermetic fixture looks
 *  like. */
function reachesRoot(expr: string, binds: Map<string, string[]>): boolean {
  const stripped = stripStrings(expr);
  if (ROOT_NAME_RE.test(stripped)) return true;
  for (const [name, values] of binds) {
    if (!new RegExp(`(?<![.\\w$])${name}\\b`).test(stripped)) continue;
    if (values.some((v) => ROOT_NAME_RE.test(stripStrings(v)))) return true;
  }
  return false;
}

const TEST_FILES = readdirSync(HERE)
  .filter((f) => f.endsWith('.test.ts'))
  .sort();

test('5.64: no scripts/*.test.ts plants a FILE at the repository ROOT — a write races every concurrent scanner', () => {
  assert.ok(TEST_FILES.length > 10, `expected the scripts/ test suite, found ${TEST_FILES.length} file(s)`);

  const offences: string[] = [];
  for (const file of TEST_FILES) {
    if (file === 'no-live-tree-plants.test.ts') continue;
    const source = readFileSync(join(HERE, file), 'utf8');
    const binds = bindings(source);
    for (const [fn, targetIndexes] of Object.entries(WRITE_CALLS)) {
      const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        // A call inside a comment is not a call.
        const lineStart = source.lastIndexOf('\n', m.index) + 1;
        const line = source.slice(lineStart, source.indexOf('\n', m.index));
        if (/^\s*(\*|\/\/)/.test(line)) continue;
        const args = callArgs(source, m.index);
        for (const idx of targetIndexes) {
          const arg = args[idx];
          if (arg === undefined || !reachesRoot(arg, binds)) continue;
          const lineNo = source.slice(0, m.index).split('\n').length;
          offences.push(`${file}:${lineNo}: ${fn}(…) argument ${idx + 1} (${arg.trim()}) — the write target reaches the repository ROOT`);
        }
      }
    }
  }

  assert.deepEqual(
    offences,
    [],
    'A scripts/*.test.ts file may not writeFileSync/mkdirSync/symlinkSync/copyFileSync/renameSync a path ' +
      'rooted at the live repository tree. `node --test` runs these files CONCURRENTLY, and a planted FILE ' +
      'races every other scanner reading the tree at that moment (bead forge-8vfn.5.64; `probe-hygiene.test.ts` ' +
      'covers the directory create/remove half of the same class). Plant in a `mkdtempSync` fixture and drive ' +
      "the checker's exported, root-taking entry point, or its CLI's `--root` flag. Offences:\n  " +
      offences.join('\n  '),
  );
});
