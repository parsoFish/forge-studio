/**
 * Tests for the standalone `POST /api/initiatives/:id/plan` route (R4-05 / F4).
 *
 * Unlike the batch `/api/develop/start` route, this is single-id: exactly one
 * outcome per request, so the route maps `enqueuePlanRun`'s status straight
 * onto real HTTP statuses (200 enqueued, 404 not-found, 409 already-running,
 * 500 error) rather than always-200-with-a-results-array.
 *
 * Started against a temp forgeRoot with `port: 0`.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

function pendingManifest(id: string, flowId = 'forge-develop'): string {
  return `---
initiative_id: ${id}
project: test-project
project_repo_path: /tmp/test-project
created_at: 2026-06-13T10:00:00.000Z
iteration_budget: 5
cost_budget_usd: 2.0
phase: pending
flow_id: ${flowId}
---

# ${id}
`;
}

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-plan-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  writeFileSync(join(forgeRoot, '_queue', 'pending', 'INIT-2026-06-13-alpha.md'), pendingManifest('INIT-2026-06-13-alpha'));
  writeFileSync(join(forgeRoot, '_queue', 'in-flight', 'INIT-2026-06-13-gamma.md'), pendingManifest('INIT-2026-06-13-gamma'));
  writeFileSync(
    join(forgeRoot, '_queue', 'ready-for-review', 'INIT-2026-06-13-delta.md'),
    pendingManifest('INIT-2026-06-13-delta', 'forge-develop'),
  );

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// TEST-WORLD AMENDMENT — W8-A3 (`flows-37`, review round 1 S2-2). `pendingManifest` defaults to
// `flow_id: forge-develop`, so every one of these posts is a cross-flow REPOINT
// — the same one-click theft flows-37 reproduced, through the third door. The
// route's happy path is unchanged; it now requires the operator's confirmation
// to reach it, and the unconfirmed case is pinned directly below.
test('POST /api/initiatives/:id/plan: an unconfirmed cross-flow repoint → 409, manifest byte-unchanged', async () => {
  const path = join(forgeRoot, '_queue', 'pending', 'INIT-2026-06-13-alpha.md');
  const before = readFileSync(path, 'utf8');
  const res = await fetch(`${url}/api/initiatives/INIT-2026-06-13-alpha/plan`, { method: 'POST', headers: CSRF });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { ok: boolean; status: string; currentFlowId?: string };
  assert.equal(body.ok, false);
  assert.equal(body.status, 'repoint-requires-confirm');
  assert.equal(body.currentFlowId, 'forge-develop');
  assert.equal(readFileSync(path, 'utf8'), before, 'nothing written — the queued manifest is byte-identical');
});

test('POST /api/initiatives/:id/plan: a pending id → 200 enqueued', async () => {
  const res = await fetch(`${url}/api/initiatives/INIT-2026-06-13-alpha/plan`, { method: 'POST', headers: CSRF, body: JSON.stringify({ confirmRepointFrom: 'forge-develop' }) });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; status: string; initiativeId: string; flowId?: string };
  assert.equal(body.ok, true);
  assert.equal(body.status, 'enqueued');
  assert.equal(body.initiativeId, 'INIT-2026-06-13-alpha');
  assert.equal(body.flowId, 'forge-architect');

  const onDisk = readFileSync(join(forgeRoot, '_queue', 'pending', 'INIT-2026-06-13-alpha.md'), 'utf8');
  assert.ok(onDisk.includes('flow_id: forge-architect'), 'repointed at forge-architect on disk');
});

test('POST /api/initiatives/:id/plan: an in-flight id → 409 already-running', async () => {
  const res = await fetch(`${url}/api/initiatives/INIT-2026-06-13-gamma/plan`, { method: 'POST', headers: CSRF });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { ok: boolean; status: string };
  assert.equal(body.ok, false);
  assert.equal(body.status, 'already-running');
});

test('POST /api/initiatives/:id/plan: a forge-develop id parked in ready-for-review → 409 already-running', async () => {
  const res = await fetch(`${url}/api/initiatives/INIT-2026-06-13-delta/plan`, { method: 'POST', headers: CSRF });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { ok: boolean; status: string };
  assert.equal(body.ok, false);
  assert.equal(body.status, 'already-running');
});

test('POST /api/initiatives/:id/plan: an unknown (but validly-shaped) id → 404 not-found', async () => {
  const res = await fetch(`${url}/api/initiatives/INIT-2026-06-13-not-real/plan`, { method: 'POST', headers: CSRF });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { ok: boolean; status: string };
  assert.equal(body.ok, false);
  assert.equal(body.status, 'not-found');
});

test('POST /api/initiatives/:id/plan: a path-traversal id → 404 not-found, never escapes the queue dir', async () => {
  const res = await fetch(`${url}/api/initiatives/${encodeURIComponent('../../etc/passwd')}/plan`, {
    method: 'POST',
    headers: CSRF,
  });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, 'not-found');
});

test('POST /api/initiatives/:id/plan: a write failure → 500, detail surfaced', async () => {
  const brokenRoot = mkdtempSync(join(tmpdir(), 'bridge-plan-broken-'));
  for (const state of ['in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(brokenRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(brokenRoot, '_logs'), { recursive: true });
  writeFileSync(join(brokenRoot, '_queue', 'done', 'INIT-2026-06-13-zeta.md'), pendingManifest('INIT-2026-06-13-zeta'));
  writeFileSync(join(brokenRoot, '_queue', 'pending'), 'not a directory');

  const broken = await startBridge({ forgeRoot: brokenRoot, port: 0 });
  try {
    const res = await fetch(`${broken.url}/api/initiatives/INIT-2026-06-13-zeta/plan`, {
      method: 'POST',
      headers: CSRF,
      // W8-A3 amendment: the fixture is `flow_id: forge-develop`, so the write
      // path is only reached once the repoint is confirmed.
      body: JSON.stringify({ confirmRepointFrom: 'forge-develop' }),
    });
    assert.equal(res.status, 500);
    const body = (await res.json()) as { ok: boolean; status: string; detail?: string };
    assert.equal(body.ok, false);
    assert.equal(body.status, 'error');
    assert.ok(body.detail, 'the underlying failure is surfaced in detail');
  } finally {
    await broken.close();
    rmSync(brokenRoot, { recursive: true, force: true });
  }
});

test('POST /api/initiatives/:id/plan: missing CSRF header → 403', async () => {
  const res = await fetch(`${url}/api/initiatives/INIT-2026-06-13-alpha/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.status, 403);
});
