/**
 * forge-8vfn.31 (R70, D-45 amended) — a portal checkpoint shows the third-party site the project configures,
 * before and after. The fixture "tenant" is a local http server on 127.0.0.1 (never a real portal, never real
 * credentials): it serves a repositories page rendered from a state file, only to a request carrying the
 * cookie in the operator's storage state. Each capture tree's own `apply` writes that tree's declared state,
 * so the before and after frames can only differ if apply ran per tree. No network beyond 127.0.0.1/localhost.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkpointArtifactStem } from '@forge/stations/demo-types.ts';

import { captureCheckpoints } from '../../demo.ts';
import { recordPortal } from '../../demo-capture.ts';
import { portalCheckpointsOf, resolvePortalAuthState } from '../../demo-portal-capture.ts';

const COOKIE_VALUE = 'sekret-cookie-7731';
const AUTH_ENV = 'FORGE_TEST_PORTAL_STATE';
const PAGE = '/orgs/acme/repositories';

type Tenant = { origin: string; port: number; stateFile: string; requests: Array<{ path: string; authed: boolean }>; close: () => Promise<void> };

function startTenant(): Promise<Tenant> {
  const stateFile = join(mkdtempSync(join(tmpdir(), 'portal-tenant-')), 'state.json');
  writeFileSync(stateFile, JSON.stringify({ repos: ['seed'] }));
  const requests: Tenant['requests'] = [];
  return new Promise((done) => {
    const server = http.createServer((req, res) => {
      const authed = (req.headers.cookie ?? '').includes(`portal_session=${COOKIE_VALUE}`);
      requests.push({ path: req.url ?? '', authed });
      const { port } = server.address() as AddressInfo;
      if (req.url === '/redirect-away') {
        res.writeHead(302, { location: `http://localhost:${port}${PAGE}` });
        return void res.end();
      }
      if (req.url === '/hop') {
        res.writeHead(302, { location: PAGE });
        return void res.end();
      }
      if (req.url === '/script-away' || req.url === '/popup') {
        const go = req.url === '/popup' ? `window.open('http://localhost:${port}/pop')` : `location.href = 'http://localhost:${port}${PAGE}'`;
        res.writeHead(200, { 'content-type': 'text/html' });
        return void res.end(`<html><body>leaving<script>${go}</script></body></html>`);
      }
      if (!authed) {
        res.writeHead(401, { 'content-type': 'text/html' });
        return void res.end('<html><body><h1>Sign in</h1></body></html>');
      }
      const { repos } = JSON.parse(readFileSync(stateFile, 'utf8')) as { repos: string[] };
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body style="font:32px sans-serif"><h1>acme repositories</h1><ul id="repos">${repos.map((r) => `<li>${r}</li>`).join('')}</ul></body></html>`);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ origin: `http://127.0.0.1:${port}`, port, stateFile, requests, close: () => new Promise((c) => server.close(() => c())) });
    });
  });
}

function storageState(origin: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'portal-auth-')), 'state.json');
  writeFileSync(path, JSON.stringify({
    cookies: [{ name: 'portal_session', value: COOKIE_VALUE, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
    origins: [{ origin, localStorage: [] }],
  }));
  return path;
}

/** A project whose base commit declares one repository and whose change declares two; `apply` writes its tree's state. */
function projectRepo(applySource = "import { copyFileSync } from 'node:fs';\ncopyFileSync('declared.json', process.env.FIXTURE_TENANT_STATE);\nconsole.log('applied');\n"): string {
  const repo = mkdtempSync(join(tmpdir(), 'portal-project-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@forge.local');
  git('config', 'user.name', 't');
  writeFileSync(join(repo, 'apply.mjs'), applySource);
  writeFileSync(join(repo, 'declared.json'), JSON.stringify({ repos: ['alpha'] }));
  git('add', '--', 'apply.mjs', 'declared.json');
  git('commit', '-q', '-m', 'base');
  writeFileSync(join(repo, 'declared.json'), JSON.stringify({ repos: ['alpha', 'beta'] }));
  git('commit', '-q', '-am', 'change');
  return repo;
}

const digest = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

const LABEL = 'Plan 1: WI-1';

async function capture(repo: string, tenant: Tenant, extra: { authState?: string; page?: string } = {}) {
  const bundleDir = mkdtempSync(join(tmpdir(), 'portal-bundle-'));
  await captureCheckpoints({
    projectRepoPath: repo, project: 'acme', baseRef: 'main~1', changedRef: 'main', bundleDir, checkpointLabels: [],
    portal: {
      means: { origins: [tenant.origin], pages: [extra.page ?? PAGE], apply: ['node apply.mjs'], authState: extra.authState ?? AUTH_ENV },
      checkpoints: [{ label: LABEL, page: extra.page ?? PAGE, regions: ['#repos'] }],
    },
  });
  return bundleDir;
}

test('portal capture: frames differ before/after because each tree applied its own state; every page load carried the auth state', { timeout: 180_000 }, async () => {
  const tenant = await startTenant();
  const repo = projectRepo();
  const auth = storageState(tenant.origin);
  process.env.FIXTURE_TENANT_STATE = tenant.stateFile;
  process.env[AUTH_ENV] = auth;
  try {
    const bundleDir = await capture(repo, tenant);
    const stem = checkpointArtifactStem(LABEL);
    const before = join(bundleDir, 'before', `${stem}.png`);
    const after = join(bundleDir, 'after', `${stem}.png`);
    assert.ok(existsSync(before) && existsSync(after), 'both frames were written');
    assert.ok(existsSync(join(bundleDir, 'after', `${stem}.webm`)), 'the after side has its recording');
    assert.notEqual(digest(before), digest(after), 'the before and after frames differ');
    const pageLoads = tenant.requests.filter((r) => r.path === PAGE);
    assert.equal(pageLoads.length, 2, 'one page load per side');
    assert.ok(pageLoads.every((r) => r.authed), 'every page load carried the operator auth state');
    assert.deepEqual(JSON.parse(readFileSync(tenant.stateFile, 'utf8')), { repos: ['alpha', 'beta'] }, 'the tenant is left in the AFTER state');
    assert.match(readFileSync(join(bundleDir, 'portal-apply.md'), 'utf8'), /left in the AFTER state/);
    // The auth material never lands in the bundle: neither the storage-state path nor its secret.
    for (const f of filesUnder(bundleDir)) {
      const bytes = readFileSync(f).toString('latin1');
      assert.ok(!bytes.includes(COOKIE_VALUE), `${f} holds the cookie value`);
      assert.ok(!bytes.includes(auth), `${f} holds the storage-state path`);
    }
    rmSync(bundleDir, { recursive: true, force: true });
  } finally {
    delete process.env[AUTH_ENV];
    delete process.env.FIXTURE_TENANT_STATE;
    await tenant.close();
    rmSync(repo, { recursive: true, force: true });
  }
});

test('portal capture: a declared authState whose env var is unset is refused by name — no apply runs, no page is opened', { timeout: 120_000 }, async () => {
  const tenant = await startTenant();
  const repo = projectRepo();
  process.env.FIXTURE_TENANT_STATE = tenant.stateFile;
  delete process.env[AUTH_ENV];
  try {
    const bundleDir = await capture(repo, tenant);
    assert.equal(tenant.requests.length, 0, 'no page was opened');
    assert.deepEqual(JSON.parse(readFileSync(tenant.stateFile, 'utf8')), { repos: ['seed'] }, 'no apply ran');
    assert.ok(!existsSync(join(bundleDir, 'before', `${checkpointArtifactStem(LABEL)}.png`)));
    const record = readFileSync(join(bundleDir, 'portal-apply.md'), 'utf8');
    assert.match(record, /Refused: portal auth state not declared\/readable: FORGE_TEST_PORTAL_STATE is unset or empty/);
    assert.doesNotMatch(record, /left in the AFTER state/, 'nothing ran, so the record claims no apply');
    rmSync(bundleDir, { recursive: true, force: true });
  } finally {
    delete process.env.FIXTURE_TENANT_STATE;
    await tenant.close();
    rmSync(repo, { recursive: true, force: true });
  }
});

test('resolvePortalAuthState: unset, empty, unreadable or non-JSON → refused naming the env var, never its value', () => {
  const missing = join(tmpdir(), 'no-such-portal-state.json');
  const notJson = join(mkdtempSync(join(tmpdir(), 'portal-auth-bad-')), 's.json');
  writeFileSync(notJson, 'cookie=1');
  for (const env of [{}, { GW_S: '' }, { GW_S: missing }, { GW_S: notJson }]) {
    const r = resolvePortalAuthState('GW_S', env);
    assert.equal(r.ok, false, JSON.stringify(env));
    const reason = (r as { reason: string }).reason;
    assert.match(reason, /^portal auth state not declared\/readable: GW_S /);
    assert.ok(!reason.includes(missing) && !reason.includes(notJson), 'the reason never carries the path');
  }
  assert.deepEqual(resolvePortalAuthState(undefined, {}), { ok: true });
});

test('portalCheckpointsOf: only a page the project declares is captured; anything else is refused by name', () => {
  const means = { origins: ['https://github.com'], pages: [PAGE], apply: ['gw apply'] };
  const r = portalCheckpointsOf([
    { label: 'Plan 1', form: 'portal-before-after', page: PAGE, regions: ['#repos'] },
    { label: 'Plan 2', form: 'portal-before-after', page: '/acme/elsewhere' },
    { label: 'Plan 3', form: 'cli-before-after', command: 'gw plan' },
  ], means);
  assert.deepEqual(r.checkpoints, [{ label: 'Plan 1', page: PAGE, regions: ['#repos'] }]);
  assert.deepEqual(r.refused, ['Plan 2: "/acme/elsewhere" is not a declared portal page']);
  const stepped = portalCheckpointsOf([{ label: 'Plan 1', form: 'portal-before-after', page: PAGE, steps: [{ click: '#delete-repo' }] }], means);
  assert.deepEqual(stepped, { checkpoints: [], refused: ['Plan 1: a portal checkpoint takes no steps — a step would act on the live site as the operator'] });
  const none = portalCheckpointsOf([{ label: 'Plan 1', form: 'portal-before-after', page: PAGE }], undefined);
  assert.deepEqual(none, { checkpoints: [], refused: ['Plan 1: the project declares no demoMeans.portal'] });
});

test('recordPortal: a page that redirects off the declared origin is refused by name', { timeout: 120_000 }, async () => {
  const tenant = await startTenant();
  const auth = storageState(tenant.origin);
  const bundleDir = mkdtempSync(join(tmpdir(), 'portal-escape-'));
  try {
    await assert.rejects(
      () => recordPortal({ side: 'after', label: 'escape', origins: [tenant.origin], page: '/redirect-away', authStatePath: auth, bundleDir }),
      (err: Error) => err.name === 'DemoRecordError' && /navigated to http:\/\/localhost:\d+, which is not a declared portal origin — refused/.test(err.message),
    );
    assert.ok(!tenant.requests.some((r) => r.path === PAGE), 'the off-origin hop was never fetched');
    assert.ok(!existsSync(join(bundleDir, 'after', 'escape.png')), 'no frame was kept');
  } finally {
    await tenant.close();
    rmSync(bundleDir, { recursive: true, force: true });
  }
});

for (const [name, page, expected] of [
  ['a script navigation off the declared origin', '/script-away', /navigated to http:\/\/localhost:\d+, which is not a declared portal origin — refused/],
  ['a popup', '/popup', /opened a second page — refused/],
] as const) {
  test(`recordPortal: ${name} is refused by name and never fetched`, { timeout: 120_000 }, async () => {
    const tenant = await startTenant();
    const bundleDir = mkdtempSync(join(tmpdir(), 'portal-escape-js-'));
    try {
      await assert.rejects(() => recordPortal({ side: 'after', label: 'escape', origins: [tenant.origin], page, authStatePath: storageState(tenant.origin), bundleDir }), expected);
      assert.ok(!tenant.requests.some((r) => r.path === PAGE || r.path === '/pop'), 'nothing off the declared origin was fetched');
    } finally {
      await tenant.close();
      rmSync(bundleDir, { recursive: true, force: true });
    }
  });
}

test('recordPortal: a redirect hop that stays on the declared origin is followed and recorded', { timeout: 120_000 }, async () => {
  const tenant = await startTenant();
  const bundleDir = mkdtempSync(join(tmpdir(), 'portal-hop-'));
  try {
    const r = await recordPortal({ side: 'after', label: 'hop', origins: [tenant.origin], page: '/hop', authStatePath: storageState(tenant.origin), bundleDir });
    assert.ok(existsSync(r.still));
    assert.ok(tenant.requests.some((q) => q.path === PAGE && q.authed), 'the hop landed on the page with the auth state');
  } finally {
    await tenant.close();
    rmSync(bundleDir, { recursive: true, force: true });
  }
});

test('recordPortal: a page the portal answers 401 (auth state missing or rejected) is refused by name, not recorded as evidence', { timeout: 120_000 }, async () => {
  const tenant = await startTenant();
  const bundleDir = mkdtempSync(join(tmpdir(), 'portal-401-'));
  try {
    await assert.rejects(() => recordPortal({ side: 'before', label: 'signin', origins: [tenant.origin], page: PAGE, bundleDir }), /answered 401 — the auth state is missing or was rejected/);
    assert.ok(!existsSync(join(bundleDir, 'before', 'signin.png')));
  } finally {
    await tenant.close();
    rmSync(bundleDir, { recursive: true, force: true });
  }
});

test('portal capture: apply runs without the auth env var; a failing apply records no frame and names itself in the bundle', { timeout: 180_000 }, async () => {
  const tenant = await startTenant();
  const echo = projectRepo(`console.log('auth=' + (process.env.${AUTH_ENV} ?? 'absent'));\nprocess.exit(3);\n`);
  const auth = storageState(tenant.origin);
  process.env.FIXTURE_TENANT_STATE = tenant.stateFile;
  process.env[AUTH_ENV] = auth;
  try {
    const bundleDir = await capture(echo, tenant);
    const record = readFileSync(join(bundleDir, 'portal-apply.md'), 'utf8');
    assert.match(record, /auth=absent/, 'the apply child never sees the auth env var');
    assert.match(record, /Refused: `node apply\.mjs` exited 3\. No page opened\./);
    assert.ok(!record.includes(auth));
    assert.equal(tenant.requests.length, 0, 'no page was opened after a failed apply');
    rmSync(bundleDir, { recursive: true, force: true });
  } finally {
    delete process.env[AUTH_ENV];
    delete process.env.FIXTURE_TENANT_STATE;
    await tenant.close();
    rmSync(echo, { recursive: true, force: true });
  }
});
