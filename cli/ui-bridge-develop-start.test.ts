/**
 * Tests for the batch `POST /api/develop/start` route
 * (plan-everything-before-kickoff, item 3).
 *
 * The route was reworked from a single-id body ({initiativeId}) to a batch
 * body ({initiativeIds: string[]}) so the roadmap "start eligible" button can
 * kick off every ready initiative in one request. It always returns HTTP 200
 * for a well-formed batch — per-id outcomes live in `results[]` (there is no
 * single HTTP status that can represent N independent outcomes).
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

function pendingManifest(id: string): string {
  return `---
initiative_id: ${id}
project: test-project
project_repo_path: /tmp/test-project
created_at: 2026-06-13T10:00:00.000Z
iteration_budget: 5
cost_budget_usd: 2.0
phase: pending
flow_id: forge-architect
---

# ${id}
`;
}

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-develop-start-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  writeFileSync(join(forgeRoot, '_queue', 'pending', 'INIT-2026-06-13-alpha.md'), pendingManifest('INIT-2026-06-13-alpha'));
  writeFileSync(join(forgeRoot, '_queue', 'pending', 'INIT-2026-06-13-beta.md'), pendingManifest('INIT-2026-06-13-beta'));
  writeFileSync(join(forgeRoot, '_queue', 'in-flight', 'INIT-2026-06-13-gamma.md'), pendingManifest('INIT-2026-06-13-gamma'));
  writeFileSync(join(forgeRoot, '_queue', 'pending', 'INIT-2026-06-13-delta.md'), pendingManifest('INIT-2026-06-13-delta'));
  writeFileSync(join(forgeRoot, '_queue', 'pending', 'INIT-2026-06-13-epsilon.md'), pendingManifest('INIT-2026-06-13-epsilon'));

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('POST /api/develop/start: empty body → 400', async () => {
  const res = await fetch(`${url}/api/develop/start`, { method: 'POST', headers: CSRF, body: JSON.stringify({}) });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.ok(body.error);
});

test('POST /api/develop/start: initiativeIds must be a non-empty array → 400', async () => {
  const res = await fetch(`${url}/api/develop/start`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ initiativeIds: [] }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/develop/start: single eligible id → 200, ok:true, one enqueued result', async () => {
  const res = await fetch(`${url}/api/develop/start`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ initiativeIds: ['INIT-2026-06-13-alpha'] }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; results: Array<{ initiativeId: string; ok: boolean; status: string }> };
  assert.equal(body.ok, true);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].initiativeId, 'INIT-2026-06-13-alpha');
  assert.equal(body.results[0].ok, true);
  assert.equal(body.results[0].status, 'enqueued');
});

test('POST /api/develop/start: batch of mixed outcomes → 200, ok:false overall, per-id results', async () => {
  const res = await fetch(`${url}/api/develop/start`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({
      initiativeIds: [
        'INIT-2026-06-13-beta', // pending → enqueued
        'INIT-2026-06-13-gamma', // in-flight → already-developing
        'INIT-2026-06-13-missing-not-a-real-id', // valid id shape, no manifest → not-found
      ],
    }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; results: Array<{ initiativeId: string; ok: boolean; status: string }> };
  assert.equal(body.ok, false);
  assert.equal(body.results.length, 3);

  const byId = Object.fromEntries(body.results.map((r) => [r.initiativeId, r]));
  assert.equal(byId['INIT-2026-06-13-beta'].ok, true);
  assert.equal(byId['INIT-2026-06-13-beta'].status, 'enqueued');
  assert.equal(byId['INIT-2026-06-13-gamma'].ok, false);
  assert.equal(byId['INIT-2026-06-13-gamma'].status, 'already-developing');
  assert.equal(byId['INIT-2026-06-13-missing-not-a-real-id'].ok, false);
  assert.equal(byId['INIT-2026-06-13-missing-not-a-real-id'].status, 'not-found');
});

test('POST /api/develop/start: mixed-validity batch → 400 naming invalid entries, nothing enqueued', async () => {
  const res = await fetch(`${url}/api/develop/start`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ initiativeIds: ['INIT-2026-06-13-delta', 42, ''] }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.ok(body.error, 'a validation error is returned');
  assert.ok(body.error!.includes('[1]'), 'the non-string entry is named by index');
  assert.ok(body.error!.includes('[2]'), 'the empty-string entry is named by index');

  // The valid id in the batch must NOT have been enqueued (validate before any enqueue).
  const onDisk = readFileSync(join(forgeRoot, '_queue', 'pending', 'INIT-2026-06-13-delta.md'), 'utf8');
  assert.ok(onDisk.includes('flow_id: forge-architect'), 'delta manifest untouched — still on the architect flow');
});

test('POST /api/develop/start: duplicate ids are deduped (first occurrence wins) → one result', async () => {
  const res = await fetch(`${url}/api/develop/start`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ initiativeIds: ['INIT-2026-06-13-epsilon', 'INIT-2026-06-13-epsilon'] }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; results: Array<{ initiativeId: string; ok: boolean; status: string }> };
  assert.equal(body.results.length, 1, 'duplicates collapse to a single enqueue + result');
  assert.equal(body.results[0].initiativeId, 'INIT-2026-06-13-epsilon');
  assert.equal(body.results[0].status, 'enqueued');
});

test('POST /api/develop/start: a write failure surfaces as a per-item error result, not a 500', async () => {
  // Own bridge on a sabotaged forgeRoot: _queue/pending exists as a FILE, so
  // the enqueue's mkdir/write fails. The endpoint must still 200 with the
  // failure reported per-item (never 500 away results of a batch).
  const brokenRoot = mkdtempSync(join(tmpdir(), 'bridge-develop-broken-'));
  for (const state of ['in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(brokenRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(brokenRoot, '_logs'), { recursive: true });
  writeFileSync(join(brokenRoot, '_queue', 'done', 'INIT-2026-06-13-zeta.md'), pendingManifest('INIT-2026-06-13-zeta'));
  writeFileSync(join(brokenRoot, '_queue', 'pending'), 'not a directory');

  const broken = await startBridge({ forgeRoot: brokenRoot, port: 0 });
  try {
    const res = await fetch(`${broken.url}/api/develop/start`, {
      method: 'POST',
      headers: CSRF,
      body: JSON.stringify({ initiativeIds: ['INIT-2026-06-13-zeta'] }),
    });
    assert.equal(res.status, 200, 'the batch endpoint never 500s a well-formed request');
    const body = (await res.json()) as { ok: boolean; results: Array<{ initiativeId: string; ok: boolean; status: string; detail?: string }> };
    assert.equal(body.ok, false);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].initiativeId, 'INIT-2026-06-13-zeta');
    assert.equal(body.results[0].ok, false);
    assert.equal(body.results[0].status, 'error');
    assert.ok(body.results[0].detail, 'the underlying failure is surfaced in detail');
  } finally {
    await broken.close();
    rmSync(brokenRoot, { recursive: true, force: true });
  }
});
