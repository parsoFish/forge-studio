/**
 * The package skeleton is real, not a directory listing.
 *
 * ADR 046 fixes nine `packages/*` plus `apps/{forge,studio}`, each declaring
 * `exports: {".": "./index.ts"}` and its own `test` script, each wired into the
 * root tsconfig as a project reference, under a root `workspaces` of exactly
 * `["packages/*", "apps/*"]`.
 *
 * These assertions are structural on purpose: a package that exists but is not
 * in `workspaces`, or is in `workspaces` but has no `test` script, is a
 * directory pretending to be a package — and every later milestone's "one
 * session = one package" rule rests on the pretence being caught here.
 *
 * RUN: node --test --experimental-strip-types scripts/check-skeleton.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `1.0.md` §0 and ADR 046, in allow-graph order. */
const PACKAGES = [
  'contracts', 'kernel', 'library', 'knowledge', 'projects',
  'agents', 'sessions', 'flows', 'factory',
];

/**
 * The LIBRARY-shaped apps. `apps/studio` is deliberately not here: it is a Next
 * application, not a package with a single entry barrel, so the uniform
 * assertions below (one `exports` entry, an `index.ts`) would be wrong for it
 * rather than merely unmet. It gets its own test at the bottom.
 */
const APPS = ['forge'];

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const units = [
  ...PACKAGES.map((p) => ({ dir: `packages/${p}`, name: `@forge/${p}` })),
  ...APPS.map((a) => ({ dir: `apps/${a}`, name: `@forge/app-${a}` })),
];

test('every unit ADR 046 names exists, with an index and a manifest', () => {
  const missing = units.filter((u) => !existsSync(join(ROOT, u.dir, 'package.json')));
  assert.deepEqual(missing.map((u) => u.dir), [], 'these units have no package.json');
  const noIndex = units.filter((u) => !existsSync(join(ROOT, u.dir, 'index.ts')));
  assert.deepEqual(noIndex.map((u) => u.dir), [], 'these units have no index.ts');
});

test('every unit declares the ONE entry point the allow-graph is drawn against', () => {
  for (const u of units) {
    const pkg = json(join(ROOT, u.dir, 'package.json'));
    assert.equal(pkg.name, u.name, `${u.dir}: package name`);
    assert.deepEqual(pkg.exports, { '.': './index.ts' }, `${u.dir}: exports must be exactly the single root entry`);
    assert.equal(pkg.private, true, `${u.dir}: nothing here is published`);
  }
});

test('every unit runs its own tests — a package whose tests only run from the root is not isolated', () => {
  for (const u of units) {
    const pkg = json(join(ROOT, u.dir, 'package.json')) as { scripts?: Record<string, string> };
    assert.ok(pkg.scripts?.test, `${u.dir}: no test script`);
  }
});

test('root workspaces is exactly the two globs — the transitional forge-ui entry is gone', () => {
  // It carried `forge-ui` while the directory sat at the repo root, because
  // `npm run test:ui` resolves `--workspace=forge-ui`. After the move `apps/*`
  // covers it, and the package keeps its name, so the scripts still resolve.
  const root = json(join(ROOT, 'package.json')) as { workspaces?: string[] };
  assert.deepEqual(root.workspaces, ['packages/*', 'apps/*']);
});

test('every unit typechecks standalone — its tsconfig extends the root and includes only its own files', () => {
  // PARKED DECISION, 2026-08-31. ADR 046 §1 says "wired into the root tsconfig
  // as a project reference". TypeScript refuses a reference to any project that
  // disables emit (TS6310), and spec §3 decides "no build step" — forge runs
  // TypeScript through --experimental-strip-types and the root tsconfig is
  // noEmit. Real references would force a dist tree and `tsc -b`.
  //
  // So the shape asserted here is: a real per-package tsconfig for standalone
  // typechecking, the root `include` widened so `npm run build` still covers
  // every package, and the allow-graph enforced by scripts/check-boundaries.mjs
  // — which is strictly stronger than tsc's reference graph (import level,
  // covers orchestrator/ cli/ loops/ which are not packages, catches the `@/`
  // alias and `@forge/<pkg>` shapes, and ratchets).
  //
  // If the ruling comes back the other way, THIS test is the edit point.
  for (const u of units) {
    const cfg = json(join(ROOT, u.dir, 'tsconfig.json')) as { extends?: string; include?: string[] };
    assert.ok(cfg.extends, `${u.dir}: tsconfig must extend the root, not restate it`);
    assert.deepEqual(cfg.include, ['**/*.ts'], `${u.dir}: a package includes its own files and no others`);
  }
});

test('the root build typechecks every package — a package tsc never sees is not built', () => {
  const root = json(join(ROOT, 'tsconfig.json')) as { include?: string[] };
  const include = root.include ?? [];
  assert.ok(include.includes('packages/**/*.ts'), 'root include must cover packages/');
  assert.ok(include.includes('apps/forge/**/*.ts'), 'root include must cover apps/forge/');
});

test('the allow-graph is enforced, and it is enforced by the lint', () => {
  // The claim the parked decision rests on: check-boundaries already encodes
  // the chain. If this file ever stops existing, the reference decision must be
  // reopened, because then nothing enforces the graph at all.
  assert.ok(existsSync(join(ROOT, 'scripts/check-boundaries.mjs')));
  const src = readFileSync(join(ROOT, 'scripts/check-boundaries.mjs'), 'utf8');
  for (const p of PACKAGES) assert.ok(src.includes(`${p}:`), `check-boundaries does not rank ${p}`);
});

test('the root suite runs the packages\' tests — a package tsc sees but node --test does not is worse than untested', () => {
  // Measured hole, caught the day the kernel moved: `npm test` fell 6434 -> 6360,
  // exactly the 74 tests that left orchestrator/ for packages/kernel/. The root
  // glob is what CI runs, so those tests would have executed NOWHERE while the
  // per-package script still reported them green. A package `test` script proves
  // isolation; it does not prove the tests run on every PR.
  const root = json(join(ROOT, 'package.json')) as { scripts?: Record<string, string> };
  const script = root.scripts?.test ?? '';
  assert.ok(script.includes('packages/*/*.test.ts'), 'root `npm test` must glob packages/*/*.test.ts');
  assert.ok(script.includes('apps/*/*.test.ts'), 'root `npm test` must glob apps/*/*.test.ts');
});

test('apps/studio is the moved forge-ui — present, a workspace, and still named forge-ui', () => {
  // The move's whole claim is ZERO code change, so the package keeps its name.
  // That is not an oversight: `npm run test:ui` and `build:ui` resolve
  // `--workspace=forge-ui` by package NAME, so they keep working untouched, and
  // renaming would touch every one of those references plus CI. The rename is
  // deliberate follow-up work, not part of a move.
  const pkg = json(join(ROOT, 'apps/studio/package.json')) as { name?: string };
  assert.equal(pkg.name, 'forge-ui');
  // The OLD path, deliberately spelled in pieces so a path sweep cannot
  // rewrite it into the new one and silently invert this assertion — which
  // is exactly what happened once while landing the move.
  assert.equal(existsSync(join(ROOT, ['forge', 'ui'].join('-'))), false, 'the old path must be gone, not copied');
});

test('the studio app reaches the platform through contracts alone', () => {
  // ADR 046 rule 2. Enforced for real by scripts/check-boundaries.mjs, which
  // ratchets; this asserts the rule still NAMES the moved path, so the lint
  // cannot go quiet the way the containment ratchets did when the kernel moved.
  const src = readFileSync(join(ROOT, 'scripts/check-boundaries.mjs'), 'utf8');
  assert.ok(src.includes('apps\\/studio'), 'the studio rule must name apps/studio');
});
