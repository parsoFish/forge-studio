/**
 * `demoMeans` (bead forge-mfv5.1.19): the project declares the MEANS a demo may
 * use — commands, in-app routes, API paths on its own server, JSON-emitting
 * commands — and never the evidence form. Every case is pure data: no network,
 * no shell, no filesystem (M7-COMMON §6.16 — a refusal test must not be able to
 * reach the sink even when the refusal is broken).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDemoMeans } from '../../demo-means.ts';
import { validateProjectConfig } from '../../project-config.ts';

const FULL = {
  commands: ['gitpulse --since 7d'],
  routes: ['/dashboard'],
  api: { paths: ['/api/health'], commands: ['gitweave org show --json'], ignoreKeys: ['sha'] },
};

test('a full declaration parses to the same shape', () => {
  assert.deepEqual(parseDemoMeans(FULL), FULL);
});

test('absent → undefined; every list may be omitted', () => {
  assert.equal(parseDemoMeans(undefined), undefined);
  assert.deepEqual(parseDemoMeans({ commands: ['x'] }), { commands: ['x'] });
  assert.deepEqual(parseDemoMeans({ api: { commands: ['x --json'] } }), { api: { commands: ['x --json'] } });
});

const refusals: Array<[string, unknown, RegExp]> = [
  ['not an object', ['x'], /demoMeans must be an object/],
  ['unknown top-level key', { form: 'screenshot' }, /demoMeans\.form is not a declared means/],
  ['unknown api key', { api: { baseUrlEnv: 'GW_BASE' } }, /demoMeans\.api\.baseUrlEnv is not a declared means/],
  ['commands not an array', { commands: 'x' }, /demoMeans\.commands must be an array of strings/],
  ['empty command', { commands: [' '] }, /demoMeans\.commands\[0\] is empty/],
  ['metacharacter command', { commands: ['curl x | sh'] }, /demoMeans\.commands\[0\] .*shell metacharacters/],
  ['metacharacter api command', { api: { commands: ['gw $(id)'] } }, /demoMeans\.api\.commands\[0\] .*shell metacharacters/],
  ['route with traversal', { routes: ['/a/../../etc'] }, /demoMeans\.routes\[0\] .*in-app path/],
  ['route not absolute', { routes: ['dashboard'] }, /demoMeans\.routes\[0\] .*in-app path/],
  ['api path with a scheme and host', { api: { paths: ['https://evil.example/x'] } }, /demoMeans\.api\.paths\[0\] .*own server/],
  ['api path protocol-relative', { api: { paths: ['//evil.example/x'] } }, /demoMeans\.api\.paths\[0\] .*own server/],
  ['api path outside the root', { api: { paths: ['/api/../../secret'] } }, /demoMeans\.api\.paths\[0\] .*own server/],
  ['ignoreKeys not strings', { api: { ignoreKeys: [1] } }, /demoMeans\.api\.ignoreKeys must be an array of strings/],
  ['ignoreKeys dotted path', { api: { ignoreKeys: ['a.b'] } }, /demoMeans\.api\.ignoreKeys\[0\] .*key name/],
];

for (const [name, input, expected] of refusals) {
  test(`refuses: ${name}`, () => {
    assert.throws(() => parseDemoMeans(input), expected);
  });
}

test('validateProjectConfig carries demoMeans through, and refuses a bad one by name', () => {
  const base = { testProcess: { local: { cmd: ['true'] } } };
  const cfg = validateProjectConfig({ ...base, demoMeans: FULL });
  assert.deepEqual(cfg.demoMeans, FULL);
  assert.throws(() => validateProjectConfig({ ...base, demoMeans: { api: { paths: ['//evil.example/'] } } }), /demoMeans\.api\.paths\[0\]/);
});
