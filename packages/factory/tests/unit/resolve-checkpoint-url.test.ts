/**
 * `resolveCheckpointUrl` — the point-of-use guard for a browser checkpoint's
 * `route` (forge-mfv5.1.7). `demo.json` is read RAW by the capture path (never
 * re-validated against `validateDemoModel`), so a route can be anything a
 * hand-edited or malformed demo.json carries. `isSafeDemoRoute`'s character
 * class alone is not enough: a protocol-relative route (`//evil.example/x`)
 * matches the charset but resolves to a FOREIGN origin when actually
 * navigated — this is the attack `new URL(route, serverUrl)` + an origin
 * comparison catches that the regex cannot. Pure, so `recordBrowser` is
 * provably never called with a foreign-origin URL without spinning up a
 * browser: every refusal is asserted here, once, for good.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCheckpointUrl } from '../../demo.ts';

const SERVER = 'http://localhost:4700';

test('resolveCheckpointUrl: no route resolves to the server root', () => {
  const r = resolveCheckpointUrl(SERVER, undefined);
  assert.deepEqual(r, { ok: true, url: SERVER });
});

test('resolveCheckpointUrl: a same-origin route resolves', () => {
  const r = resolveCheckpointUrl(SERVER, '/reports/latest');
  assert.deepEqual(r, { ok: true, url: `${SERVER}/reports/latest` });
});

test('kills "protocol-relative route escapes to a foreign origin": //evil.example/x is REFUSED, never navigated', () => {
  const r = resolveCheckpointUrl(SERVER, '//evil.example/x');
  assert.equal(r.ok, false);
});

test('kills "an @ smuggles a foreign host": /@evil is REFUSED by the character class', () => {
  const r = resolveCheckpointUrl(SERVER, '/@evil');
  assert.equal(r.ok, false);
});

test('kills "an absolute URL overrides the server": https://evil.example is REFUSED', () => {
  const r = resolveCheckpointUrl(SERVER, 'https://evil.example');
  assert.equal(r.ok, false);
});

test('kills "traversal in a route": /reports/../secret is REFUSED', () => {
  const r = resolveCheckpointUrl(SERVER, '/reports/../secret');
  assert.equal(r.ok, false);
});

test('resolveCheckpointUrl never returns ok:true for a resolved URL whose origin differs from the server', () => {
  for (const route of ['//evil.example/x', '/@evil', 'https://evil.example', '/reports/../secret']) {
    const r = resolveCheckpointUrl(SERVER, route);
    if (r.ok) assert.equal(new URL(r.url).origin, new URL(SERVER).origin, `route ${route} must not resolve off-origin`);
  }
});
