/**
 * W7-C3 review (A-H5) — the `home-crosscut-chrome` journey beat's declared
 * route table must match the `data-page` values the app actually renders.
 *
 * The beat shipped asserting `{path:'/agents', page:'agents'}` and
 * `{path:'/flows', page:'flows'}` when the real values are `agents-index`
 * and `flows-index`, and each route's readiness wait was
 * `page.waitForFunction(...).catch(() => {})` — swallowed — so the beat burnt
 * 4 x 20s of dead wait and then emitted >= 4 check failures. Nothing caught
 * it: `--list` enumerates beats without running them, and neither
 * `ui:journey` nor `e2e-deadpaths` is in CI.
 *
 * This is the harness's own assertion data checked against the source of
 * truth, which is the half a unit test CAN run on a host that must not bind
 * the journey's global ports.
 *
 * RUN: node --test --experimental-strip-types scripts/crosscut-chrome-beat.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(ROOT, 'apps', 'studio');
const HOME_BEAT = readFileSync(join(ROOT, 'scripts/journeys/home.mjs'), 'utf8');

/** The beat's own ROUTES table, read out of the source it runs from. */
function declaredRoutes(): Array<{ path: string; page: string }> {
  const start = HOME_BEAT.indexOf('const ROUTES = [', HOME_BEAT.indexOf("id: 'home-crosscut-chrome'"));
  assert.ok(start > 0, 'the home-crosscut-chrome beat must declare a ROUTES table');
  const table = HOME_BEAT.slice(start, HOME_BEAT.indexOf('];', start));
  return [...table.matchAll(/\{\s*path:\s*'([^']+)',\s*page:\s*'([^']+)'/g)]
    .map((m) => ({ path: m[1], page: m[2] }));
}

/** URL path -> the `app/**\/page.tsx` Next would route it to. */
function pageFileFor(path: string): string {
  let dir = join(UI, 'app');
  for (const seg of path.split('/').filter(Boolean)) {
    if (existsSync(join(dir, seg))) { dir = join(dir, seg); continue; }
    const dynamic = readdirSync(dir).filter((e) => e.startsWith('[') && e.endsWith(']'));
    assert.equal(dynamic.length, 1, `no route segment for "${seg}" under ${dir}`);
    dir = join(dir, dynamic[0]);
  }
  const file = join(dir, 'page.tsx');
  assert.ok(existsSync(file), `no page.tsx for route ${path} (looked at ${file})`);
  return file;
}

/** Does this file, or a component it imports, render that data-page value? */
function rendersDataPage(file: string, value: string, depth = 3, seen = new Set<string>()): boolean {
  if (depth < 0 || seen.has(file) || !existsSync(file)) return false;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  if (src.includes(`data-page="${value}"`) || src.includes(`dataPage="${value}"`)) return true;
  for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
    const spec = m[1];
    const base = spec.startsWith('@/') ? join(UI, spec.slice(2))
      : spec.startsWith('.') ? resolve(dirname(file), spec)
        : null;
    if (!base) continue;
    for (const ext of ['.tsx', '.ts']) {
      if (existsSync(base + ext) && rendersDataPage(base + ext, value, depth - 1, seen)) return true;
    }
  }
  return false;
}

test('A-H5: every data-page the crosscut beat asserts is one the route really renders', () => {
  const routes = declaredRoutes();
  assert.ok(routes.length >= 5, `expected the cross-section, got ${routes.length} routes`);
  const wrong: string[] = [];
  for (const route of routes) {
    if (!rendersDataPage(pageFileFor(route.path), route.page)) wrong.push(`${route.path} declares data-page="${route.page}"`);
  }
  assert.deepEqual(wrong, [], `the beat asserts data-page values no route renders: ${wrong.join('; ')}`);
});

test('A-H5: the beat never swallows a readiness wait', () => {
  const start = HOME_BEAT.indexOf("id: 'home-crosscut-chrome'");
  const end = HOME_BEAT.indexOf("\n    {\n      id: '", start + 1);
  const beat = HOME_BEAT.slice(start, end === -1 ? HOME_BEAT.length : end);
  assert.ok(beat.includes('waitForFunction'), 'precondition: the beat waits for readiness');
  assert.equal(
    beat.includes('.catch(() => {})'), false,
    'a bare .catch(() => {}) on the readiness wait is how four 20s dead waits and >=4 check '
    + 'failures shipped unnoticed — route the wait\'s outcome into check() instead',
  );
});
