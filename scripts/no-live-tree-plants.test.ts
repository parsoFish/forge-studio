/**
 * no-live-tree-plants.test.ts — no test file under `scripts/`,
 * `packages/*\/tests/` or `apps/*\/tests/` may point a write call at the
 * repository ROOT.
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
 * gap: no policed test file may call `writeFileSync`, `mkdirSync`,
 * `symlinkSync`, `copyFileSync` or `renameSync` with a WRITE-TARGET argument
 * that resolves — directly, or through a chain of local bindings (widened
 * from `probe-hygiene.test.ts`'s one-level lookback: `packages/agents/tests/
 * integration/agent-run-dispatch.test.ts`'s fixture helper reached ROOT two
 * bindings deep — `dir` -> `FIXTURE_PROJECT_DIR` -> `ROOT` — and a
 * concurrent scanner cannot tell the difference from one hop) — to the
 * repository root, under any of the names this tree uses for it (`ROOT`,
 * `REPO_ROOT`, `FORGE_ROOT`, `repoRoot`, `REPO`). The write-target argument
 * is function-specific — `writeFileSync`/`mkdirSync` take it first,
 * `copyFileSync`(src, dest)/`symlinkSync`(target, path) take it SECOND, and
 * `renameSync`(oldPath, newPath) mutates both — because the safe, common
 * pattern of reading a real file FROM the repo root to seed a `mkdtempSync`
 * fixture (`copyFileSync(join(ROOT, …), fixtureDest)`, or
 * `symlinkSync(join(ROOT, 'skills'), join(fixtureRoot, 'skills'))`) puts
 * `ROOT` in the source position, not the target one.
 *
 * Widened beyond `scripts/` (still bead forge-8vfn.5.64): `node --test`
 * concurrency is not special to `scripts/*.test.ts` — any test file under
 * `packages/*\/tests/` or `apps/*\/tests/` that plants into the live tree
 * races the exact same class of concurrent scanner or sibling test.
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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

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

/** Call names whose FIRST argument is the "base" a path is built from — a
 *  LATER argument is a path SEGMENT (a filename, a subdirectory name)
 *  riding along, not a second root candidate. */
const BASE_PRESERVING_CALLS = new Set(['join', 'resolve', 'dirname']);

/** Resolves an expression down to the small set of "base" texts it could
 *  possibly be — following the BASE argument of a `join`/`resolve`/`dirname`
 *  call, and a bare identifier's own binding(s), to a CHAIN depth bounded
 *  only by `seen` (each binding name expanded at most once, so a cyclic or
 *  self-referential pair terminates rather than looping). Deliberately
 *  ignores a call's later arguments: `join(projectRoot, descriptor.turnSpec
 *  .kindDir, sessionId)`'s `descriptor` binding can be defined via an
 *  unrelated `REPO_ROOT` READ elsewhere in the same file (a config lookup
 *  that has nothing to do with this join's own base) — walking every
 *  co-occurring identifier, not just the base, turned that unrelated READ
 *  into a false WRITE-reaches-ROOT verdict for every path built from
 *  `projectRoot`. Chasing only the base is what lets `dir = join
 *  (FIXTURE_PROJECT_DIR, …)` with `FIXTURE_PROJECT_DIR = join(ROOT, …)`
 *  still resolve two bindings deep — the base of both joins IS the next
 *  identifier in the chain. A shape this doesn't recognise (a template
 *  literal, a property access, an unrecognised call) is returned as its own
 *  (stripped) text — literal enough to still catch `join(ROOT, …)` and a
 *  bare `ROOT` directly. `mkdtempSync(join(tmpdir(), …))` resolves to
 *  nothing ROOT-shaped, which is what a hermetic fixture looks like. */
function resolveBases(expr: string, binds: Map<string, string[]>, seen: Set<string>): string[] {
  const trimmed = stripStrings(expr).trim();
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(trimmed);
  if (call !== null && BASE_PRESERVING_CALLS.has(call[1])) {
    const base = callArgs(trimmed, 0)[0];
    if (base !== undefined) return resolveBases(base, binds, seen);
  }
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed) && !seen.has(trimmed)) {
    seen.add(trimmed);
    const values = binds.get(trimmed);
    if (values !== undefined && values.length > 0) return values.flatMap((v) => resolveBases(v, binds, seen));
  }
  return [trimmed];
}

/** Does this expression reach the repository root — directly, or through
 *  the base-only binding chain `resolveBases` walks? */
function reachesRoot(expr: string, binds: Map<string, string[]>): boolean {
  return resolveBases(expr, binds, new Set()).some((base) => ROOT_NAME_RE.test(base));
}

/** Every `.test.ts` file directly inside `dir` (no recursion — `scripts/`
 *  keeps its original flat scan; subdirectories such as `scripts/stories/`
 *  are a separate lane's fence, not this door's scope). */
function flatTestFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => join(dir, f));
}

/** Every `.test.ts` file anywhere under `dir`, at any depth — `packages/*\/tests/`
 *  and `apps/*\/tests/` nest by kind (`unit/`, `integration/`, `contract/`,
 *  `regression/`, `test-fixtures/`…), so a flat scan would miss most of them. */
function recursiveTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...recursiveTestFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Every `<group>/<package>/tests/` directory that exists — not every
 *  package has one. */
function packageTestDirs(group: 'packages' | 'apps'): string[] {
  const groupPath = join(REPO_ROOT, group);
  const dirs: string[] = [];
  for (const entry of readdirSync(groupPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const testsDir = join(groupPath, entry.name, 'tests');
    if (existsSync(testsDir)) dirs.push(testsDir);
  }
  return dirs;
}

const TEST_FILES = [
  ...flatTestFiles(HERE),
  ...packageTestDirs('packages').flatMap(recursiveTestFiles),
  ...packageTestDirs('apps').flatMap(recursiveTestFiles),
].sort();

test('5.64: no scripts/, packages/*/tests/ or apps/*/tests/ test file plants a FILE at the repository ROOT — a write races every concurrent scanner', () => {
  assert.ok(TEST_FILES.length > 100, `expected the wider test suite, found ${TEST_FILES.length} file(s)`);

  const offences: string[] = [];
  for (const absPath of TEST_FILES) {
    const relPath = relative(REPO_ROOT, absPath);
    if (relPath === 'scripts/no-live-tree-plants.test.ts') continue;
    const source = readFileSync(absPath, 'utf8');
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
          offences.push(`${relPath}:${lineNo}: ${fn}(…) argument ${idx + 1} (${arg.trim()}) — the write target reaches the repository ROOT`);
        }
      }
    }
  }

  assert.deepEqual(
    offences,
    [],
    'No scripts/, packages/*/tests/ or apps/*/tests/ test file may writeFileSync/mkdirSync/symlinkSync/' +
      'copyFileSync/renameSync a path rooted at the live repository tree. `node --test` runs these files ' +
      'CONCURRENTLY, and a planted FILE races every other scanner reading the tree at that moment (bead ' +
      "forge-8vfn.5.64; `probe-hygiene.test.ts` covers the directory create/remove half of the same class). " +
      "Plant in a `mkdtempSync` fixture and drive the checker's exported, root-taking entry point, or its " +
      'CLI\'s `--root` flag. Offences:\n  ' +
      offences.join('\n  '),
  );
});
