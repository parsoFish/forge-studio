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

/** `apps/studio` is deliberately absent — see the gap-pin at the bottom. */
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

test('root workspaces covers the two globs, plus forge-ui until it moves', () => {
  // ADR 046's end state is exactly `["packages/*", "apps/*"]`. `forge-ui` is
  // still at the repo root until the `git mv`, and it must stay a workspace
  // until then or `npm run test:ui` — which is `--workspace=forge-ui` — stops
  // resolving. The third entry is transitional and expires with the move; the
  // gap-pin at the bottom of this file is the one place that expiry is stated.
  const root = json(join(ROOT, 'package.json')) as { workspaces?: string[] };
  const ws = root.workspaces ?? [];
  assert.ok(ws.includes('packages/*'), 'workspaces must cover packages/');
  assert.ok(ws.includes('apps/*'), 'workspaces must cover apps/');
  const studioMoved = existsSync(join(ROOT, 'apps/studio/package.json'));
  assert.deepEqual(
    ws,
    studioMoved ? ['packages/*', 'apps/*'] : ['packages/*', 'apps/*', 'forge-ui'],
    studioMoved
      ? 'the move has landed — forge-ui must be gone from workspaces, apps/* covers it now'
      : 'until the move, forge-ui stays a workspace or npm run test:ui cannot resolve it',
  );
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

/**
 * GAP PIN, with its expiry condition stated.
 *
 * `apps/studio` is the eleventh unit ADR 046 names, and it is deliberately NOT
 * created here: it can only come into being as `git mv forge-ui apps/studio`,
 * whose entire claim is zero code change. That claim is checkable only when the
 * diff contains nothing but renames, so the move is its own PR.
 *
 * EXPIRY: when `apps/studio/package.json` exists, delete this test and add
 * `studio` to APPS above. Until then this assertion documents the hole rather
 * than leaving the suite silently one unit short.
 */
test('apps/studio is not here yet, and this test says why', () => {
  assert.equal(
    existsSync(join(ROOT, 'apps/studio/package.json')),
    false,
    'apps/studio exists: the git mv has landed — delete this test and add `studio` to APPS',
  );
  assert.ok(existsSync(join(ROOT, 'forge-ui/package.json')), 'forge-ui is still the studio app until the move');
});
