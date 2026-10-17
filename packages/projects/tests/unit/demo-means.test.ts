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
  run: { gw: 'python3 -m gitweave.cli', gitpulse: 'node ./bin/gitpulse.js' },
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
  // forge-nk1y.42: a run prefix makes a capture command execute the tree under capture.
  ['run not an object', { run: ['gw'] }, /demoMeans\.run must be an object/],
  ['run key not a bare name', { run: { 'bin/gw': 'node ./x.js' } }, /demoMeans\.run\.bin\/gw: the key must be a bare command name/],
  ['run prefix with a shell', { run: { gw: 'python3 -m x; id' } }, /demoMeans\.run\.gw .*shell metacharacters/],
  ['run prefix absolute', { run: { gw: '/home/u/.local/bin/gw' } }, /demoMeans\.run\.gw .*absolute path/],
  ['run prefix climbing out', { run: { gw: 'node ../other/cli.js' } }, /demoMeans\.run\.gw .*`\.\.`/],
  ['run prefix is the head itself', { run: { gw: 'gw' } }, /demoMeans\.run\.gw .*runs `gw` itself/],
  ['run prefix empty', { run: { gw: ' ' } }, /demoMeans\.run\.gw: must be a non-empty/],
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

// forge-8vfn.31 (R70, D-45 amended): a declared external portal is a means — exact origins, literal pages, the
// project's own apply command, and an operator-held auth state named by an env var. Pure data, no network.
const PORTAL = {
  origins: ['https://github.com'],
  pages: ['/orgs/acme/repositories', '/acme/svc/blob/main/README.md'],
  apply: ['gw reset', 'gw apply'],
  authState: 'GW_PORTAL_STATE',
};

test('portal: a full declaration parses to the same shape; authState is optional', () => {
  assert.deepEqual(parseDemoMeans({ portal: PORTAL }), { portal: PORTAL });
  const { authState: _a, ...noAuth } = PORTAL;
  assert.deepEqual(parseDemoMeans({ portal: noAuth }), { portal: noAuth });
  assert.deepEqual(parseDemoMeans({ portal: { ...PORTAL, origins: ['http://127.0.0.1:4555', 'https://login.example.com'] } })?.portal?.origins, ['http://127.0.0.1:4555', 'https://login.example.com']);
});

const portalRefusals: Array<[string, unknown, RegExp]> = [
  ['portal not an object', ['x'], /demoMeans\.portal must be an object/],
  ['unknown portal key', { ...PORTAL, mask: ['#x'] }, /demoMeans\.portal\.mask is not a declared means/],
  ['no origins', { ...PORTAL, origins: [] }, /demoMeans\.portal\.origins must declare at least one origin/],
  ['relative origin', { ...PORTAL, origins: ['github.com'] }, /demoMeans\.portal\.origins\[0\] "github\.com" must be an exact origin/],
  ['origin with a trailing slash', { ...PORTAL, origins: ['https://github.com/'] }, /demoMeans\.portal\.origins\[0\] "https:\/\/github\.com\/" .*write it as "https:\/\/github\.com"/],
  ['origin with a path', { ...PORTAL, origins: ['https://github.com/acme'] }, /demoMeans\.portal\.origins\[0\] .*write it as "https:\/\/github\.com"/],
  ['origin with credentials', { ...PORTAL, origins: ['https://u:p@github.com'] }, /demoMeans\.portal\.origins\[0\] .*must be an exact origin/],
  ['plain http off loopback', { ...PORTAL, origins: ['http://github.com'] }, /demoMeans\.portal\.origins\[0\] .*https .*loopback/],
  ['non-web scheme', { ...PORTAL, origins: ['file:///etc'] }, /demoMeans\.portal\.origins\[0\] .*must be an exact origin/],
  ['no pages', { ...PORTAL, pages: [] }, /demoMeans\.portal\.pages must declare at least one page/],
  ['page not absolute', { ...PORTAL, pages: ['orgs/acme'] }, /demoMeans\.portal\.pages\[0\] .*literal path under the declared origin/],
  ['page as a full URL (a path outside the origins)', { ...PORTAL, pages: ['https://evil.example/x'] }, /demoMeans\.portal\.pages\[0\] .*literal path under the declared origin/],
  ['page protocol-relative', { ...PORTAL, pages: ['//evil.example/x'] }, /demoMeans\.portal\.pages\[0\] .*literal path/],
  ['page with traversal', { ...PORTAL, pages: ['/a/../../b'] }, /demoMeans\.portal\.pages\[0\] .*traversal/],
  ['page with encoded traversal', { ...PORTAL, pages: ['/a/%2E%2e/b'] }, /demoMeans\.portal\.pages\[0\] .*traversal/],
  ['templated page', { ...PORTAL, pages: ['/{org}/{repo}'] }, /demoMeans\.portal\.pages\[0\] .*literal path/],
  ['missing apply', { origins: PORTAL.origins, pages: PORTAL.pages }, /demoMeans\.portal\.apply is required/],
  ['apply as one string with &&', { ...PORTAL, apply: 'gw reset && gw apply' }, /demoMeans\.portal\.apply must be a list of commands run in order, such as \["gw reset", "gw apply"\]/],
  ['apply empty list', { ...PORTAL, apply: [] }, /demoMeans\.portal\.apply is required/],
  ['apply entry with a shell', { ...PORTAL, apply: ['gw apply; id'] }, /demoMeans\.portal\.apply\[0\] .*shell metacharacters/],
  ['apply entry empty', { ...PORTAL, apply: ['gw reset', ' '] }, /demoMeans\.portal\.apply\[1\] is empty/],
  ['authState given as a literal path', { ...PORTAL, authState: '/home/u/state.json' }, /demoMeans\.portal\.authState .*names an environment variable, not a path/],
  ['authState lowercase name', { ...PORTAL, authState: 'gw_state' }, /demoMeans\.portal\.authState .*names an environment variable/],
];

for (const [name, portal, expected] of portalRefusals) {
  test(`portal refuses: ${name}`, () => {
    assert.throws(() => parseDemoMeans({ portal }), expected);
  });
}

test('schema: demoMeans.portal declares exactly the keys the parser accepts, apply required, closed', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const schema = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'schemas', 'project-config.schema.json'), 'utf8'));
  const portal = schema.properties.demoMeans.properties.portal;
  assert.ok(portal, 'the schema declares demoMeans.portal');
  assert.deepEqual(Object.keys(portal.properties).sort(), ['apply', 'authState', 'origins', 'pages']);
  assert.deepEqual([...portal.required].sort(), ['apply', 'origins', 'pages']);
  assert.equal(portal.additionalProperties, false);
  assert.equal(portal.properties.authState.pattern, '^[A-Z_][A-Z0-9_]*$');
});
