/**
 * forge-nk1y.8 — an unauthenticated request carrying a malformed percent-escape
 * (`%E0%A4%A`) used to throw `URIError` out of an async route handler; nothing
 * catches unhandled rejections, so Node exited and the bridge died.
 *
 * One representative route per route family, against the REAL bridge: each
 * answers 400, and the bridge still answers `/api/health` afterwards. Routes
 * that decode inside their own `try`/`catch` keep their own 400 wording; every
 * other route is mapped by the bridge's top-level dispatch to the named error.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../../ui-bridge.ts';

const BAD = '%E0%A4%A';
const REQUEST_TIMEOUT_MS = 5000;
const NAMED = 'malformed percent-encoding in request URL';

type Family = { family: string; method: 'GET' | 'POST' | 'DELETE'; path: string; own?: true };

const FAMILIES: Family[] = [
  { family: 'reflect', method: 'GET', path: `/api/reflect/${BAD}` },
  { family: 'reflect (answer)', method: 'POST', path: `/api/reflect/${BAD}/answer` },
  { family: 'runs (flows)', method: 'POST', path: `/api/runs/${BAD}/resume` },
  { family: 'runs (studio phase log)', method: 'GET', path: `/api/runs/${BAD}/phases/n/log` },
  { family: 'runs (studio run)', method: 'GET', path: `/api/runs/${BAD}` },
  { family: 'recovery', method: 'GET', path: `/api/recovery/${BAD}` },
  { family: 'cycle data', method: 'GET', path: `/api/events/${BAD}` },
  { family: 'review comments', method: 'GET', path: `/api/review-comments/${BAD}` },
  { family: 'run triggers', method: 'POST', path: `/api/initiatives/${BAD}/plan` },
  { family: 'studio (agent write)', method: 'DELETE', path: `/api/studio/agents/${BAD}` },
  { family: 'KB read', method: 'GET', path: `/api/studio/kbs/${BAD}` },
  { family: 'KB drain', method: 'GET', path: `/api/studio/kbs/${BAD}/drain/active` },
  { family: 'projects preflight', method: 'GET', path: `/api/studio/projects/${BAD}/preflight` },
  { family: 'projects roadmap', method: 'GET', path: `/api/studio/projects/${BAD}/contract-stages` },
  { family: 'projects reset', method: 'POST', path: `/api/studio/projects/${BAD}/contract-reset` },
  { family: 'sessions (project brain)', method: 'GET', path: `/api/project-brain/themes/${BAD}/s1` },
  { family: 'sessions (cancel)', method: 'POST', path: `/api/studio/sessions/k/${BAD}/cancel`, own: true },
  { family: 'agents (runs)', method: 'GET', path: `/api/agents/runs/${BAD}` },
  { family: 'agents (slug history)', method: 'GET', path: `/api/agents/${BAD}/history`, own: true },
  { family: 'library (instructions)', method: 'POST', path: `/api/studio/agents/${BAD}/instructions-draft`, own: true },
  { family: 'library (skills)', method: 'GET', path: `/api/studio/skills/${BAD}`, own: true },
  { family: 'architect (session file)', method: 'GET', path: `/api/architect/file/${BAD}/s/f.html` },
  { family: 'demo-builder (demo)', method: 'GET', path: `/api/demo-builder/demo/${BAD}/s` },
  { family: 'instructions (session file)', method: 'GET', path: `/api/instructions/file/${BAD}/s/f.md` },
];

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-malformed-url-'));
  mkdirSync(join(forgeRoot, '_queue'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

function send(f: Family): Promise<Response> {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS); // a handler that never answers is a failure, not a hang
  return fetch(`${url}${f.path}`, f.method === 'GET'
    ? { signal }
    : { method: f.method, headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' }, body: JSON.stringify({}), signal });
}

for (const f of FAMILIES) {
  test(`${f.family}: ${f.method} with a malformed percent-escape is a 400, not a crash`, async () => {
    const res = await send(f);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    if (f.own) assert.match(body.error, /malformed/);
    else assert.equal(body.error, NAMED);
  });
}

test('the bridge still answers /api/health after every malformed request', async () => {
  const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  assert.equal(res.status, 200);
});
